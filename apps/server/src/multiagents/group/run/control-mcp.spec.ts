import { strict as assert } from 'node:assert'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import {
    applyControlMcpConfig,
    collectControlMcpSubmission,
    mergeControlAllowedTools,
    parseControlMcpMailboxRequest,
    parseControlMcpMailboxResponse,
    parseControlMcpSink,
    parseControlMcpToolName,
    readControlMcpMailboxRequest,
    writeControlMcpMailboxResponse,
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
    assert.equal(parseControlMcpToolName('mcp__agenthub_control__report_for_orchestrator'), 'report_for_orchestrator')
    assert.equal(parseControlMcpToolName('mcp:agenthub_control/send_to_member'), 'send_to_member')
    assert.equal(parseControlMcpToolName('ask_user'), 'ask_user')
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
    assert.deepEqual(
        mergeControlAllowedTools(
            'claude',
            ['Read'],
            ['mcp__agenthub_control__send_to_member'],
            'mailbox'
        ),
        ['mcp__agenthub_control__send_to_member']
    )
})

test('mailbox mode does not put Codex in a read-only plan sandbox', () => {
    const session = {
        mcpServers: {},
        claudeAllowedTools: [],
        mailboxDir: '/tmp',
        readSink: async () => null,
        collectFromEvents: () => null,
        resolve: async () => null,
        watchMailbox: async () => undefined
    }
    const base = {
        id: 'orch',
        agentHomeDirectory: '/tmp/home',
        workingDirectory: '/tmp/work',
        apiKey: 'test-key',
        permissionMode: 'default' as const,
        mcpServers: {}
    }
    const mailbox = applyControlMcpConfig(base, 'codex', session, 'mailbox')
    const controlOnly = applyControlMcpConfig(base, 'codex', session, 'control-only')
    assert.equal(mailbox.permissionMode, 'bypassPermissions')
    assert.equal(controlOnly.permissionMode, 'plan')
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

test('mailbox request and response records round-trip', () => {
    const request = parseControlMcpMailboxRequest(
        JSON.stringify({
            id: 'req-1',
            tool: 'report_for_orchestrator',
            payload: { kind: 'question', text: '用 mock 吗？' },
            at: '2026-01-01T00:00:00.000Z'
        })
    )
    assert.equal(request?.id, 'req-1')
    assert.equal(request?.payload.text, '用 mock 吗？')
    assert.equal(parseControlMcpMailboxRequest(JSON.stringify({ id: 'x', tool: 'ask_user' })), null)
    const response = parseControlMcpMailboxResponse(
        JSON.stringify({ id: 'req-1', text: '先用 mock', action: 'continue' })
    )
    assert.deepEqual(response, { id: 'req-1', text: '先用 mock', action: 'continue' })
})

test('control MCP stdio server blocks report_for_orchestrator until mailbox reply', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agenthub-control-mailbox-'))
    const sink = join(dir, 'sink.json')
    const mailbox = join(dir, 'mailbox')
    const coreEntry = fileURLToPath(import.meta.resolve('@agenthub/agent-core'))
    const stdio = join(dirname(coreEntry), 'control-mcp/stdio-server.js')
    const child = spawn(process.execPath, [stdio], {
        env: {
            ...process.env,
            AGENTHUB_CONTROL_SINK: sink,
            AGENTHUB_CONTROL_TOOLS: 'report_for_orchestrator',
            AGENTHUB_CONTROL_MAILBOX: mailbox,
            AGENTHUB_CONTROL_MAILBOX_TIMEOUT_MS: '4000'
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
                clientInfo: { name: 'control-mcp-mailbox-spec', version: '0.0.0' }
            }
        })
        await waitForFrame(frames, (text) => text.includes('"id":1'))
        send({ jsonrpc: '2.0', method: 'notifications/initialized' })
        send({
            jsonrpc: '2.0',
            id: 2,
            method: 'tools/call',
            params: {
                name: 'report_for_orchestrator',
                arguments: { kind: 'progress', text: '方案写了一半' }
            }
        })
        const request = await waitForMailboxRequest(mailbox)
        writeControlMcpMailboxResponse(mailbox, {
            id: request.id,
            text: '继续完成方案',
            action: 'continue'
        })
        await waitForFrame(frames, (text) => text.includes('"id":2') && text.includes('继续完成方案'))
    } finally {
        child.kill()
        await rm(dir, { recursive: true, force: true })
    }
})

async function waitForMailboxRequest(mailboxDir: string): Promise<{ id: string }> {
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
        const request = readControlMcpMailboxRequest(mailboxDir)
        if (request) return request
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('Mailbox request was not written')
}

async function waitForFrame(frames: string[], match: (text: string) => boolean): Promise<void> {
    const deadline = Date.now() + 4000
    while (Date.now() < deadline) {
        if (match(frames.join(''))) return
        await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error(`MCP stdio server did not respond: ${frames.join('')}`)
}
