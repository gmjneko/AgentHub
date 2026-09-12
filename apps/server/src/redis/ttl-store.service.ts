import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from './redis.tokens.js'

/** Small expiring string store shared by auth revocations and group hot context. */
@Injectable()
export class TtlStore implements OnModuleDestroy {
    private readonly entries = new Map<string, { value: string; expiresAt: number }>()
    private readonly timer: ReturnType<typeof setInterval> | undefined

    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {
        if (!redis) {
            this.timer = setInterval(() => this.sweep(), 60_000)
            this.timer.unref()
        }
    }

    async get(key: string): Promise<string | null> {
        if (this.redis) return this.redis.get(key)
        const entry = this.entries.get(key)
        if (!entry) return null
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(key)
            return null
        }
        return entry.value
    }

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
        if (ttlSeconds <= 0) return
        if (this.redis) {
            await this.redis.set(key, value, 'EX', ttlSeconds)
            return
        }
        this.entries.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 })
    }

    private sweep(): void {
        const now = Date.now()
        for (const [key, entry] of this.entries) {
            if (entry.expiresAt <= now) this.entries.delete(key)
        }
    }

    onModuleDestroy(): void {
        clearInterval(this.timer)
        this.entries.clear()
    }
}
