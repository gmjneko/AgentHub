import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentAdapterConfig, AgentEvent, AgentVendor } from '../adapter/types.js'
import {
  CONTROL_MCP_MAILBOX_ENV,
  CONTROL_MCP_MAILBOX_TIMEOUT_ENV,
  CONTROL_MCP_SERVER,
  CONTROL_MCP_SINK_ENV,
  CONTROL_MCP_TOOLS_ENV,
  claudeControlToolName,
  parseControlMcpToolName,
  type ControlMcpToolName
} from './names.js'
import { readControlMcpSink, type ControlMcpSubmission } from './sink.js'
import {
  watchControlMcpMailbox,
  type ControlMcpMailboxHandler
} from './mailbox.js'

export type ControlMcpMode = 'control-only' | 'merge' | 'mailbox'

export interface ControlMcpSession {
  mcpServers: Record<string, unknown>
  claudeAllowedTools: string[]
  mailboxDir: string
  readSink(): Promise<ControlMcpSubmission | null>
  collectFromEvents(events: Iterable<AgentEvent>): ControlMcpSubmission | null
  resolve(events: Iterable<AgentEvent>): Promise<ControlMcpSubmission | null>
  watchMailbox(handler: ControlMcpMailboxHandler, signal: AbortSignal): Promise<void>
}

function controlMcpLaunch(): { command: string; args: string[] } {
  const here = dirname(fileURLToPath(import.meta.url))
  const js = join(here, 'stdio-server.js')
  const ts = join(here, 'stdio-server.ts')
  if (existsSync(js)) return { command: process.execPath, args: [js] }
  if (existsSync(ts)) return { command: process.execPath, args: ['--import', 'tsx', ts] }
  throw new Error(`Control MCP stdio entry not found in ${here}`)
}

export function mergeControlMcpServers(
  existing: Record<string, unknown> | undefined,
  sinkPath: string,
  tools: readonly ControlMcpToolName[],
  mailboxDir?: string,
  mailboxTimeoutMs?: number
): Record<string, unknown> {
  const launch = controlMcpLaunch()
  return {
    ...(existing ?? {}),
    [CONTROL_MCP_SERVER]: {
      type: 'stdio',
      command: launch.command,
      args: launch.args,
      env: {
        [CONTROL_MCP_SINK_ENV]: sinkPath,
        [CONTROL_MCP_TOOLS_ENV]: tools.join(','),
        ...(mailboxDir
          ? {
              [CONTROL_MCP_MAILBOX_ENV]: mailboxDir,
              ...(mailboxTimeoutMs
                ? { [CONTROL_MCP_MAILBOX_TIMEOUT_ENV]: String(mailboxTimeoutMs) }
                : {})
            }
          : {})
      }
    }
  }
}

export function collectControlMcpSubmission(
  events: Iterable<AgentEvent>,
  allowed?: readonly ControlMcpToolName[]
): ControlMcpSubmission | null {
  let found: ControlMcpSubmission | null = null
  for (const ev of events) {
    if (ev.type !== 'tool_use') continue
    const rawName = ev.mcp?.server === CONTROL_MCP_SERVER ? ev.mcp.tool : ev.name
    const tool = parseControlMcpToolName(rawName)
    if (!tool) continue
    if (allowed && !allowed.includes(tool)) continue
    if (!ev.input || typeof ev.input !== 'object' || Array.isArray(ev.input)) continue
    found = { tool, payload: ev.input as Record<string, unknown> }
  }
  return found
}

export function mergeControlAllowedTools(
  vendor: AgentVendor,
  existing: string[] | undefined,
  controlClaudeTools: string[],
  mode: ControlMcpMode
): string[] | undefined {
  if (vendor !== 'claude') {
    return mode === 'merge' ? existing : undefined
  }
  if (mode === 'control-only' || mode === 'mailbox') return controlClaudeTools
  if (!existing) return undefined
  return [...new Set([...existing, ...controlClaudeTools])]
}

export function applyControlMcpConfig(
  config: AgentAdapterConfig,
  vendor: AgentVendor,
  session: ControlMcpSession,
  mode: ControlMcpMode
): AgentAdapterConfig {
  return {
    ...config,
    mcpServers: session.mcpServers,
    allowedTools: mergeControlAllowedTools(
      vendor,
      config.allowedTools,
      session.claudeAllowedTools,
      mode
    ),
    permissionMode:
      vendor === 'codex' && mode === 'control-only'
        ? 'plan'
        : vendor === 'codex' && mode === 'mailbox'
          ? 'bypassPermissions'
          : config.permissionMode
  }
}

export async function withControlMcp<T>(
  tools: ControlMcpToolName | readonly ControlMcpToolName[],
  existingMcp: Record<string, unknown> | undefined,
  fn: (session: ControlMcpSession) => Promise<T>,
  options?: { mailboxTimeoutMs?: number }
): Promise<T> {
  const allowed = Array.isArray(tools) ? [...tools] : [tools]
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-control-'))
  const sinkPath = join(dir, 'sink.json')
  const mailboxDir = join(dir, 'mailbox')
  await mkdir(mailboxDir, { recursive: true })
  const enableMailbox = allowed.includes('report_for_orchestrator')
  try {
    const session: ControlMcpSession = {
      mcpServers: mergeControlMcpServers(
        existingMcp,
        sinkPath,
        allowed,
        enableMailbox ? mailboxDir : undefined,
        options?.mailboxTimeoutMs
      ),
      claudeAllowedTools: allowed.map(claudeControlToolName),
      mailboxDir,
      readSink: () => readControlMcpSink(sinkPath),
      collectFromEvents: (events) => collectControlMcpSubmission(events, allowed),
      resolve: async (events) =>
        collectControlMcpSubmission(events, allowed) ?? (await readControlMcpSink(sinkPath)),
      watchMailbox: (handler, signal) => watchControlMcpMailbox(mailboxDir, handler, signal)
    }
    return await fn(session)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
