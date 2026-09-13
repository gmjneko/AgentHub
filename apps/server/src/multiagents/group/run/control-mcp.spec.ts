import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
    collectControlMcpSubmission,
    mergeControlAllowedTools,
    parseControlMcpSink,
    parseControlMcpToolName,
    type AgentEvent
} from '../../adapter/index.js'

test('parseControlMcpToolName accepts Claude, Codex and short names', () => {
    assert.equal(parseControlMcpToolName('submit_orchestrator_plan'), 'submit_orchestrator_plan')
    assert.equal(
        parseControlMcpToolName('mcp__agenthub_control__submit_final_review'),
        'submit_final_review'
    )
    assert.equal(
        parseControlMcpToolName('mcp:agenthub_control/submit_member_report'),
        'submit_member_report'
    )
    assert.equal(parseControlMcpToolName('Read'), null)
})

test('collectControlMcpSubmission prefers the last matching tool_use payload', () => {
    const events: AgentEvent[] = [
        {
            type: 'tool_use',
            vendor: 'claude',
            id: '1',
            name: 'mcp__agenthub_control__submit_orchestrator_plan',
            input: { tasks: [], note: 'first' },
            status: 'started',
            kind: 'mcp',
            mcp: { server: 'agenthub_control', tool: 'submit_orchestrator_plan' }
        },
        {
            type: 'tool_use',
            vendor: 'codex',
            id: '2',
            name: 'mcp:agenthub_control/submit_orchestrator_plan',
            input: { tasks: [], note: 'second' },
            status: 'completed',
            kind: 'mcp',
            mcp: { server: 'agenthub_control', tool: 'submit_orchestrator_plan' }
        }
    ]
    const found = collectControlMcpSubmission(events, ['submit_orchestrator_plan'])
    assert.deepEqual(found?.payload, { tasks: [], note: 'second' })
})

test('parseControlMcpSink rejects malformed records', () => {
    assert.equal(parseControlMcpSink('not-json'), null)
    assert.deepEqual(
        parseControlMcpSink(
            JSON.stringify({
                tool: 'submit_member_chat',
                payload: { text: 'hello' }
            })
        ),
        { tool: 'submit_member_chat', payload: { text: 'hello' } }
    )
})

test('mergeControlAllowedTools keeps Codex unrestricted and merges Claude lists', () => {
    assert.equal(
        mergeControlAllowedTools('codex', ['Read'], ['mcp__agenthub_control__submit_member_report'], 'control-only'),
        undefined
    )
    assert.deepEqual(
        mergeControlAllowedTools(
            'claude',
            ['Read'],
            ['mcp__agenthub_control__submit_member_report'],
            'merge'
        ),
        ['Read', 'mcp__agenthub_control__submit_member_report']
    )
    assert.equal(
        mergeControlAllowedTools(
            'claude',
            undefined,
            ['mcp__agenthub_control__submit_member_chat'],
            'merge'
        ),
        undefined
    )
})

test('control MCP stdio server writes the sink file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agenthub-control-test-'))
    const sink = join(dir, 'sink.json')
    const coreEntry = fileURLToPath(import.meta.resolve('@agenthub/agent-core'))
    const stdio = join(dirname(coreEntry), 'control-mcp/stdio-server.js')
    const child = spawn(process.execPath, [stdio], {
        env: {
            ...process.env,
            AGENTHUB_CONTROL_SINK: sink,
            AGENTHUB_CONTROL_TOOLS: 'submit_member_chat'
        },
        stdio: ['pipe', 'pipe', 'pipe']
    })
    const frames: string[] = []
    child.stdout?.on('data', (chunk: Buffer) => {
        frames.push(chunk.toString('utf8'))
    })
    const send = (message: unknown) => {
        child.stdin?.write(`${JSON.stringify(message)}\n`)
    }
    try {
        send({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: '2024-11-05',
                capabilities: {},
                clientInfo: { name: 'control-mcp-spec', version: '0.0.0' }
            }
        })
        await waitForFrame(frames, (text) => text.includes('"id":1'))
        send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: { name: 'submit_member_chat', arguments: { text: 'hello from mcp' } }
        })
        await waitForFrame(frames, (text) => text.includes('"id":2'))
        const written = parseControlMcpSink(await readFile(sink, 'utf8'))
        assert.deepEqual(written?.payload, { text: 'hello from mcp' })
        assert.equal(written?.tool, 'submit_member_chat')
    } finally {
        child.kill()
        await rm(dir, { recursive: true, force: true })
    }
})

async function waitForFrame(frames: string[], match: (text: string) => boolean): Promise<void> {
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
        if (match(frames.join(''))) return
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`MCP stdio server did not respond: ${frames.join('')}`)
}
