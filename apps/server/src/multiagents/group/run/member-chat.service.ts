import { AgentInteractionService } from '../../interactions/agent-interaction.service.js'
import { TurnDeadline } from '../../adapter/index.js'
import { Injectable, Logger } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { Repository } from 'typeorm'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import {
    applyControlMcpConfig,
    createAgent,
    withControlMcp,
    type AgentEvent
} from '../../adapter/index.js'
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

export interface MemberChatParams {
    group: GroupChat
    userId: string
    runId: string
    instruction: string
    agent: Agent
    member: GroupChatMember
    signal: AbortSignal
}

export interface MemberChatResult {
    success: boolean
    summary: string
}

const LIGHTWEIGHT_CHAT_TIMEOUT_MS = 2 * 60 * 1000

function parseStructuredText(raw: unknown): string | null {
    if (typeof raw !== 'object' || raw === null) return null
    const text = (raw as { text?: unknown }).text
    return typeof text === 'string' && text.trim() ? text.trim() : null
}

/**
 * MemberChatService — 真实调用成员 Agent 做轻量聊天回复。
 *
 * 与 DispatchService 不同：不创建黑板 task，不建 task worktree，不装配黑板上下文，
 * 不要求 report，不做 git diff/产出物写回。它只把成员真实回复落到 presentation_log
 * 和成员私有会话历史，用于「大家打个招呼 / 请产品经理给一句看法」这类轻量场景。
 */
