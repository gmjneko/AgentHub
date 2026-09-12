import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { JwtService } from '@nestjs/jwt'
import type { Redis } from 'ioredis'
import { TtlStore } from './ttl-store.service.js'
import { TokenService } from '../user/auth/token.service.js'
import { ContinuityResolver, type ShortTermBuffer } from '../multiagents/group/routing/continuity-resolver.service.js'
import type { BlackboardService } from '../multiagents/group/blackboard/blackboard.service.js'
import type { GroupDebugLogger } from '../multiagents/group/debug/group-debug-logger.service.js'

test('local token revocation is immediate and expires with the JWT', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 })
    const store = new TtlStore(null)
    t.after(() => store.onModuleDestroy())
    const service = new TokenService(new JwtService({ secret: 'unit-test', signOptions: { expiresIn: '1h' } }), store)
    const issued = await service.issue('user-1')
    const payload = await service.verify(issued.token)
    assert.equal(await service.isRevoked(payload.jti), false)
    await service.revoke(payload)
    assert.equal(await service.isRevoked(payload.jti), true)
    assert.equal(await service.isRevoked('other-token'), false)
    t.mock.timers.tick(3_600_000)
    assert.equal(await service.isRevoked(payload.jti), false)
    await service.revoke(payload)
    assert.equal(await service.isRevoked(payload.jti), false)
})

test('group hot context is isolated by group/member and keeps its five-minute TTL', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 })
    const store = new TtlStore(null)
    t.after(() => store.onModuleDestroy())
    const service = new ContinuityResolver(store, {} as BlackboardService, { log() {} } as unknown as GroupDebugLogger)
    const buffer: ShortTermBuffer = { recentUserIntents: ['continue'], recentAgentOutputs: [], recentArtifacts: [], mentionIndex: {} }
    await service.writeBuffer('group-1', 'agent-1', buffer)
    assert.deepEqual(await service.readBuffer('group-1', 'agent-1'), buffer)
    assert.equal(await service.readBuffer('group-2', 'agent-1'), null)
    assert.equal(await service.readBuffer('group-1', 'agent-2'), null)
    t.mock.timers.tick(299_999)
    assert.deepEqual(await service.readBuffer('group-1', 'agent-1'), buffer)
    t.mock.timers.tick(1)
    assert.equal(await service.readBuffer('group-1', 'agent-1'), null)
})

test('TTL overwrite renews expiry, sweeps unused entries, and clears on destruction', async (t) => {
    t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 1_800_000_000_000 })
    const store = new TtlStore(null)
    t.after(() => store.onModuleDestroy())
    await store.set('key', 'old', 1)
    t.mock.timers.tick(500)
    await store.set('key', 'new', 120)
    await store.set('unused', 'expired', 1)
    t.mock.timers.tick(60_000)
    assert.equal(await store.get('key'), 'new')
    assert.equal(store['entries'].has('unused'), false)
    store.onModuleDestroy()
    assert.equal(await store.get('key'), null)
})

test('Redis TTL store forwards writes with TTL and propagates failures', async () => {
    const calls: unknown[][] = []
    const store = new TtlStore({
        get: async () => 'value',
        set: async (...args: unknown[]) => { calls.push(args) }
    } as unknown as Redis)
    await store.set('key', 'value', 30)
    assert.deepEqual(calls, [['key', 'value', 'EX', 30]])
    assert.equal(await store.get('key'), 'value')
    store.onModuleDestroy()
    const broken = new TtlStore({ get: async () => { throw new Error('Redis unavailable') } } as unknown as Redis)
    await assert.rejects(broken.get('key'), /Redis unavailable/)
    broken.onModuleDestroy()
})
