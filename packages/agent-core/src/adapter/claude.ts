import type { McpServerConfig, Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EventQueue, normalizeEvents } from './event-stream.js'
import type { AgentInteractionEvent } from './types.js'

function mapEffort(e: AgentAdapterConfig['reasoningEffort']): Options['effort'] | undefined { return e === 'minimal' ? 'low' : e }


import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentCapabilities,
  AgentEvent,
  AgentTodoItem,
  AgentTodoStatus,
  AgentUsage,
  SendOptions
} from './types.js'
import { CLAUDE_CAPABILITIES } from './capabilities.js'
import { NOOP_LOGGER, type CoreLogger } from '../logger.js'
import { validateMcp } from './mcp.js'
import { isControlMcpTool } from '../control-mcp/names.js'

/** 老版 TodoWrite 工具的 input 形状 (整批替换 todos) */
interface ClaudeTodoInput {
  todos?: Array<{
    content: string
    status: AgentTodoStatus
    activeForm?: string
  }>
}

/** 新版 TaskCreate 工具 input */
interface ClaudeTaskCreateInput {
  subject?: string
  description?: string
  activeForm?: string
}

/** 新版 TaskUpdate 工具 input */
interface ClaudeTaskUpdateInput {
  taskId?: string
  subject?: string
  status?: AgentTodoStatus | 'deleted'
}

/** 新版任务管理工具集合,统一拦截 */
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])

/** 仅当 status 是合法三态值时通过；否则降级为 pending */
function normalizeTodoStatus(s: unknown): AgentTodoStatus {
  if (s === 'in_progress' || s === 'completed') return s
  return 'pending'
}

export class ClaudeAdapter implements AgentAdapter {
  readonly vendor = 'claude' as const
  readonly id: string
  private readonly logger: CoreLogger
  private _sessionId: string | null = null
  /** session_started 在实例生命周期内只发一次；与 _sessionId 的更新解耦 */
  private sessionStartedEmitted = false
  private readonly config: AgentAdapterConfig
  private busy = false
  /**
   * 已被翻译成 `todo` 事件的工具调用 tool_use_id 集合。
   * 用于在后续 user 消息中过滤掉对应的 tool_result，避免上层看到孤儿结果。
   * 涉及的工具:老版 TodoWrite 与新版 TaskCreate/TaskUpdate/TaskList/TaskGet
   */
  private suppressedToolUseIds = new Set<string>()

  /**
   * 新版任务管理工具(TaskCreate/TaskUpdate)是增量操作,
   * adapter 内自己维护一份任务表,每次操作后吐一次完整快照。
   */
  private tasks = new Map<string, AgentTodoItem>()
  private taskOrder: string[] = []
  private nextTaskId = 1

  constructor(config: AgentAdapterConfig) {
    this.config = config
    this.id = config.id ?? `claude-${Math.random().toString(36).slice(2, 8)}`
    this.logger = config.logger ?? NOOP_LOGGER
  }

  get sessionId(): string | null {
    return this._sessionId
  }

  resumeWith(sdkSessionId: string): void {
    this._sessionId = sdkSessionId
    // 恢复来的会话已建立过，不再重复发 session_started
    this.sessionStartedEmitted = true
  }

  capabilities(): AgentCapabilities {
    return CLAUDE_CAPABILITIES
  }

  /** 当前任务表的有序快照(按创建顺序) */
  private snapshotTasks(): AgentTodoItem[] {
    return this.taskOrder
      .filter((id) => this.tasks.has(id))
      .map((id) => ({ ...this.tasks.get(id)! }))
  }

  async *send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent> {
    if (this.busy) throw new Error(`ClaudeAdapter[${this.id}] is busy`)
    this.busy = true
    const abortController = new AbortController()
    const signal = options?.signal ? AbortSignal.any([options.signal, abortController.signal]) : abortController.signal
    const turnOptions = { ...options, signal, turnId: options?.turnId ?? randomUUID() }
    const queue = new EventQueue<AgentEvent>()
    const producer = (async () => {
      try { for await (const event of this.run(prompt, turnOptions, abortController, event => queue.push(event))) queue.push(event) }
      catch (error) {
        queue.push({ type: 'error', vendor: this.vendor, fatal: true, message: error instanceof Error ? error.message : String(error), code: (error as { code?: string })?.code })
      } finally { queue.close() }
    })()
    try { yield* normalizeEvents(this.vendor, queue, turnOptions) }
    finally {
      abortController.abort()
      queue.close()
      await producer
      this.busy = false
      this.suppressedToolUseIds.clear()
    }
  }

