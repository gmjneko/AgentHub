import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ConfigService } from '@nestjs/config'
import type { Redis } from 'ioredis'
import { createRedisClient, isRedisEnabled, serverListenHost } from './redis.config.js'

function configuration(values: Record<string, unknown> = {}): ConfigService {
    const config = new ConfigService(values)
    return config
}

test('Redis is disabled by default and binds local host', () => {
    const config = configuration()
    assert.equal(isRedisEnabled(config), false)
    assert.equal(serverListenHost(config), '127.0.0.1')
})

test('Redis can be explicitly enabled', () => {
    const config = configuration({ REDIS_ENABLED: 'true' })
    assert.equal(isRedisEnabled(config), true)
    assert.equal(serverListenHost(config), undefined)
})

test('invalid Redis switch fails fast', () => {
    for (const value of ['yes', '1', '', 'TRUE', ' false ', true]) {
        assert.throws(() => isRedisEnabled(configuration({ REDIS_ENABLED: value })), /REDIS_ENABLED/)
    }
})

test('disabled and invalid modes never construct a Redis client', () => {
    const unexpected = (): never => assert.fail('Redis client must not be constructed')
    assert.equal(createRedisClient(configuration(), unexpected), null)
    assert.equal(createRedisClient(configuration({ REDIS_ENABLED: 'false' }), unexpected), null)
    assert.throws(
        () => createRedisClient(configuration({ REDIS_ENABLED: 'invalid' }), unexpected),
        /REDIS_ENABLED/
    )
})

test('enabled mode passes connection options and never falls back on factory failure', () => {
    const config = configuration({ REDIS_ENABLED: 'true', REDIS_PORT: 6380 })
    const client = {} as Redis
    assert.equal(createRedisClient(config, (options) => {
        assert.equal(options.port, 6380)
        assert.equal(options.lazyConnect, false)
        return client
    }), client)
    assert.throws(() => createRedisClient(config, () => { throw new Error('unavailable') }), /unavailable/)
})
