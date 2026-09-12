import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Redis } from 'ioredis'
import { REDIS_CLIENT } from './redis.tokens.js'
import { createRedisClient } from './redis.config.js'
import { TtlStore } from './ttl-store.service.js'

export { REDIS_CLIENT } from './redis.tokens.js'

@Global()
@Module({
    providers: [
        {
            provide: REDIS_CLIENT,
            inject: [ConfigService],
            useFactory: (config: ConfigService): Redis | null => createRedisClient(config)
        },
        TtlStore
    ],
    exports: [REDIS_CLIENT, TtlStore]
})
export class RedisModule implements OnModuleDestroy {
    constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis | null) {}

    onModuleDestroy(): void {
        this.redis?.disconnect()
    }
}
