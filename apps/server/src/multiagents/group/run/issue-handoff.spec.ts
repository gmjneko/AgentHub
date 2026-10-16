import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { parseMentionTokens } from '../routing/mention-tokens.js'
import {
    ISSUE_HANDOFF_LIMIT,
    collectIssueHandoff,
    renderIssueRosterPrompt
} from './issue-handoff.js'

const members = [
    { agentId: 'dev', name: '开发Agent' },
    { agentId: 'test', name: '测试Agent' }
]

test('parseMentionTokens resolves an agent name and ignores the author when collecting a handoff', () => {
    assert.deepEqual(parseMentionTokens('接下来 @测试Agent 进行后续的测试', members), ['test'])
    const handoff = collectIssueHandoff({
        comments: [
            {
                authorAgentId: 'dev',
                authorRole: 'agent',
                body: '接口已完成。接下来 @测试Agent 进行后续的测试'
            }
        ],
        members,
        alreadyRan: ['dev'],
        depth: 0
    })
    assert.deepEqual(handoff, {
        mentions: ['test'],
        text: '接口已完成。接下来 @测试Agent 进行后续的测试'
    })
})

test('collectIssueHandoff skips the author and anyone who already ran in this issue run', () => {
    assert.equal(
        collectIssueHandoff({
            comments: [
                { authorAgentId: 'dev', authorRole: 'agent', body: '接下来 @开发Agent 再看一眼' }
            ],
            members,
            alreadyRan: ['dev'],
            depth: 0
        }),
        null
    )
    assert.equal(
        collectIssueHandoff({
            comments: [
                {
                    authorAgentId: 'dev',
                    authorRole: 'agent',
                    body: '接下来 @测试Agent 进行后续的测试'
                }
            ],
            members,
            alreadyRan: ['dev', 'test'],
            depth: 0
        }),
        null
    )
})

test('collectIssueHandoff stops after the handoff limit', () => {
    const stopped = collectIssueHandoff({
        comments: [
            { authorAgentId: 'dev', authorRole: 'agent', body: '接下来 @测试Agent 进行后续的测试' }
        ],
        members,
        alreadyRan: ['dev'],
        depth: ISSUE_HANDOFF_LIMIT
    })
    assert.deepEqual(stopped, { limitReached: true })
    const allowed = collectIssueHandoff({
        comments: [
            { authorAgentId: 'dev', authorRole: 'agent', body: '接下来 @测试Agent 进行后续的测试' }
        ],
        members,
        alreadyRan: ['dev'],
        depth: ISSUE_HANDOFF_LIMIT - 1
    })
    assert.equal(allowed && 'mentions' in allowed && allowed.mentions[0], 'test')
})

test('renderIssueRosterPrompt tells the member how to mention the next agent', () => {
    const prompt = renderIssueRosterPrompt([
        { agentId: 'test', name: '测试Agent', roleInGroup: '测试', capabilitySummary: '写测试' }
    ])
    assert.equal(prompt.includes('测试Agent'), true)
    assert.equal(prompt.includes('接下来 @名称'), true)
    assert.equal(prompt.includes('不要 @ 自己'), true)
})
