import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createAgent, TurnDeadline, type AgentEvent } from '../../adapter/index.js'
import { Agent } from '../../entities/agent.entity.js'
import { AgentSession } from '../../entities/agent-session.entity.js'
import { agentToConfig } from '../../mappers/agent.mapper.js'
import { AgentMessageHistoryService } from '../../messages/agent-message-history.service.js'
import { AgentWorkspaceService } from '../../workspace/agent-workspace.service.js'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { BusinessException } from '../../../common/index.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupChatMember } from '../entities/group-chat-member.entity.js'
import { GroupRunStream } from './group-run-stream.service.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'
import { GroupInboxService } from './group-inbox.service.js'
import { runTeamDiscussion, type TeamSeat } from './agent-team-discussion.js'
import {
    USER_SPEAKER_NAME,
    buildTeamTurnPrompt,
    renderInbox,
    type TeamInboxEntry,
    type TeamNudge
} from './agent-team-reply.js'
import { LayeredMemoryService } from '../../memory/layered-memory.service.js'

const TEAM_TURN_TIMEOUT_MS = 30 * 60 * 1000

export interface AgentTeamRunParams {
    group: GroupChat
    userId: string
    runId: string
    userText: string
    members: Array<{ member: GroupChatMember; agent: Agent }>
    signal: AbortSignal
}

export interface AgentTeamRunResult {
    success: boolean
    suspended: boolean
}

/**
 * Agent Team 一轮用户消息：Inbox 注入、skip / 讨论 / 给用户，直到有人直接对用户说话。
 * 不使用控制面 MCP，也不进入 Orchestrator 计划。
 */
@Injectable()
export class AgentTeamRunService {
    private readonly logger = new Logger(AgentTeamRunService.name)

    constructor(
        @InjectRepository(AgentSession)
        private readonly sessionRepo: Repository<AgentSession>,
        @InjectRepository(GroupChatMember)
        private readonly memberRepo: Repository<GroupChatMember>,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly providers: PlatformProviderService,
        private readonly messages: AgentMessageHistoryService,
        private readonly groupMessages: GroupMessageService,
        private readonly inbox: GroupInboxService,
        private readonly runStream: GroupRunStream,
        private readonly debug: GroupDebugLogger,
        private readonly layeredMemory: LayeredMemoryService
    ) {}

    async run(params: AgentTeamRunParams): Promise<AgentTeamRunResult> {
        const seats = this.seats(params)
        const leader = seats.find((seat) => seat.isLeader)
        if (!leader) {
            await this.groupMessages.appendSystem(
                params.group.id,
                params.userId,
                'Agent Team 没有可用的队长，讨论没有开始。'
            )
            return { success: false, suspended: false }
        }

        await this.inbox.deliver({
            groupId: params.group.id,
            runId: params.runId,
            fromName: USER_SPEAKER_NAME,
            text: params.userText,
            recipientAgentIds: seats.map((seat) => seat.agentId)
        })

        const pinnedContext = await this.groupMessages.pinnedContext(params.group.id)
        const memoryContext = await this.layeredMemory.promptBlock(
            params.userId,
            params.group.workspaceDir
        )
        const stop = await runTeamDiscussion(seats, {
            loadInbox: (agentId) => this.inbox.loadUnconsumed(params.group.id, agentId),
            consume: (ids) => this.inbox.consume(ids),
            deliver: (fromName, text, exceptAgentId) =>
                this.inbox.deliver({
                    groupId: params.group.id,
                    runId: params.runId,
                    fromName,
                    text,
                    recipientAgentIds: seats
                        .map((seat) => seat.agentId)
                        .filter((agentId) => agentId !== exceptAgentId)
                }),
            postSpeech: async (seat, text) => {
                await this.groupMessages.appendText(
                    params.group.id,
                    params.userId,
                    'agent',
                    text,
                    seat.agentId
                )
                await this.publishText(params, seat.agentId, text)
            },
            postSystem: async (text) => {
                await this.groupMessages.appendSystem(params.group.id, params.userId, text)
            },
            speak: (seat, inbox, nudge) =>
                this.speak(params, seats, seat, inbox, nudge, pinnedContext, memoryContext),
            aborted: () => params.signal.aborted
        })

        return { success: stop !== 'aborted' || params.signal.aborted, suspended: false }
    }

    private seats(params: AgentTeamRunParams): TeamSeat[] {
        return params.members.map(({ agent }) => ({
            agentId: agent.id,
            name: agent.name,
            isLeader: agent.id === params.group.leaderAgentId
        }))
    }

    private async speak(
        params: AgentTeamRunParams,
        seats: TeamSeat[],
        seat: TeamSeat,
        inbox: TeamInboxEntry[],
        nudge: TeamNudge,
        pinnedContext: string,
        memoryContext: string
    ): Promise<string> {
        const pair = params.members.find((item) => item.agent.id === seat.agentId)
        if (!pair) throw new Error(`Member ${seat.agentId} is not in this group`)
        const prompt = buildTeamTurnPrompt({
            groupTitle: params.group.title,
            projectName: params.group.projectName,
            projectGoal: params.group.projectGoal,
            speakerName: seat.name,
            isLeader: seat.isLeader,
            roster: seats.map((item) => ({ name: item.name, isLeader: item.isLeader })),
            inboxText: renderInbox(inbox),
            pinnedContext,
            memoryContext,
            nudge
        })
        this.debug.log('group.agent_team.prompt', {
            groupId: params.group.id,
            runId: params.runId,
            agentId: seat.agentId,
            nudge,
            inbox: inbox.map((item) => ({ fromName: item.fromName, text: item.text })),
            prompt
        })
        return this.runTurn(params, pair.member, pair.agent, prompt)
    }

