export const CONTROL_MCP_SERVER = 'agenthub_control'

export const CONTROL_MCP_TOOLS = [
  'submit_orchestrator_plan',
  'submit_final_review',
  'submit_member_chat',
  'submit_member_report',
  'report_for_orchestrator',
  'send_to_member',
  'ask_user'
] as const

export type ControlMcpToolName = (typeof CONTROL_MCP_TOOLS)[number]

export const CONTROL_MCP_SINK_ENV = 'AGENTHUB_CONTROL_SINK'
export const CONTROL_MCP_TOOLS_ENV = 'AGENTHUB_CONTROL_TOOLS'
export const CONTROL_MCP_MAILBOX_ENV = 'AGENTHUB_CONTROL_MAILBOX'
export const CONTROL_MCP_MAILBOX_TIMEOUT_ENV = 'AGENTHUB_CONTROL_MAILBOX_TIMEOUT_MS'

export function isControlMcpToolName(value: string): value is ControlMcpToolName {
  return (CONTROL_MCP_TOOLS as readonly string[]).includes(value)
}

export function claudeControlToolName(tool: ControlMcpToolName): string {
  return `mcp__${CONTROL_MCP_SERVER}__${tool}`
}

export function parseControlMcpToolName(name: string): ControlMcpToolName | null {
  const trimmed = name.trim()
  if (isControlMcpToolName(trimmed)) return trimmed
  const claudePrefix = `mcp__${CONTROL_MCP_SERVER}__`
  if (trimmed.startsWith(claudePrefix)) {
    const tool = trimmed.slice(claudePrefix.length)
    return isControlMcpToolName(tool) ? tool : null
  }
  const codexPrefix = `mcp:${CONTROL_MCP_SERVER}/`
  if (trimmed.startsWith(codexPrefix)) {
    const tool = trimmed.slice(codexPrefix.length)
    return isControlMcpToolName(tool) ? tool : null
  }
  return null
}

export function isControlMcpTool(
  name: string,
  allowed?: readonly ControlMcpToolName[]
): boolean {
  const tool = parseControlMcpToolName(name)
  if (!tool) return false
  return allowed ? allowed.includes(tool) : true
}

export function parseControlMcpToolList(raw: string | undefined): ControlMcpToolName[] {
  if (!raw?.trim()) return [...CONTROL_MCP_TOOLS]
  const tools = raw
    .split(',')
    .map((part) => part.trim())
    .filter(isControlMcpToolName)
  return tools.length > 0 ? tools : [...CONTROL_MCP_TOOLS]
}