  private async *run(prompt: string, options: SendOptions, abortController: AbortController, emit: (event: AgentEvent) => void): AsyncIterable<AgentEvent> {
    const signal = options.signal!
    signal.throwIfAborted()
    const onAbort = () => abortController.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    // 权限模式：未配置时沿用 bypassPermissions（自动化全开）。
    // 仅 bypass 时附带 allowDangerouslySkipPermissions；其它模式留给 phase-2 接 canUseTool。
    const permissionMode = this.config.permissionMode ?? 'bypassPermissions'

    const claudeConfigDir = join(this.config.agentHomeDirectory, '.claude')

    // 构造 Claude SDK 选项
    const opts: Options = {
      cwd: this.config.workingDirectory,
      ...(this.config.model ? { model: this.config.model } : {}),
      allowedTools: this.config.allowedTools,
      tools: this.config.allowedTools?.filter(name => !name.startsWith('mcp')) ?? { type: 'preset', preset: 'claude_code' },
      permissionMode,
      allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
      settingSources: ['user', 'project'],
      abortController,
      env: {
        ...process.env,
        ...this.config.env,
        CLAUDE_CONFIG_DIR: claudeConfigDir,
        // 本地执行模式 apiKey 为空：不注入 ANTHROPIC_API_KEY，让本机 Claude Code
        // CLI 回退到它自己的登录态（ambient auth）。
        ...(this.config.apiKey ? { ANTHROPIC_API_KEY: this.config.apiKey } : {}),
        ...(this.config.baseUrl ? { ANTHROPIC_BASE_URL: this.config.baseUrl } : {})
      }
    }
    opts.canUseTool = async (toolName, input, context) => {
      if (isControlMcpTool(toolName)) {
        return { behavior: 'allow', updatedInput: input }
      }
      const userInput = toolName === 'AskUserQuestion'
      if (!userInput && permissionMode === 'dontAsk') return { behavior: 'deny', message: 'Interactive permission is disabled' }
      const rawQuestions = Array.isArray(input.questions) ? input.questions as Array<{ question?: string; header?: string; multiSelect?: boolean; options?: Array<{ label?: string; description?: string }> }> : []
      const event: AgentInteractionEvent = {
        type: userInput ? 'user_input_request' : 'permission_request',
        vendor: this.vendor, turnId: options.turnId,
        request: {
          requestId: randomUUID(), toolUseId: context.toolUseID, toolName, input,
          message: context.title ?? context.decisionReason ?? (userInput ? 'Agent needs your input' : `Allow ${toolName}?`),
          ...(userInput ? { questions: rawQuestions.map((q, i) => ({ id: `q${i + 1}`, question: q.question ?? '', header: q.header, multiSelect: q.multiSelect, allowText: true, options: (q.options ?? []).map((o, j) => ({ id: `q${i + 1}-o${j + 1}`, label: o.label ?? '', description: o.description })) })) } : {})
        }
      }
      if (!options.onInteraction) {
        emit({ type: 'error', vendor: this.vendor, fatal: true, code: 'INTERACTION_UNAVAILABLE', message: `No host handler for ${toolName}` })
        return { behavior: 'deny', message: 'No interaction handler connected', interrupt: true }
      }
      // Register the pending request before publishing it, so an immediate response cannot race registration.
      const responsePromise = options.onInteraction(event, AbortSignal.any([signal, context.signal]))
      emit(event)
      const response = await responsePromise
      emit({ type: userInput ? 'user_input_resolved' : 'permission_resolved', vendor: this.vendor, requestId: event.request.requestId, response })
      if (response.decision === 'deny' || response.decision === 'cancel') {
        emit({ type: 'error', vendor: this.vendor, fatal: true, code: 'INTERACTION_DENIED', message: `User declined ${toolName}` })
        return { behavior: 'deny', message: `User declined ${toolName}`, interrupt: true }
      }
      if (userInput) {
        if (response.decision !== 'answer') throw new Error('Expected answers for AskUserQuestion')
        const answers: Record<string, string> = {}
        for (const [i, q] of rawQuestions.entries()) {
          const answer = response.answers?.[`q${i + 1}`]
          if (!q.question || !answer?.trim()) throw new Error('Missing answer for AskUserQuestion')
          answers[q.question] = answer
        }
        return { behavior: 'allow', updatedInput: { ...input, answers } }
      }
      if (response.decision !== 'approve') throw new Error('Expected permission decision')
      return { behavior: 'allow', updatedInput: input }
    }
    const systemPrompt = this.config.systemPrompt?.trim()
    if (systemPrompt) {
      opts.systemPrompt = {
        type: 'preset',
        preset: 'claude_code',
        append: systemPrompt
      }
    }
    if (this.config.skills) opts.skills = this.config.skills
    if (this.config.mcpServers) {
      opts.mcpServers = validateMcp(this.config.mcpServers, 'claude') as Record<string, McpServerConfig>
    }
    if (options?.outputSchema) {
      opts.outputFormat = {
        type: 'json_schema',
        schema: options.outputSchema
      }
    }
    const effort = mapEffort(this.config.reasoningEffort)
    if (effort) opts.effort = effort
    if (this._sessionId) opts.resume = this._sessionId

    let finalText: string | undefined
    let structuredOutput: unknown
    let usage: AgentUsage | undefined
    let success = true
    let pendingText: Extract<AgentEvent, { type: 'text' }> | undefined

    try {
      // 触发 turn_started（Claude SDK 没有显式 turn 概念，由我们合成）
      yield { type: 'turn_started', vendor: this.vendor }

      const input = async function* (): AsyncGenerator<SDKUserMessage> { yield { type: 'user', session_id: '', parent_tool_use_id: null, message: { role: 'user', content: prompt } } }
      for await (const msg of query({ prompt: input(), options: opts })) {
        this.logger.debug(`[raw] ${JSON.stringify(msg)}`)
        for (const ev of this.translate(msg)) {
          this.logger.debug(`[out] ${ev.type}`)
          if (ev.type === 'text') {
            if (pendingText) yield { ...pendingText, type: 'progress' }
            pendingText = ev
            continue
          }
          if (ev.type === 'tool_use' && pendingText) { yield { ...pendingText, type: 'progress' }; pendingText = undefined }
          if (ev.type === 'error' && ev.fatal) success = false
          if (ev.type === 'turn_completed') {
            finalText = ev.finalText ?? pendingText?.text
            if (finalText) yield { type: 'text', vendor: this.vendor, text: finalText, itemId: pendingText?.itemId }
            pendingText = undefined
            structuredOutput = ev.structuredOutput
            usage = ev.usage
          }
          yield ev
        }
      }
    } catch (err) {
      success = false
      yield {
        type: 'error',
        vendor: this.vendor,
        message: err instanceof Error ? err.message : String(err),
        fatal: true
      }
    } finally {
      this.logger.debug(
        `[done] ${JSON.stringify({
          success,
          finalTextLen: finalText?.length ?? 0,
          finalTextHead: finalText?.slice(0, 80) ?? null
        })}`
      )
      yield {
        type: 'done',
        vendor: this.vendor,
        success,
        finalText,
        structuredOutput,
        usage
      }
      signal.removeEventListener('abort', onAbort)
    }
  }

