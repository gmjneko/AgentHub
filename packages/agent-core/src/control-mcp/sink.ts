import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { ControlMcpToolName } from './names.js'
import { parseControlMcpToolName } from './names.js'

export interface ControlMcpSubmission {
  tool: ControlMcpToolName
  payload: Record<string, unknown>
  at?: string
}

export function writeControlMcpSink(sinkPath: string, submission: ControlMcpSubmission): void {
  const record = {
    tool: submission.tool,
    payload: submission.payload,
    at: submission.at ?? new Date().toISOString()
  }
  mkdirSync(dirname(sinkPath), { recursive: true })
  const tmp = `${sinkPath}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(record), 'utf8')
  renameSync(tmp, sinkPath)
}

export function parseControlMcpSink(raw: string): ControlMcpSubmission | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    const rec = parsed as { tool?: unknown; payload?: unknown }
    const tool = typeof rec.tool === 'string' ? parseControlMcpToolName(rec.tool) : null
    if (!tool || !rec.payload || typeof rec.payload !== 'object' || Array.isArray(rec.payload)) {
      return null
    }
    return { tool, payload: rec.payload as Record<string, unknown> }
  } catch {
    return null
  }
}

export function readControlMcpSinkSync(sinkPath: string): ControlMcpSubmission | null {
  try {
    return parseControlMcpSink(readFileSync(sinkPath, 'utf8'))
  } catch {
    return null
  }
}

export async function readControlMcpSink(sinkPath: string): Promise<ControlMcpSubmission | null> {
  try {
    return parseControlMcpSink(await readFile(sinkPath, 'utf8'))
  } catch {
    return null
  }
}
