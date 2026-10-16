import { mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
    renderLayeredMemoryPrompt,
    routeMemoryCandidate,
    selectPromptMemories,
    type PromptMemory
} from './layered-memory.logic.js'
import { workspaceMemoryKey } from './workspace-memory-key.js'

test('routeMemoryCandidate sends preferences to long-term memory and conventions to the workspace', () => {
    assert.deepEqual(routeMemoryCandidate('preference'), { kind: 'long_term', type: 'preference' })
    assert.deepEqual(routeMemoryCandidate('code_style'), { kind: 'long_term', type: 'code_style' })
    assert.deepEqual(routeMemoryCandidate('convention'), { kind: 'workspace', type: 'convention' })
    assert.deepEqual(routeMemoryCandidate('decision'), { kind: 'workspace', type: 'decision' })
    assert.deepEqual(routeMemoryCandidate('lesson'), { kind: 'private', type: 'lesson' })
    assert.deepEqual(routeMemoryCandidate(undefined), { kind: 'private', type: 'lesson' })
})

test('selectPromptMemories reuses long-term memory across workspaces and workspace memory only for the same directory', () => {
    const items: PromptMemory[] = [
        memory('pref', 'long_term', 'preference', null, '用中文回复'),
        memory('style', 'long_term', 'code_style', null, '使用 2 空格'),
        memory('conv', 'workspace', 'convention', '/work/app', '接口放在 src/api'),
        memory('other', 'workspace', 'decision', '/work/other', '另一目录的决策')
    ]
    const selected = selectPromptMemories(items, '/work/app')
    assert.deepEqual(
        selected.map((item) => item.id),
        ['pref', 'style', 'conv']
    )
    const elsewhere = selectPromptMemories(items, '/work/elsewhere')
    assert.deepEqual(
        elsewhere.map((item) => item.id),
        ['pref', 'style']
    )
    const rendered = renderLayeredMemoryPrompt(selected)
    assert.equal(rendered.includes('长期记忆'), true)
    assert.equal(rendered.includes('用中文回复'), true)
    assert.equal(rendered.includes('工作区记忆'), true)
    assert.equal(rendered.includes('接口放在 src/api'), true)
    assert.equal(rendered.includes('另一目录的决策'), false)
})

test('workspaceMemoryKey matches a directory and its symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agenthub-memory-'))
    const real = join(root, 'workspace')
    const link = join(root, 'link')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(real)
    await symlink(real, link)
    try {
        assert.equal(await workspaceMemoryKey(real), await workspaceMemoryKey(link))
        assert.equal(await workspaceMemoryKey(join(root, 'missing')), join(root, 'missing'))
    } finally {
        await rm(root, { recursive: true, force: true })
    }
})

function memory(
    id: string,
    layer: PromptMemory['layer'],
    type: PromptMemory['type'],
    workspaceKey: string | null,
    content: string
): PromptMemory {
    return {
        id,
        layer,
        type,
        workspaceKey,
        content,
        lastUsedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z'
    }
}
