import type { ConfigService } from '@nestjs/config'
import { Redis, type RedisOptions } from 'ioredis'

export function isRedisEnabled(config: ConfigService): boolean {
    const value = config.get<string>('REDIS_ENABLED', 'false')
    if (value !== 'true' && value !== 'false') {
        throw new Error('REDIS_ENABLED must be "true" or "false"')
    }
    return value === 'true'
}

/** undefined preserves Nest's existing all-interface listen behavior. */
export function serverListenHost(config: ConfigService): string | undefined {
    return isRedisEnabled(config) ? undefined : '127.0.0.1'
}

export function createRedisClient(
    config: ConfigService,
    create: (options: RedisOptions) => Redis = (options) => new Redis(options)
): Redis | null {
    if (!isRedisEnabled(config)) return null
    return create({
        host: config.get<string>('REDIS_HOST', '127.0.0.1'),
        port: config.get<number>('REDIS_PORT', 6379),
        password: config.get<string>('REDIS_PASSWORD') || undefined,
        db: config.get<number>('REDIS_DB', 0),
        lazyConnect: false,
        maxRetriesPerRequest: 3
    })
}
