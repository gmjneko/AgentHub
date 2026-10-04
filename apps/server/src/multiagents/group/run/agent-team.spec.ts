import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BusinessException } from '../../../common/index.js'
import { resolveGroupChatCreate } from './agent-team-create.js'
import { runTeamDiscussion, type TeamSeat } from './agent-team-discussion.js'
import {
    INBOX_CHAR_BUDGET,
    buildTeamTurnPrompt,
    parseTeamReply,
    renderInbox,
    type TeamInboxEntry
} from './agent-team-reply.js'

const leader: TeamSeat = { agentId: 'leader', name: '队长甲', isLeader: true }
const member: TeamSeat = { agentId: 'member', name: '队员乙', isLeader: false }

test('parseTeamReply distinguishes skip, team speech, and a message to the user', () => {
    assert.deepEqual(parseTeamReply('  skip \n'), { kind: 'skip', text: '' })
    assert.deepEqual(parseTeamReply(''), { kind: 'skip', text: '' })
    assert.deepEqual(parseTeamReply('用户\n\n'), { kind: 'skip', text: '' })
    assert.deepEqual(parseTeamReply('先看一下接口'), { kind: 'team', text: '先看一下接口' })
    assert.deepEqual(parseTeamReply('用户\n请确认用 React 还是 Vue'), {
        kind: 'user',
        text: '请确认用 React 还是 Vue'
    })
})

test('renderInbox keeps the newest entries inside the character budget', () => {
    const items: TeamInboxEntry[] = [
        { id: '1', fromName: '用户', text: 'a'.repeat(20) },
        { id: '2', fromName: '队长甲', text: 'b'.repeat(20) },
        { id: '3', fromName: '队员乙', text: 'c'.repeat(20) }
    ]
    const rendered = renderInbox(items, 60)
    assert.equal(rendered.includes('用户'), false)
    assert.equal(rendered.includes('队长甲'), true)
    assert.equal(rendered.includes('队员乙'), true)
    assert.ok(renderInbox(items, INBOX_CHAR_BUDGET).startsWith('用户：'))
})

test('buildTeamTurnPrompt does not mention the control MCP', () => {
    const prompt = buildTeamTurnPrompt({
        groupTitle: '小组',
        projectName: '项目',
        projectGoal: '做一个工具',
        speakerName: '队长甲',
        isLeader: true,
        roster: [
            { name: '队长甲', isLeader: true },
            { name: '队员乙', isLeader: false }
        ],
        inboxText: '用户：\n你好',
        pinnedContext: '',
        nudge: 'none'
    })
    assert.equal(prompt.includes('agenthub_control'), false)
    assert.equal(prompt.includes('submit_member_chat'), false)
    assert.equal(prompt.includes('skip'), true)
    assert.equal(prompt.includes('用户：\n你好'), true)
})

test('resolveGroupChatCreate accepts a standard group and an agent team leader', () => {
    const standard = resolveGroupChatCreate({
        memberAgentIds: ['a'],
        orchestrator: { vendor: 'claude', model: 'm', providerId: 'p' }
    })
    assert.equal(standard.mode, 'standard')
    assert.equal(standard.leaderAgentId, null)

    const team = resolveGroupChatCreate({
        mode: 'agent_team',
        memberAgentIds: ['a', 'b'],
        leaderAgentId: 'b'
    })
    assert.equal(team.mode, 'agent_team')
    assert.equal(team.leaderAgentId, 'b')
    assert.equal(team.orchestrator, null)
})

test('resolveGroupChatCreate rejects an agent team orchestrator and a missing leader', () => {
    assert.throws(
        () =>
            resolveGroupChatCreate({
                mode: 'agent_team',
                memberAgentIds: ['a'],
                leaderAgentId: 'a',
                orchestrator: { vendor: 'claude', model: 'm', providerId: 'p' }
            }),
        (err: unknown) => err instanceof BusinessException
    )
    assert.throws(
        () => resolveGroupChatCreate({ mode: 'agent_team', memberAgentIds: ['a'] }),
        (err: unknown) => err instanceof BusinessException
    )
    assert.throws(
        () =>
            resolveGroupChatCreate({
                mode: 'agent_team',
                memberAgentIds: ['a'],
                leaderAgentId: 'missing'
            }),
        (err: unknown) => err instanceof BusinessException
    )
    assert.throws(
        () => resolveGroupChatCreate({ memberAgentIds: ['a'] }),
        (err: unknown) => err instanceof BusinessException
    )
})

test('team speech is posted and copied to the other member inbox with the speaker name', async () => {
    const store = memoryInbox()
    store.deliver('用户', '你好', null)
    const calls: string[] = []
    let leaderTurns = 0
    const stop = await runTeamDiscussion([leader, member], {
        ...store.io(),
        speak: async (seat, inbox) => {
            calls.push(`${seat.agentId}:${inbox.map((item) => item.fromName).join(',')}`)
            if (seat.agentId === 'leader') {
                leaderTurns += 1
                return leaderTurns === 1 ? '先看接口' : '用户\n先这样'
            }
            return 'skip'
        }
    })
    assert.equal(stop, 'addressed_user')
    assert.deepEqual(store.posts, ['队长甲:先看接口', '队长甲:先这样'])
    assert.equal(calls[0], 'leader:用户')
    assert.equal(calls[1], 'member:用户,队长甲')
    const leaderCopy = store.rows.filter((row) => row.to === 'leader' && row.fromName === '队长甲')
    assert.equal(leaderCopy.length, 0)
    const memberCopy = store.rows.filter((row) => row.to === 'member' && row.fromName === '队长甲')
    assert.deepEqual(
        memberCopy.map((row) => row.text),
        ['先看接口', '先这样']
    )
})

