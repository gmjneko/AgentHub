import { randomUUID } from 'node:crypto'
import type { AgentEvent, AgentVendor, SendOptions } from './types.js'

/** One terminal result, including EOF/throw/abort. Text and tool identity are stable. */
export async function* normalizeEvents(vendor: AgentVendor, source: AsyncIterable<AgentEvent>, options?: SendOptions): AsyncGenerator<AgentEvent> {
  const turnId = options?.turnId ?? randomUUID()
  let failed = false
  let completed: Extract<AgentEvent, { type: 'turn_completed' }> | undefined
  let done: Extract<AgentEvent, { type: 'done' }> | undefined
  let lastText: string | undefined
  let textSeq = 0
  const tools = new Map<string, Extract<AgentEvent, { type: 'tool_use' }>>()
  const results = new Set<string>()
  yield { type: 'turn_started', vendor, turnId }
  try {
    for await (const original of source) {
      let event = { ...original, turnId }
      if (event.type === 'turn_started') continue
      if (event.type === 'error' && event.fatal) failed = true
      if (event.type === 'turn_completed') { completed = event; if (event.success === false) failed = true; continue }
      if (event.type === 'done') { done = event; break }
      if (event.type === 'text') lastText = event.text
      if (event.type === 'text' || event.type === 'thinking' || event.type === 'progress') event.itemId ??= `${turnId}:text:${textSeq++}`
      if (event.type === 'tool_use') {
        event.itemId ??= event.id
        const previous = tools.get(event.id)
        if (results.has(event.id)) continue
        if (!previous && event.status !== 'started') yield { ...event, status: 'started' }
        if (previous && JSON.stringify(previous) === JSON.stringify(event)) continue
        tools.set(event.id, event)
      }
      if (event.type === 'tool_result') {
        if (results.has(event.toolUseId)) continue
        event.itemId ??= event.toolUseId
        const previous = tools.get(event.toolUseId)
        if (!previous) yield { type: 'tool_use', vendor, turnId, id: event.toolUseId, itemId: event.toolUseId, name: 'unknown', input: null, status: 'started' }
        yield { ...(previous ?? { type: 'tool_use', vendor, id: event.toolUseId, name: 'unknown', input: null }), turnId, itemId: event.toolUseId, status: event.isError ? 'failed' : 'completed' }
        results.add(event.toolUseId)
      }
      yield event
    }
  } catch (error) {
    failed = true
    yield { type: 'error', vendor, turnId, fatal: true, message: error instanceof Error ? error.message : String(error), code: (error as { code?: string })?.code }
  }
  if (!completed && !failed) {
    failed = true
    yield { type: 'error', vendor, turnId, fatal: true, code: 'INCOMPLETE_STREAM', message: 'Agent stream ended without a terminal turn result' }
  }
  const success = !failed && done?.success === true && !options?.signal?.aborted
  for (const tool of tools.values()) {
    if (tool.status === 'started' && !results.has(tool.id)) {
      yield { ...tool, turnId, status: 'failed' }
      yield { type: 'tool_result', vendor, turnId, toolUseId: tool.id, output: 'Tool ended without a result', isError: true }
    }
  }
  const finalText = done?.finalText ?? completed?.finalText ?? lastText
  const structuredOutput = done?.structuredOutput ?? completed?.structuredOutput
  const usage = done?.usage ?? completed?.usage
  yield { type: 'turn_completed', vendor, turnId, success, finalText, structuredOutput, usage }
  yield { type: 'done', vendor, turnId, success, finalText, structuredOutput, usage }
}

/** A bounded-lifetime queue merges SDK callbacks with its async message stream. */
export class EventQueue<T> implements AsyncIterable<T> {
  private values: T[] = []
  private wake?: () => void
  private ended = false
  push(value: T): void { if (!this.ended) { this.values.push(value); this.wake?.() } }
  close(): void { this.ended = true; this.wake?.() }
  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.values.length) { yield this.values.shift()!; continue }
      if (this.ended) return
      await new Promise<void>(resolve => { this.wake = resolve })
      this.wake = undefined
    }
  }
}
