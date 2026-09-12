/**
 * 统一 Agent 适配层 —— 类型定义
 *
 * 设计目标：把 Claude Agent SDK 和 OpenAI Codex SDK 各自的事件流，
 * 归一成同一套 AgentEvent，供 AgentHub 的群聊编排层消费。
 */

import type { CoreLogger } from '../logger.js'

import type { AgentVendor, AgentEvent, AgentCapabilities, AgentPermissionMode, AgentInteractionEvent, AgentInteractionResponse } from '@agenthub/shared'
export type { AgentVendor, AgentUsage, ToolCallStatus, AgentTodoStatus, AgentTodoItem, AgentEvent, AgentCapabilities, AgentPermissionMode, AgentInteractionEvent, AgentInteractionRequest, AgentInteractionResponse } from '@agenthub/shared'
export type AgentOutputSchema = Record<string, unknown>

/**
 * 权限模式。取自 Claude SDK 的 PermissionMode 取值集，作为统一接口。
 * Codex 端只能近似映射（never ≈ bypassPermissions），本期默认 bypass。
 */
/** 构造一个 Agent 时的通用配置 */
export interface AgentAdapterConfig {
  /** AgentHub 内部的唯一标识，例如 "claude-bob"。仅做日志/调试用 */
  id?: string
  /** 模型名；省略时由底层 CLI/SDK 使用本地默认配置。 */
  model?: string
  /** Agent 私有持久目录；Claude 用于 CLAUDE_CONFIG_DIR，Codex 用于 CODEX_HOME */
  agentHomeDirectory: string
  /** 工作目录（agent 实际操作文件系统的根） */
  workingDirectory: string
  /**
   * API key。本地执行模式下可留空字符串，让本机 CLI 回退到它自己的登录态
   * （`~/.claude` / `~/.codex` 的 ambient auth），此时不注入 ANTHROPIC_API_KEY。
   */
  apiKey: string
  /** 自定义 base url（用于 Anthropic / OpenAI 兼容网关） */
  baseUrl?: string
  /** 附加环境变量。会与 process.env 合并 */
  env?: Record<string, string | undefined>
  /** 推理 effort。两边都有，但取值集不完全相同，由各 adapter 自行映射 */
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

  /**
   * 系统提示词。Claude 走 options.systemPrompt；Codex 走
   * CodexOptions.config.instructions（由 core 映射成 base_instructions）。
   */
  systemPrompt?: string
  /**
   * 预加载的 skills。Claude 走 options.skills（"all" 或名称数组）；
   * Codex 通过工作目录下的 .codex/skills 发现。skill 文件本身需由上层
   * 从 Agent Home 同步到当前会话的 workingDirectory。
   */
  skills?: 'all' | string[]
  /**
   * MCP 服务器配置。形状对齐 Claude SDK 的 Record<string, McpServerConfig>；
   * 用 unknown value 以免把 SDK 类型泄漏到统一接口，由各 adapter 自行收窄。
   */
  mcpServers?: Record<string, unknown>
  /** 工具白名单。不传时各 adapter 用各自的默认集合 */
  allowedTools?: string[]
  /** 权限模式。不传时各 adapter 默认 bypassPermissions（自动化全开） */
  permissionMode?: AgentPermissionMode
  /**
   * 可选日志器。不传时各 adapter 用 NOOP_LOGGER（默认静默）。
   * 服务器侧可注入 Nest Logger（结构兼容），桌面侧可注入 console。
   */
  logger?: CoreLogger
}

/** 发送消息时的可选项 */
export interface SendOptions {
  /** 取消信号 */
  signal?: AbortSignal
  turnId?: string
  onInteraction?: (event: AgentInteractionEvent, signal: AbortSignal) => Promise<AgentInteractionResponse>
  /** JSON Schema describing the expected structured response for this turn. */
  outputSchema?: AgentOutputSchema
}

/**
 * 统一 Agent 适配器接口。
 *
 * 语义：
 * - 一个 adapter 实例对应一个会话（多轮对话上下文连续）
 * - `send()` 发送一条用户消息，返回事件流的 async iterable
 * - 流以一条 `done` 事件结束
 * - 同一个 adapter 上不允许并发调用 `send()`（调用方要等流结束）
 */
export interface AgentAdapter {
  readonly vendor: AgentVendor
  readonly id: string
  /** 当前会话 id（首次 send 之后才有值） */
  readonly sessionId: string | null
  /** 发送一条用户消息 */
  send(prompt: string, options?: SendOptions): AsyncIterable<AgentEvent>
  /**
   * 注入一个已有的 SDK 会话 id，使下一次 send() 续接该会话（跨进程恢复）。
   * 必须在首次 send() 之前调用。Claude 走 options.resume，Codex 走 resumeThread。
   */
  resumeWith(sdkSessionId: string): void
  /** 返回该 vendor 的能力描述符（厂商不对称声明） */
  capabilities(): AgentCapabilities
}