  /** 把单条 SDKMessage 翻译成 0 或多个 AgentEvent */
  private *translate(msg: SDKMessage): Iterable<AgentEvent> {
    // 记录 sessionId（init 或任意带 session_id 的消息）。
    // resume 续聊时 Claude 可能轮换 session_id，因此每次都把 _sessionId 更新为最新值，
    // 但 session_started 在实例生命周期内只发一次（避免上层误判为新会话）。
    if ('session_id' in msg && msg.session_id) {
      this._sessionId = msg.session_id
      if (!this.sessionStartedEmitted) {
        this.sessionStartedEmitted = true
        yield { type: 'session_started', vendor: this.vendor, sessionId: msg.session_id }
      }
    }

    switch (msg.type) {
      case 'assistant': {
        const content = msg.message?.content
        if (!Array.isArray(content)) return
        for (const [blockIndex, block] of content.entries()) {
          const b = block as unknown as { type: string; [k: string]: unknown }
          if (b.type === 'text' && typeof b.text === 'string') {
            yield {
              type: 'text',
              vendor: this.vendor,
              text: b.text,
              itemId: `${msg.uuid}:${blockIndex}`
            }
          } else if (b.type === 'thinking' && typeof b.thinking === 'string') {
            yield {
              type: 'thinking',
              vendor: this.vendor,
              text: b.thinking,
              itemId: `${msg.uuid}:${blockIndex}`
            }
          } else if (b.type === 'tool_use') {
            const id = String(b.id ?? '')
            const name = String(b.name ?? '')
            // 老版 TodoWrite: 整批替换
            if (name === 'TodoWrite') {
              const input = b.input as ClaudeTodoInput | undefined
              const items: AgentTodoItem[] = (input?.todos ?? []).map((t) => ({
                text: t.content,
                status: normalizeTodoStatus(t.status)
              }))
              this.tasks.clear()
              this.taskOrder = []
              items.forEach((it, i) => {
                const tid = String(i + 1)
                this.tasks.set(tid, it)
                this.taskOrder.push(tid)
              })
              this.nextTaskId = items.length + 1
              this.suppressedToolUseIds.add(id)
              yield { type: 'todo', vendor: this.vendor, items }
              continue
            }
            // 新版 TaskCreate / TaskUpdate / TaskList / TaskGet:增量操作
            if (TASK_TOOLS.has(name)) {
              this.suppressedToolUseIds.add(id)
              if (name === 'TaskCreate') {
                const input = b.input as ClaudeTaskCreateInput | undefined
                const tid = String(this.nextTaskId++)
                this.tasks.set(tid, {
                  text: input?.subject ?? '(untitled)',
                  status: 'pending'
                })
                this.taskOrder.push(tid)
                yield {
                  type: 'todo',
                  vendor: this.vendor,
                  items: this.snapshotTasks()
                }
              } else if (name === 'TaskUpdate') {
                const input = b.input as ClaudeTaskUpdateInput | undefined
                const tid = input?.taskId
                if (tid && this.tasks.has(tid)) {
                  if (input?.status === 'deleted') {
                    this.tasks.delete(tid)
                    this.taskOrder = this.taskOrder.filter((x) => x !== tid)
                  } else {
                    const existing = this.tasks.get(tid)!
                    if (input?.subject) existing.text = input.subject
                    if (
                      input?.status === 'pending' ||
                      input?.status === 'in_progress' ||
                      input?.status === 'completed'
                    ) {
                      existing.status = input.status
                    }
                  }
                }
                yield {
                  type: 'todo',
                  vendor: this.vendor,
                  items: this.snapshotTasks()
                }
              }
              // TaskList / TaskGet 只读,直接吞掉,不重发快照
              continue
            }
            // plan 模式产物: ExitPlanMode 的 input.plan 是计划正文
            if (name === 'ExitPlanMode') {
              const input = b.input as { plan?: unknown } | undefined
              const plan = typeof input?.plan === 'string' ? input.plan : ''
              this.suppressedToolUseIds.add(id)
              yield { type: 'plan', vendor: this.vendor, plan }
              continue
            }
            yield {
              type: 'tool_use',
              vendor: this.vendor,
              id,
              name,
              input: b.input,
              kind: name.startsWith('mcp__') ? 'mcp' : name === 'Bash' ? 'shell' : 'native',
              ...(name.startsWith('mcp__') ? { mcp: { server: name.split('__')[1], tool: name.split('__').slice(2).join('__') } } : {}),
              // Claude 的 assistant tool_use 块只是"发起"，完成与否要看后续的 tool_result
              status: 'started'
            }
          }
        }
        return
      }
      case 'user': {
        // user 消息可能携带 tool_result（来自上一次 tool 调用的结果）
        const content = msg.message?.content
        if (!Array.isArray(content)) return
        for (const block of content) {
          const b = block as unknown as { type: string; [k: string]: unknown }
          if (b.type === 'tool_result') {
            const toolUseId = String(b.tool_use_id ?? '')
            // 被归一成 todo 事件的 TodoWrite 调用，其结果也不上抛
            if (this.suppressedToolUseIds.has(toolUseId)) {
              this.suppressedToolUseIds.delete(toolUseId)
              continue
            }
            yield {
              type: 'tool_result',
              vendor: this.vendor,
              toolUseId,
              output: b.content,
              isError: Boolean(b.is_error)
            }
          }
        }
        return
      }
      case 'result': {
        if (msg.subtype === 'success') {
          if (msg.is_error) {
            yield {
              type: 'error',
              vendor: this.vendor,
              message: msg.result || 'Claude turn failed',
              fatal: true
            }
          }
          yield {
            type: 'turn_completed',
            vendor: this.vendor,
            finalText: msg.result,
            structuredOutput: msg.structured_output,
            usage: {
              inputTokens: msg.usage?.input_tokens,
              outputTokens: msg.usage?.output_tokens,
              cachedInputTokens: msg.usage?.cache_read_input_tokens,
              totalCostUSD: msg.total_cost_usd
            }
          }
        } else {
          yield {
            type: 'error',
            vendor: this.vendor,
            message: `Claude turn ended with subtype=${msg.subtype}: ${'errors' in msg ? msg.errors.join('; ') : ''}`,
            fatal: true
          }
          yield { type: 'turn_completed', vendor: this.vendor }
        }
        return
      }
      // 其它系统/状态消息暂时不上抛
      default:
        return
    }
  }
}
