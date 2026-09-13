import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { randomUUID } from 'node:crypto'
import { Repository } from 'typeorm'
import type { AgentQuestion, AgentEvent, AgentInteractionEvent } from '@agenthub/shared'
import {
    applyControlMcpConfig,
    createAgent,
    withControlMcp,
    type AgentAdapter,
    type AgentAdapterConfig,
    type AgentVendor,
    type ControlMcpMailboxRequest,
    type ControlMcpMailboxResponse,
    type ControlMcpSession,
    type ControlMcpSubmission
} from '../../adapter/index.js'
import { AgentInteractionService } from '../../interactions/agent-interaction.service.js'
import { AgentWorkspaceService } from '../../workspace/agent-workspace.service.js'
import { PlatformProviderService } from '../../../platform-provider/platform-provider.service.js'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupMessageService } from '../group-message.service.js'
import { GroupWorkspaceService } from '../group-workspace.service.js'
import { GroupDebugLogger } from '../debug/group-debug-logger.service.js'
import { GroupRunStream } from './group-run-stream.service.js'

const MAX_ASK_USER_PER_REPORT = 3
const MAX_REPORTS_PER_TURN = 6
const MAILBOX_SYSTEM_PROMPT = `你是 AgentHub 群聊的 Orchestrator。成员刚通过 report_for_orchestrator 向你请示，正在同一轮里等你的工具结果。
你必须调用其中一个 MCP 工具：
- send_to_member：你能直接答复或指示成员继续/修改。text 会作为工具结果喂回该成员。
- ask_user：你不确定、需要用户拍板时提问。用户作答后你会再收到一轮，那时必须 send_to_member。
不要写仓库，不要提交计划或最终验收。不要代替成员对用户说话。`

export interface MailboxReportContext {
    group: GroupChat
    userId: string
    runId: string
    taskId: string | null
    agentId: string
    agentName: string
    signal: AbortSignal
}

export interface AskUserContext {
    group: GroupChat
    userId: string
    runId: string
    taskId: string | null
    text: string
    questions: AgentQuestion[]
    signal: AbortSignal
}

@Injectable()
export class OrchestratorMailboxService {
    private readonly tails = new Map<string, Promise<void>>()

    constructor(
        @InjectRepository(GroupChat)
        private readonly groupRepo: Repository<GroupChat>,
        private readonly providers: PlatformProviderService,
        private readonly workspace: GroupWorkspaceService,
        private readonly agentWorkspace: AgentWorkspaceService,
        private readonly groupMessages: GroupMessageService,
        private readonly runStream: GroupRunStream,
        private readonly interactions: AgentInteractionService,
        private readonly debug: GroupDebugLogger
    ) {}

    handleMemberReport(
        request: ControlMcpMailboxRequest,
        ctx: MailboxReportContext
    ): Promise<ControlMcpMailboxResponse> {
        return this.enqueue(ctx.group.id, () => this.runMailboxTurn(request, ctx))
    }

    async withMemberWatch<T>(
        control: ControlMcpSession,
        ctx: MailboxReportContext,
        signal: AbortSignal,
        work: () => Promise<T>
    ): Promise<T> {
        const watchAbort = new AbortController()
        let rounds = 0
        const watching = control.watchMailbox(async (request) => {
            rounds += 1
            if (rounds > MAX_REPORTS_PER_TURN) {
                return { id: request.id, text: '', error: 'Too many reports in one turn' }
            }
            return this.handleMemberReport(request, ctx)
        }, AbortSignal.any([signal, watchAbort.signal]))
        try {
            return await work()
        } finally {
            watchAbort.abort()
            await watching.catch(() => undefined)
        }
    }