    private async runTurn(
        params: AgentTeamRunParams,
        member: GroupChatMember,
        agent: Agent,
        prompt: string
    ): Promise<string> {
        const session = await this.prepareMemberSession(params.group, member, agent)
        const provider = await this.resolveProvider(params.userId, agent)
        const config = agentToConfig(agent, session, provider.apiKey, provider.baseUrl, session.id)
        const adapter = createAgent(agent.vendor, config)
        const deadline = new TurnDeadline(TEAM_TURN_TIMEOUT_MS, params.signal)
        const turnId = randomUUID()
        let finalText = ''
        let fatal: string | null = null
        let sawDone = false

        await this.messages.saveMessage(params.userId, agent.id, session.id, 'user', prompt)
        try {
            const iterator = adapter
                .send(prompt, { signal: deadline.signal, turnId })
                [Symbol.asyncIterator]()
            while (true) {
                const next = await Promise.race([iterator.next(), deadline.expired])
                if (next.done) break
                const event = next.value
                if (event.type === 'text') finalText = event.text
                if (event.type === 'done') {
                    sawDone = true
                    if (event.finalText) finalText = event.finalText
                    if (!event.success) fatal ??= 'Agent turn failed'
                }
                if (event.type === 'error' && event.fatal) fatal = event.message
                if (event.type !== 'text') await this.publishEvent(params, agent.id, event)
            }
        } catch (err) {
            fatal ??= err instanceof Error ? err.message : String(err)
        } finally {
            deadline.close()
            try {
                session.sdkSessionId = adapter.sessionId ?? session.sdkSessionId
                session.status = 'active'
                session.lastTurnAt = new Date()
                await this.sessionRepo.save(session)
            } catch (err) {
                this.logger.error(`Failed to persist agent team session: ${this.errMsg(err)}`)
            }
        }

        if (!sawDone && !fatal) fatal = 'Agent stream ended without done'
        if (finalText.trim()) {
            await this.messages
                .saveMessage(params.userId, agent.id, session.id, 'agent', finalText)
                .catch((err) =>
                    this.logger.error(`Failed to persist agent team reply: ${this.errMsg(err)}`)
                )
        }
        if (fatal) throw new Error(fatal)
        return finalText
    }

    private async prepareMemberSession(
        group: GroupChat,
        member: GroupChatMember,
        agent: Agent
    ): Promise<AgentSession> {
        const workingDirectory = resolve(this.workspace.repoDir(group.id, group.workspaceDir))
        const home = resolve(this.workspace.memberHomeDir(group.id, agent.id, group.workspaceDir))
        let session: AgentSession | null = null
        if (member.agentSessionId) {
            session = await this.sessionRepo.findOne({ where: { id: member.agentSessionId } })
        }
        if (!session) {
            session = await this.sessionRepo.save(
                this.sessionRepo.create({
                    id: randomUUID(),
                    userId: group.userId,
                    agentId: agent.id,
                    vendor: agent.vendor,
                    scope: 'group',
                    title: null,
                    workingDirectory,
                    sessionHomeDirectory: home,
                    skills: agent.skills,
                    mcpServers: agent.mcpServers,
                    sdkSessionId: null,
                    status: 'active',
                    lastTurnAt: null
                })
            )
            member.agentSessionId = session.id
            await this.memberRepo.save(member)
        }
        session.scope = 'group'
        session.workingDirectory = workingDirectory
        session.sessionHomeDirectory = home
        await this.sessionRepo.save(session)
        await this.agentWorkspace.ensureAgentHomeDirectory(agent.vendor, agent.agentHomeDirectory)
        await this.agentWorkspace.ensureChatRuntimeDirectories(agent.vendor, workingDirectory, home)
        await this.agentWorkspace.syncVendorConfigToWorkingDirectory(
            agent.vendor,
            agent.agentHomeDirectory,
            workingDirectory
        )
        return session
    }

    private async resolveProvider(
        userId: string,
        agent: Agent
    ): Promise<{ apiKey: string; baseUrl: string }> {
        if (!agent.platformProviderId) {
            throw BusinessException.agentUnavailable(
                `Member ${agent.id} has no platform provider (local-execution agents cannot join group chats)`
            )
        }
        try {
            const provider = await this.providers.resolveRuntimeConfig(
                userId,
                agent.platformProviderId
            )
            return { apiKey: provider.apiKey, baseUrl: provider.baseUrl }
        } catch {
            throw BusinessException.agentUnavailable(
                `Member ${agent.id} provider ${agent.platformProviderId} unavailable`
            )
        }
    }

    private async publishText(
        params: AgentTeamRunParams,
        agentId: string,
        text: string
    ): Promise<void> {
        const pair = params.members.find((item) => item.agent.id === agentId)
        await this.publishEvent(params, agentId, {
            type: 'text',
            vendor: pair?.agent.vendor ?? 'claude',
            text
        })
    }

    private async publishEvent(
        params: AgentTeamRunParams,
        agentId: string,
        event: AgentEvent
    ): Promise<void> {
        await this.runStream
            .publish(params.runId, {
                type: 'member_turn_event',
                runId: params.runId,
                taskId: null,
                agentId,
                event
            })
            .catch(() => undefined)
    }

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
