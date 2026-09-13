import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import {
  CONTROL_MCP_MAILBOX_ENV,
  CONTROL_MCP_MAILBOX_TIMEOUT_ENV,
  CONTROL_MCP_SINK_ENV,
  CONTROL_MCP_TOOLS_ENV,
  isControlMcpToolName,
  parseControlMcpToolList
} from './names.js'
import { listControlMcpTools } from './schemas.js'
import { writeControlMcpSink } from './sink.js'
import {
  waitForControlMcpMailboxResponse,
  writeControlMcpMailboxRequest
} from './mailbox.js'

const DEFAULT_MAILBOX_TIMEOUT_MS = 30 * 60 * 1000

const sinkPath = process.env[CONTROL_MCP_SINK_ENV]
if (!sinkPath) {
  process.stderr.write(`${CONTROL_MCP_SINK_ENV} is required\n`)
  process.exit(1)
}

const mailboxDir = process.env[CONTROL_MCP_MAILBOX_ENV]
const mailboxTimeoutMs = Number.parseInt(process.env[CONTROL_MCP_MAILBOX_TIMEOUT_ENV] ?? '', 10)
const timeoutMs =
  Number.isFinite(mailboxTimeoutMs) && mailboxTimeoutMs > 0
    ? mailboxTimeoutMs
    : DEFAULT_MAILBOX_TIMEOUT_MS

const tools = parseControlMcpToolList(process.env[CONTROL_MCP_TOOLS_ENV])
const definitions = listControlMcpTools(tools)

const server = new Server(
  { name: 'agenthub_control', version: '1.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: definitions.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as {
      type: 'object'
      properties?: Record<string, object>
      required?: string[]
    }
  }))
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name
  if (!isControlMcpToolName(name) || !tools.includes(name)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Unknown control tool: ${name}` }]
    }
  }
  const args = request.params.arguments
  const payload =
    args && typeof args === 'object' && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : {}
  writeControlMcpSink(sinkPath, { tool: name, payload })
  if (name === 'report_for_orchestrator') {
    if (!mailboxDir) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Orchestrator mailbox is not configured' }]
      }
    }
    const id = randomUUID()
    writeControlMcpMailboxRequest(mailboxDir, {
      id,
      tool: 'report_for_orchestrator',
      payload,
      at: new Date().toISOString()
    })
    const response = await waitForControlMcpMailboxResponse(mailboxDir, id, timeoutMs)
    if (response.error) {
      return {
        isError: true,
        content: [{ type: 'text', text: response.error }]
      }
    }
    return {
      content: [{ type: 'text', text: response.text }]
    }
  }
  return {
    content: [{ type: 'text', text: JSON.stringify({ ok: true, tool: name }) }]
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