    async askUser(ctx: AskUserContext): Promise<string> {
        const questions = normalizeMailboxQuestions(ctx.questions)
        if (questions.length === 0) {
            throw new Error('ask_user requires at least one question')
        }
        const requestId = randomUUID()
        const vendor: AgentVendor = ctx.group.orchestratorVendor
        const event: AgentInteractionEvent = {
            type: 'user_input_request',
            vendor,
            request: {
                requestId,
                toolUseId: requestId,
                toolName: 'ask_user',
                input: { text: ctx.text, questions },
                message: ctx.text,
                questions
            }
        }
        await this.groupMessages.appendAgentQuestion(
            ctx.group.id,
            ctx.userId,
            null,
            null,
            questions,
            ctx.text,
            'orchestrator'
        )
        await this.publishOrchEvent(ctx.runId, event)
        const turnId = randomUUID()
        const sessionId = ctx.group.orchestratorSessionId ?? `orch-${ctx.group.id}`
        const response = await this.interactions.request(
            { userId: ctx.userId, sessionId, turnId, groupId: ctx.group.id },
            event,
            ctx.signal
        )
        await this.publishOrchEvent(ctx.runId, {
            type: 'user_input_resolved',
            vendor,
            requestId,
            response
        })
        if (response.decision !== 'answer') {
            throw new Error('User cancelled the Orchestrator question')
        }
        const answerText = composeInteractionAnswer(questions, response.answers ?? {})
        await this.groupMessages
            .markLatestOrchestratorQuestionAnswered(ctx.group.id, answerText)
            .catch(() => undefined)
        return answerText
    }

    private enqueue<T>(groupId: string, work: () => Promise<T>): Promise<T> {
        const prev = this.tails.get(groupId) ?? Promise.resolve()
        const done = prev.then(work, work)
        this.tails.set(
            groupId,
            done.then(
                () => undefined,
                () => undefined
            )
        )
        return done
    }

    private async runMailboxTurn(
        request: ControlMcpMailboxRequest,
        ctx: MailboxReportContext
    ): Promise<ControlMcpMailboxResponse> {
        const kind =
            request.payload.kind === 'question' || request.payload.kind === 'progress'
                ? request.payload.kind
                : 'progress'
        const text =
            typeof request.payload.text === 'string' ? request.payload.text.trim() : ''
        if (!text) {
            return { id: request.id, text: '', error: 'report_for_orchestrator.text is required' }
        }
        this.debug.log('group.orchestrator_mailbox.started', {
            groupId: ctx.group.id,
            runId: ctx.runId,
            agentId: ctx.agentId,
            kind,
            text
        })

        const group = (await this.groupRepo.findOneBy({ id: ctx.group.id })) ?? ctx.group
        const provider = await this.providers.resolveRuntimeConfig(
            ctx.userId,
            group.orchestratorProviderId
        )
        const home = this.workspace.memberHomeDir(group.id, 'orchestrator', group.workspaceDir)
        await this.agentWorkspace.ensureAgentHomeDirectory(group.orchestratorVendor, home)
        const config: AgentAdapterConfig = {
            id: `orch-${group.id}`,
            model: group.orchestratorModel,
            agentHomeDirectory: home,
            workingDirectory: home,
            apiKey: provider.apiKey,
            baseUrl: provider.baseUrl,
            reasoningEffort: 'minimal',
            systemPrompt: MAILBOX_SYSTEM_PROMPT,
            permissionMode: 'default'
        }

        let prompt = [
            `成员 ${ctx.agentName} (${ctx.agentId}) 通过 report_for_orchestrator 向你请示。`,
            `kind: ${kind}`,
            `text:\n${text}`,
            request.payload.needDecision === true ? '成员标记 needDecision=true。' : '',
            '请调用 send_to_member 或 ask_user。'
        ]
            .filter(Boolean)
            .join('\n')

        return withControlMcp(['send_to_member', 'ask_user'], undefined, async (control) => {
            const adapter = createAgent(
                group.orchestratorVendor,
                applyControlMcpConfig(config, group.orchestratorVendor, control, 'mailbox')
            )
            if (group.orchestratorSessionId) adapter.resumeWith(group.orchestratorSessionId)
            let asks = 0
            while (asks <= MAX_ASK_USER_PER_REPORT) {
                const submission = await this.sendMailboxRequest(adapter, prompt, ctx)
                await this.persistSession(group, adapter.sessionId)
                if (!submission) {
                    return { id: request.id, text: '', error: 'Orchestrator did not reply to the member' }
                }
                if (submission.tool === 'send_to_member') {
                    const reply =
                        typeof submission.payload.text === 'string'
                            ? submission.payload.text.trim()
                            : ''
                    if (!reply) {
                        return { id: request.id, text: '', error: 'send_to_member.text is required' }
                    }
                    const action =
                        submission.payload.action === 'revise' ? 'revise' : 'continue'
                    this.debug.log('group.orchestrator_mailbox.replied', {
                        groupId: group.id,
                        runId: ctx.runId,
                        agentId: ctx.agentId,
                        action,
                        reply
                    })
                    return { id: request.id, text: reply, action }
                }
                if (submission.tool === 'ask_user') {
                    asks += 1
                    if (asks > MAX_ASK_USER_PER_REPORT) {
                        return {
                            id: request.id,
                            text: '',
                            error: 'Orchestrator asked the user too many times'
                        }
                    }
                    const answer = await this.askUser({
                        group,
                        userId: ctx.userId,
                        runId: ctx.runId,
                        taskId: ctx.taskId,
                        text:
                            typeof submission.payload.text === 'string'
                                ? submission.payload.text.trim()
                                : '需要你确认',
                        questions: parseAskUserQuestions(submission.payload),
                        signal: ctx.signal
                    })
                    prompt = `用户对你刚才提问的答复：\n${answer}\n\n请调用 send_to_member 回复成员，或再次 ask_user。`
                    continue
                }
                return { id: request.id, text: '', error: 'Orchestrator used an unexpected tool' }
            }
            return { id: request.id, text: '', error: 'Orchestrator asked the user too many times' }
        })
    }

