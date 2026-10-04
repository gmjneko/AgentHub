type RunEvent = { type: string }

interface RunState<T> {
    owner: string | null
    expiresAt: number
    events: T[]
    firstSequence: number
    completed: boolean
    readers: Set<{ wake(): void; close(): void }>
}

/** Process-local run coordination and bounded replay. No Redis protocol emulation. */
export class MemoryRunStream<T extends RunEvent> {
    private static readonly ACTIVE_TTL_MS = 2 * 60 * 60 * 1000
    private static readonly STREAM_TTL_MS = 60 * 60 * 1000
    private static readonly MAX_EVENTS = 5_000
    private readonly active = new Map<string, { runId: string; expiresAt: number }>()
    private readonly runs = new Map<string, RunState<T>>()
    private readonly timer: ReturnType<typeof setInterval>
    private destroyed = false

    constructor() {
        this.timer = setInterval(() => this.sweep(), 60_000)
        this.timer.unref()
    }

    acquire(owner: string, runId: string): string {
        const current = this.getActive(owner)
        if (current) return current
        const expiresAt = Date.now() + MemoryRunStream.ACTIVE_TTL_MS
        this.active.set(owner, { runId, expiresAt })
        const state = this.state(runId) ?? this.createState(runId)
        state.owner = owner
        state.expiresAt = expiresAt
        return runId
    }

    release(owner: string, runId: string): void {
        if (this.getActive(owner) === runId) this.active.delete(owner)
        // The executor publishes done after releasing the lock. Keep readers alive.
    }

    abandon(owner: string, runId: string): void {
        this.release(owner, runId)
        if (this.state(runId)?.owner === owner) this.remove(runId)
    }

    belongsTo(owner: string, runId: string): boolean {
        return this.state(runId)?.owner === owner
    }

    getActive(owner: string): string | null {
        const entry = this.active.get(owner)
        if (!entry) return null
        if (entry.expiresAt <= Date.now()) {
            this.active.delete(owner)
            return null
        }
        return entry.runId
    }

    getActiveMany(owners: string[]): Map<string, string> {
        const result = new Map<string, string>()
        for (const owner of owners) {
            const runId = this.getActive(owner)
            if (runId) result.set(owner, runId)
        }
        return result
    }

    getActiveByPrefix(prefix: string): Map<string, string> {
        const result = new Map<string, string>()
        for (const [owner] of this.active) {
            if (!owner.startsWith(prefix)) continue
            const runId = this.getActive(owner)
            if (runId) result.set(owner.slice(prefix.length), runId)
        }
        return result
    }

    publish(runId: string, event: T): void {
        if (this.destroyed) return
        const state = this.state(runId) ?? this.createState(runId)
        if (state.completed) return
        state.events.push(event)
        if (state.events.length > MemoryRunStream.MAX_EVENTS) {
            state.events.shift()
            state.firstSequence++
        }
        if (event.type === 'done') state.completed = true
        for (const reader of state.readers) reader.wake()
    }

    finalize(runId: string): void {
        const state = this.state(runId)
        if (!state) return
        state.expiresAt = Date.now() + MemoryRunStream.STREAM_TTL_MS
        state.completed = true
        for (const reader of state.readers) reader.wake()
    }

    subscribe(owner: string, runId: string): AsyncIterable<T> {
        return {
            [Symbol.asyncIterator]: () => {
                const state = this.state(runId)
                let cursor = state?.firstSequence ?? 0
                let closed = this.destroyed || !state || state.owner !== owner
                let pending: ((result: IteratorResult<T>) => void) | undefined
                const end = (): IteratorResult<T> => ({ done: true, value: undefined })
                const close = (): void => {
                    closed = true
                    state?.readers.delete(reader)
                    const resolve = pending
                    pending = undefined
                    resolve?.(end())
                }
                const read = (): IteratorResult<T> | undefined => {
                    if (closed || !state) return end()
                    cursor = Math.max(cursor, state.firstSequence)
                    const event = state.events[cursor - state.firstSequence]
                    if (event) {
                        cursor++
                        if (event.type === 'done') close()
                        return { done: false, value: event }
                    }
                    if (state.completed) {
                        close()
                        return end()
                    }
                    return undefined
                }
                const reader = {
                    close,
                    wake: (): void => {
                        if (!pending) return
                        const resolve = pending
                        pending = undefined
                        const result = read()
                        if (result) resolve(result)
                        else pending = resolve
                    }
                }
                if (!closed) state?.readers.add(reader)
                return {
                    next: (): Promise<IteratorResult<T>> => {
                        const result = read()
                        if (result) return Promise.resolve(result)
                        return new Promise((resolve) => {
                            pending = resolve
                        })
                    },
                    return: async (): Promise<IteratorResult<T>> => {
                        close()
                        return end()
                    }
                }
            }
        }
    }

    destroy(): void {
        this.destroyed = true
        clearInterval(this.timer)
        for (const runId of this.runs.keys()) this.remove(runId)
        this.active.clear()
    }

    private createState(runId: string): RunState<T> {
        const state: RunState<T> = {
            owner: null,
            expiresAt: Date.now() + MemoryRunStream.ACTIVE_TTL_MS,
            events: [],
            firstSequence: 0,
            completed: false,
            readers: new Set()
        }
        this.runs.set(runId, state)
        return state
    }

    private state(runId: string): RunState<T> | undefined {
        const state = this.runs.get(runId)
        if (state && state.expiresAt <= Date.now()) {
            this.remove(runId)
            return undefined
        }
        return state
    }

    private remove(runId: string): void {
        const state = this.runs.get(runId)
        if (!state) return
        for (const reader of state.readers) reader.close()
        this.runs.delete(runId)
    }

    private sweep(): void {
        for (const owner of this.active.keys()) this.getActive(owner)
        for (const runId of this.runs.keys()) this.state(runId)
    }
}