test('skip does not post and does not end the discussion before the leader is asked again', async () => {
    const store = memoryInbox()
    store.deliver('用户', '你好', null)
    const nudges: string[] = []
    const stop = await runTeamDiscussion([leader, member], {
        ...store.io(),
        speak: async (seat, _inbox, nudge) => {
            nudges.push(`${seat.agentId}:${nudge}`)
            if (nudge === 'remind') return '用户\n先做到这里'
            return 'skip'
        }
    })
    assert.equal(stop, 'addressed_user')
    assert.deepEqual(store.posts, ['队长甲:先做到这里'])
    assert.deepEqual(nudges, ['leader:none', 'member:none', 'leader:ask', 'leader:remind'])
})

test('a message to the user is shown without the marker and stops the automatic discussion', async () => {
    const store = memoryInbox()
    store.deliver('用户', '你好', null)
    let memberTurns = 0
    const stop = await runTeamDiscussion([leader, member], {
        ...store.io(),
        speak: async (seat) => {
            if (seat.agentId === 'member') memberTurns += 1
            return '用户\n结论是用 Vue'
        }
    })
    assert.equal(stop, 'addressed_user')
    assert.equal(memberTurns, 0)
    assert.deepEqual(store.posts, ['队长甲:结论是用 Vue'])
    const delivered = store.rows.filter((row) => row.fromName === '队长甲')
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0]?.to, 'member')
    assert.equal(store.unconsumed('leader').length, 0)
})

test('consumed inbox entries are not injected again', async () => {
    const store = memoryInbox()
    store.deliver('用户', '只看一次', null)
    await runTeamDiscussion([leader], {
        ...store.io(),
        speak: async () => '用户\n收到'
    })
    assert.equal(store.unconsumed('leader').length, 0)
    const seen: string[] = []
    store.deliver('队员乙', '补充', 'member')
    await runTeamDiscussion([leader], {
        ...store.io(),
        speak: async (_seat, inbox) => {
            seen.push(renderInbox(inbox))
            return '用户\n好'
        }
    })
    assert.equal(seen[0]?.includes('只看一次'), false)
    assert.equal(seen[0]?.includes('队员乙'), true)
})

test('agent team runtime does not call the orchestrator or the control MCP', () => {
    const run = readFileSync(new URL('./agent-team-run.service.ts', import.meta.url), 'utf8')
    const executor = readFileSync(new URL('./group-run.executor.ts', import.meta.url), 'utf8')
    assert.equal(run.includes('withControlMcp'), false)
    assert.equal(run.includes('agenthub_control'), false)
    assert.match(executor, /group\.mode === 'agent_team'/)
    assert.match(executor, /this\.agentTeam\.run/)
    const start = executor.indexOf("group.mode === 'agent_team'")
    const branch = executor.slice(start, executor.indexOf('} else {', start))
    assert.equal(branch.includes('runOrchestrated'), false)
    assert.match(branch, /agentTeam\.run/)
})

function memoryInbox(): {
    rows: Array<{ id: string; to: string; fromName: string; text: string; consumed: boolean }>
    posts: string[]
    deliver(fromName: string, text: string, exceptAgentId: string | null): void
    unconsumed(agentId: string): TeamInboxEntry[]
    io(): {
        loadInbox(agentId: string): Promise<TeamInboxEntry[]>
        consume(ids: string[]): Promise<void>
        deliver(fromName: string, text: string, exceptAgentId: string): Promise<void>
        postSpeech(seat: TeamSeat, text: string): Promise<void>
        postSystem(text: string): Promise<void>
        aborted(): boolean
    }
} {
    const rows: Array<{
        id: string
        to: string
        fromName: string
        text: string
        consumed: boolean
    }> = []
    const posts: string[] = []
    let nextId = 1
    const recipients = ['leader', 'member']
    const deliver = (fromName: string, text: string, exceptAgentId: string | null): void => {
        for (const to of recipients) {
            if (to === exceptAgentId) continue
            rows.push({ id: String(nextId++), to, fromName, text, consumed: false })
        }
    }
    const unconsumed = (agentId: string): TeamInboxEntry[] =>
        rows
            .filter((row) => row.to === agentId && !row.consumed)
            .map((row) => ({ id: row.id, fromName: row.fromName, text: row.text }))
    return {
        rows,
        posts,
        deliver,
        unconsumed,
        io() {
            return {
                loadInbox: async (agentId) => unconsumed(agentId),
                consume: async (ids) => {
                    for (const row of rows) {
                        if (ids.includes(row.id)) row.consumed = true
                    }
                },
                deliver: async (fromName, text, exceptAgentId) =>
                    deliver(fromName, text, exceptAgentId),
                postSpeech: async (seat, text) => {
                    posts.push(`${seat.name}:${text}`)
                },
                postSystem: async () => undefined,
                aborted: () => false
            }
        }
    }
}