@Injectable()
export class MemberChatService {
    private readonly logger = new Logger(MemberChatService.name)

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
        private readonly runStream: GroupRunStream,
        private readonly debug: GroupDebugLogger,
        private readonly interactions: AgentInteractionService
    ) {}

    async chat(params: MemberChatParams): Promise<MemberChatResult> {
        const { group, userId, runId, agent, instruction } = params
        const session = await this.prepareMemberSession(group, params.member, agent)
        const pinnedContext = await this.groupMessages.pinnedContext(group.id)
        const prompt = this.buildPrompt(instruction, pinnedContext)
        this.debug.log('group.member_chat.instruction', {
            groupId: group.id,
            runId,
            agent: {
                agentId: agent.id,
                name: agent.name,
                vendor: agent.vendor,
                model: agent.model,
                roleInGroup: params.member.roleInGroup
            },
            session: {
                id: session.id,
                workingDirectory: session.workingDirectory,
                sessionHomeDirectory: session.sessionHomeDirectory,
                sdkSessionId: session.sdkSessionId
            },
            prompt
        })

        let finalText = ''
        let fatal: string | null = null
        let agentMessageId: string | null = null
        try {
            const result = await this.runMemberChatTurn(params, session, agent, prompt)
            finalText = result.finalText
            fatal = result.fatal
            agentMessageId = result.agentMessageId
        } catch (err) {
            fatal = this.errMsg(err)
        }

        const summary = finalText.trim() || '(无输出)'
        if (!fatal && finalText.trim()) {
            await this.groupMessages.appendText(
                group.id,
                userId,
                'agent',
                finalText,
                agent.id,
                null,
                agentMessageId
            )
        }
        const result = { success: !fatal, summary: fatal ? `失败：${fatal}` : summary }
        this.debug.log('group.member_chat.finished', {
            groupId: group.id,
            runId,
            agentId: agent.id,
            fatal,
            finalText,
            result
        })
        return result
    }

    private buildPrompt(instruction: string, pinnedContext: string): string {
        return [
            pinnedContext,
            '这是群聊中的轻量回复，不是任务交付。',
            '用户看到的内容只能通过 MCP 工具 submit_member_chat 提交，参数 {"text":"你的回复正文"}。不要只把回复写在普通文本里。',
            '不要创建计划或待办。除非需要核对文件细节，否则不要读写文件。',
            '只用你自己的角色身份回复。',
            `用户/编排器的指令：${instruction}`
        ]
            .filter(Boolean)
            .join('\n')
    }

    private async runMemberChatTurn(
        params: MemberChatParams,
        session: AgentSession,
        agent: Agent,
        prompt: string
    ): Promise<{ finalText: string; fatal: string | null; agentMessageId: string | null }> {
        const provider = await this.resolveProvider(params.userId, agent)
        const config = agentToConfig(agent, session, provider.apiKey, provider.baseUrl, session.id)
        return withControlMcp('submit_member_chat', config.mcpServers, async (control) => {
            const adapter = createAgent(
                agent.vendor,
                applyControlMcpConfig(config, agent.vendor, control, 'merge')
            )
            return this.consumeMemberChatTurn(params, session, agent, prompt, adapter, control)
        })
    }

    private async consumeMemberChatTurn(
        params: MemberChatParams,
        session: AgentSession,
        agent: Agent,
        prompt: string,
        adapter: ReturnType<typeof createAgent>,
        control: { resolve(events: Iterable<AgentEvent>): Promise<{ payload: unknown } | null> }
    ): Promise<{ finalText: string; fatal: string | null; agentMessageId: string | null }> {
        this.debug.log('group.member_chat.turn_started', {
            groupId: params.group.id,
            runId: params.runId,
            agentId: agent.id,
            vendor: agent.vendor,
            model: agent.model,
            workingDirectory: session.workingDirectory,
            prompt
        })

        const events: AgentEvent[] = []
        let fatal: string | null = null
        let sawDone = false

        const deadline = new TurnDeadline(LIGHTWEIGHT_CHAT_TIMEOUT_MS, params.signal)
        const turnId = randomUUID()
        const onInteraction: import('../../adapter/index.js').SendOptions['onInteraction'] = (event, signal) => deadline.waitForInput(async () => {
            return this.interactions.request({ userId: params.userId, sessionId: session.id, turnId, groupId: params.group.id }, event, signal)
        })

        await this.messages.saveMessage(params.userId, agent.id, session.id, 'user', prompt)
        try {
            const iterator = adapter
                .send(prompt, { signal: deadline.signal, turnId, onInteraction })
                [Symbol.asyncIterator]()
            while (true) {
                const next = await Promise.race([iterator.next(), deadline.expired])
                if (next.done) break
                const ev = next.value
                events.push(ev)
                if (ev.type === 'done') {
                    sawDone = true
                    if (!ev.success) fatal ??= 'Agent turn failed'
                    await this.publishMemberEvent(params, ev)
                    continue
                }
                if (ev.type === 'error' && ev.fatal) fatal = ev.message
                this.debug.log('group.member_chat.turn_event', {
                    groupId: params.group.id,
                    runId: params.runId,
                    agentId: agent.id,
                    event: ev
                })
                await this.publishMemberEvent(params, ev)
            }
        } catch (err) {
            fatal ??= this.errMsg(err)
        } finally {
            deadline.close()
            if (!sawDone) fatal ??= 'Agent stream ended without done'
        }

        const submission = await control.resolve(events)
        const finalText = parseStructuredText(submission?.payload) ?? ''
        if (!fatal && !finalText) fatal = 'Member did not call submit_member_chat'
        if (finalText) {
            await this.publishMemberEvent(params, {
                type: 'tool_use',
                vendor: agent.vendor,
                id: 'member-chat-submission',
                name: 'submit_member_chat',
                input: { text: finalText },
                status: 'completed',
                kind: 'mcp',
                mcp: { server: 'agenthub_control', tool: 'submit_member_chat' }
            })
        }
        let agentMessageId: string | null = null
        this.debug.log('group.member_chat.turn_finished', {
            groupId: params.group.id,
            runId: params.runId,
            agentId: agent.id,
            fatal,
            finalText
        })

        try {
            if (finalText) {
                const msg = await this.messages.saveMessage(
                    params.userId,
                    agent.id,
                    session.id,
                    'agent',
                    finalText
                )
                if (msg) agentMessageId = msg.id
            }
            session.sdkSessionId = adapter.sessionId ?? session.sdkSessionId
            session.status = 'active'
            session.lastTurnAt = new Date()
            await this.sessionRepo.save(session)
        } catch (err) {
            this.logger.error(`Failed to persist member chat turn: ${this.errMsg(err)}`)
        }

        return { finalText, fatal, agentMessageId }
    }

    private async publishMemberEvent(params: MemberChatParams, ev: AgentEvent): Promise<void> {
        await this.runStream
            .publish(params.runId, {
                type: 'member_turn_event',
                runId: params.runId,
                taskId: null,
                agentId: params.agent.id,
                event: ev
            })
            .catch(() => undefined)
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
            session = this.sessionRepo.create({
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
            session = await this.sessionRepo.save(session)
            member.agentSessionId = session.id
            await this.memberRepo.save(member)
            this.debug.log('group.member_chat.session_created', {
                groupId: group.id,
                agentId: agent.id,
                sessionId: session.id,
                workingDirectory,
                home
            })
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
        this.debug.log('group.member_chat.session_prepared', {
            groupId: group.id,
            agentId: agent.id,
            sessionId: session.id,
            workingDirectory,
            home,
            sdkSessionId: session.sdkSessionId
        })
        return session
    }

    private async resolveProvider(
        userId: string,
        agent: Agent
    ): Promise<{ apiKey: string; baseUrl: string }> {
        // 群聊成员一律 server 执行模式，platformProviderId 必有值（local 不进群）。
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

    private errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err)
    }
}
