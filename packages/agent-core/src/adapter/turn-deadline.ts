/** Execution budget excludes time spent waiting for the user. Cancellation still applies. */
export class TurnDeadline {
  private readonly abort = new AbortController()
  readonly signal: AbortSignal
  readonly expired: Promise<never>
  private reject!: (error: Error) => void
  private timer?: ReturnType<typeof setTimeout>
  private remaining: number
  private started = 0
  private waits = 0
  constructor(milliseconds: number, signal: AbortSignal) {
    this.remaining = milliseconds
    this.signal = AbortSignal.any([signal, this.abort.signal])
    this.expired = new Promise<never>((_, reject) => { this.reject = reject })
    void this.expired.catch(() => undefined)
    this.arm()
  }
  private arm(): void {
    if (this.remaining <= 0) return
    this.started = Date.now()
    this.timer = setTimeout(() => {
      this.abort.abort()
      this.reject(new Error('Agent turn timed out'))
    }, this.remaining)
    this.timer.unref?.()
  }
  async waitForInput<T>(operation: () => Promise<T>): Promise<T> {
    if (this.waits++ === 0 && this.timer) {
      clearTimeout(this.timer)
      this.timer = undefined
      this.remaining = Math.max(1, this.remaining - (Date.now() - this.started))
    }
    try { return await operation() }
    finally { if (--this.waits === 0 && !this.signal.aborted) this.arm() }
  }
  close(): void { if (this.timer) clearTimeout(this.timer); this.abort.abort() }
}