    private async sendMailboxRequest(
        adapter: AgentAdapter,
        prompt: string,
        ctx: MailboxReportContext
    ): Promise<ControlMcpSubmission | null> {
        const events: AgentEvent[] = []
        for await (const ev of adapter.send(prompt, { signal: ctx.signal })) {
            events.push(ev)
            await this.publishOrchEvent(ctx.runId, ev)
            if (ev.type === 'error' && ev.fatal) {
                throw new Error(ev.message)
            }
        }
        return (
            events.reduce<ControlMcpSubmission | null>((found, ev) => {
                if (ev.type !== 'tool_use' || !ev.input || typeof ev.input !== 'object') return found
                const tool = ev.mcp?.tool ?? ev.name
                if (tool.endsWith('send_to_member')) {
                    return { tool: 'send_to_member', payload: ev.input as Record<string, unknown> }
                }
                if (tool.endsWith('ask_user')) {
                    return { tool: 'ask_user', payload: ev.input as Record<string, unknown> }
                }
                return found
            }, null)
        )
    }

    private async persistSession(group: GroupChat, sessionId?: string | null): Promise<void> {
        if (!sessionId || group.orchestratorSessionId === sessionId) return
        group.orchestratorSessionId = sessionId
        await this.groupRepo.save(group)
    }

    private async publishOrchEvent(runId: string, event: AgentEvent): Promise<void> {
        await this.runStream
            .publish(runId, { type: 'orchestrator_turn_event', runId, event })
            .catch(() => undefined)
    }
}

function parseAskUserQuestions(payload: Record<string, unknown>): AgentQuestion[] {
    return normalizeMailboxQuestions(payload.questions)
}

export function normalizeMailboxQuestions(raw: unknown): AgentQuestion[] {
    if (!Array.isArray(raw)) return []
    return raw.flatMap((item, index) => {
        if (!item || typeof item !== 'object') return []
        const question = (item as { question?: unknown }).question
        if (typeof question !== 'string' || !question.trim()) return []
        const header = (item as { header?: unknown }).header
        const optionsRaw = (item as { options?: unknown }).options
        const options = Array.isArray(optionsRaw)
            ? optionsRaw.flatMap((option, optionIndex) => {
                  if (!option || typeof option !== 'object') return []
                  const label = (option as { label?: unknown }).label
                  if (typeof label !== 'string' || !label.trim()) return []
                  const description = (option as { description?: unknown }).description
                  return [
                      {
                          id: `q${index + 1}-o${optionIndex + 1}`,
                          label: label.trim(),
                          ...(typeof description === 'string' && description
                              ? { description }
                              : {})
                      }
                  ]
              })
            : []
        return [
            {
                id: `q${index + 1}`,
                question: question.trim(),
                ...(typeof header === 'string' && header ? { header } : {}),
                multiSelect: (item as { multiSelect?: boolean }).multiSelect === true,
                allowText: (item as { allowText?: boolean }).allowText === true,
                options
            }
        ]
    })
}

function composeInteractionAnswer(
    questions: AgentQuestion[],
    answers: Record<string, string>
): string {
    return questions
        .map((question) => {
            const value = answers[question.id]?.trim()
            return `${question.header || question.question}：${value || '(未作答)'}`
        })
        .join('\n')
}
