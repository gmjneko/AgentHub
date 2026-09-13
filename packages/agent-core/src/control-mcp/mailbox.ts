import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

export const CONTROL_MCP_MAILBOX_REQUEST = 'request.json'
export const CONTROL_MCP_MAILBOX_RESPONSE = 'response.json'

export interface ControlMcpMailboxRequest {
  id: string
  tool: 'report_for_orchestrator'
  payload: Record<string, unknown>
  at: string
}

export interface ControlMcpMailboxResponse {
  id: string
  text: string
  action?: 'continue' | 'revise'
  error?: string
}

export function mailboxRequestPath(mailboxDir: string): string {
  return join(mailboxDir, CONTROL_MCP_MAILBOX_REQUEST)
}

export function mailboxResponsePath(mailboxDir: string): string {
  return join(mailboxDir, CONTROL_MCP_MAILBOX_RESPONSE)
}

export function writeControlMcpMailboxRequest(
  mailboxDir: string,
  request: ControlMcpMailboxRequest
): void {
  mkdirSync(mailboxDir, { recursive: true })
  const path = mailboxRequestPath(mailboxDir)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(request), 'utf8')
  renameSync(tmp, path)
}

export function writeControlMcpMailboxResponse(
  mailboxDir: string,
  response: ControlMcpMailboxResponse
): void {
  mkdirSync(mailboxDir, { recursive: true })
  const path = mailboxResponsePath(mailboxDir)
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(response), 'utf8')
  renameSync(tmp, path)
}

export function parseControlMcpMailboxRequest(raw: string): ControlMcpMailboxRequest | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rec = parsed as { id?: unknown; tool?: unknown; payload?: unknown; at?: unknown }
    if (typeof rec.id !== 'string' || !rec.id) return null
    if (rec.tool !== 'report_for_orchestrator') return null
    if (!rec.payload || typeof rec.payload !== 'object' || Array.isArray(rec.payload)) return null
    return {
      id: rec.id,
      tool: 'report_for_orchestrator',
      payload: rec.payload as Record<string, unknown>,
      at: typeof rec.at === 'string' ? rec.at : new Date().toISOString()
    }
  } catch {
    return null
  }
}

export function parseControlMcpMailboxResponse(raw: string): ControlMcpMailboxResponse | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rec = parsed as { id?: unknown; text?: unknown; action?: unknown; error?: unknown }
    if (typeof rec.id !== 'string' || !rec.id) return null
    if (typeof rec.text !== 'string') return null
    const action = rec.action === 'revise' ? 'revise' : rec.action === 'continue' ? 'continue' : undefined
    return {
      id: rec.id,
      text: rec.text,
      ...(action ? { action } : {}),
      ...(typeof rec.error === 'string' && rec.error ? { error: rec.error } : {})
    }
  } catch {
    return null
  }
}

export function readControlMcpMailboxRequest(mailboxDir: string): ControlMcpMailboxRequest | null {
  try {
    return parseControlMcpMailboxRequest(readFileSync(mailboxRequestPath(mailboxDir), 'utf8'))
  } catch {
    return null
  }
}

export function readControlMcpMailboxResponse(mailboxDir: string): ControlMcpMailboxResponse | null {
  try {
    return parseControlMcpMailboxResponse(readFileSync(mailboxResponsePath(mailboxDir), 'utf8'))
  } catch {
    return null
  }
}

export function takeControlMcpMailboxRequest(mailboxDir: string): ControlMcpMailboxRequest | null {
  const request = readControlMcpMailboxRequest(mailboxDir)
  if (!request) return null
  try {
    unlinkSync(mailboxRequestPath(mailboxDir))
  } catch {
    return null
  }
  return request
}

function unlinkIfExists(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* ignore */
  }
}

export async function waitForControlMcpMailboxResponse(
  mailboxDir: string,
  requestId: string,
  timeoutMs: number
): Promise<ControlMcpMailboxResponse> {
  const deadline = Date.now() + Math.max(1, timeoutMs)
  while (Date.now() < deadline) {
    const response = readControlMcpMailboxResponse(mailboxDir)
    if (response && response.id === requestId) {
      unlinkIfExists(mailboxResponsePath(mailboxDir))
      return response
    }
    await delay(200)
  }
  return { id: requestId, text: '', error: 'Orchestrator mailbox timed out' }
}

export type ControlMcpMailboxHandler = (
  request: ControlMcpMailboxRequest
) => Promise<ControlMcpMailboxResponse>

export async function watchControlMcpMailbox(
  mailboxDir: string,
  handler: ControlMcpMailboxHandler,
  signal: AbortSignal
): Promise<void> {
  mkdirSync(mailboxDir, { recursive: true })
  while (!signal.aborted) {
    const request = takeControlMcpMailboxRequest(mailboxDir)
    if (request) {
      try {
        const response = await handler(request)
        writeControlMcpMailboxResponse(mailboxDir, { ...response, id: request.id })
      } catch (err) {
        writeControlMcpMailboxResponse(mailboxDir, {
          id: request.id,
          text: '',
          error: err instanceof Error ? err.message : String(err)
        })
      }
      continue
    }
    try {
      await delay(200, undefined, { signal })
    } catch {
      break
    }
  }
}
