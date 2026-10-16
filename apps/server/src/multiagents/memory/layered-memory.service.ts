import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import type {
    CreateLayeredMemoryPayload,
    LayeredMemoryItem,
    LayeredMemorySourceType,
    LayeredMemoryType,
    ListLayeredMemoryQuery
} from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'
import { LayeredMemoryItemEntity } from './entities/layered-memory-item.entity.js'
import {
    memoryTypeMatchesLayer,
    normalizeMemoryContent,
    renderLayeredMemoryPrompt,
    selectPromptMemories,
    type PromptMemory
} from './layered-memory.logic.js'
import { workspaceMemoryKey } from './workspace-memory-key.js'

const CONTENT_LIMIT = 4_000

@Injectable()
export class LayeredMemoryService {
    constructor(
        @InjectRepository(LayeredMemoryItemEntity)
        private readonly repo: Repository<LayeredMemoryItemEntity>
    ) {}

    async list(userId: string, query: ListLayeredMemoryQuery = {}): Promise<LayeredMemoryItem[]> {
        const workspaceKey = query.workspaceDir
            ? await workspaceMemoryKey(query.workspaceDir)
            : null
        const rows = await this.repo.find({
            where: { userId, status: 'active' },
            order: { createdAt: 'DESC' }
        })
        return rows
            .filter((row) => {
                if (query.layer && row.layer !== query.layer) return false
                if (
                    query.layer === 'workspace' &&
                    workspaceKey &&
                    row.workspaceKey !== workspaceKey
                )
                    return false
                if (
                    !query.layer &&
                    workspaceKey &&
                    row.layer === 'workspace' &&
                    row.workspaceKey !== workspaceKey
                ) {
                    return false
                }
                return true
            })
            .map(toView)
    }

    async create(userId: string, payload: CreateLayeredMemoryPayload): Promise<LayeredMemoryItem> {
        if (!memoryTypeMatchesLayer(payload.layer, payload.type)) {
            throw BusinessException.badRequest('Memory type does not match its layer')
        }
        const content = requireContent(payload.content)
        const workspaceKey =
            payload.layer === 'workspace'
                ? await workspaceMemoryKey(payload.workspaceDir ?? '')
                : null
        const saved = await this.insert(userId, {
            layer: payload.layer,
            type: payload.type,
            workspaceKey,
            content,
            sourceType: 'user',
            sourceRef: null
        })
        if (!saved) throw BusinessException.badRequest('The same memory already exists')
        return saved
    }

    async remove(userId: string, id: string): Promise<void> {
        const row = await this.repo.findOne({ where: { id, userId } })
        if (!row) throw BusinessException.notFound('Memory not found')
        await this.repo.delete({ id, userId })
    }

    async writeLongTerm(
        userId: string,
        type: 'preference' | 'code_style',
        content: string,
        source: { type: LayeredMemorySourceType; ref?: string | null }
    ): Promise<LayeredMemoryItem | null> {
        return this.insert(userId, {
            layer: 'long_term',
            type,
            workspaceKey: null,
            content: requireContent(content),
            sourceType: source.type,
            sourceRef: source.ref ?? null
        })
    }

    async writeWorkspace(
        userId: string,
        workspaceDir: string,
        type: 'convention' | 'decision',
        content: string,
        source: { type: LayeredMemorySourceType; ref?: string | null }
    ): Promise<LayeredMemoryItem | null> {
        return this.insert(userId, {
            layer: 'workspace',
            type,
            workspaceKey: await workspaceMemoryKey(workspaceDir),
            content: requireContent(content),
            sourceType: source.type,
            sourceRef: source.ref ?? null
        })
    }

    /** Text block injected into a model prompt. Empty when the user has no matching memory. */
    async promptBlock(userId: string, workspaceDir: string | null | undefined): Promise<string> {
        const workspaceKey = workspaceDir?.trim() ? await workspaceMemoryKey(workspaceDir) : null
        const rows = await this.repo.find({ where: { userId, status: 'active' } })
        const selected = selectPromptMemories(rows.map(toPromptMemory), workspaceKey)
        const text = renderLayeredMemoryPrompt(selected)
        if (selected.length) {
            await this.repo.update(
                { id: In(selected.map((item) => item.id)) },
                { lastUsedAt: new Date() }
            )
        }
        return text
    }

    private async insert(
        userId: string,
        input: {
            layer: LayeredMemoryItemEntity['layer']
            type: LayeredMemoryType
            workspaceKey: string | null
            content: string
            sourceType: LayeredMemorySourceType
            sourceRef: string | null
        }
    ): Promise<LayeredMemoryItem | null> {
        const normalized = normalizeMemoryContent(input.content)
        const existing = await this.repo.find({
            where: { userId, layer: input.layer, type: input.type, status: 'active' }
        })
        const sameKey = existing.filter((row) => (row.workspaceKey ?? null) === input.workspaceKey)
        if (sameKey.some((row) => normalizeMemoryContent(row.content) === normalized)) return null
        const saved = await this.repo.save(
            this.repo.create({
                userId,
                layer: input.layer,
                type: input.type,
                workspaceKey: input.workspaceKey,
                content: input.content.trim(),
                sourceType: input.sourceType,
                sourceRef: input.sourceRef,
                status: 'active',
                lastUsedAt: null
            })
        )
        return toView(saved)
    }
}

function requireContent(content: string): string {
    const trimmed = content.trim()
    if (!trimmed) throw BusinessException.badRequest('Memory content cannot be empty')
    if (trimmed.length > CONTENT_LIMIT) {
        throw BusinessException.badRequest(
            `Memory content cannot exceed ${CONTENT_LIMIT} characters`
        )
    }
    return trimmed
}

function toView(row: LayeredMemoryItemEntity): LayeredMemoryItem {
    return {
        id: row.id,
        layer: row.layer,
        type: row.type,
        workspaceKey: row.workspaceKey,
        content: row.content,
        sourceType: row.sourceType,
        sourceRef: row.sourceRef,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null
    }
}

function toPromptMemory(row: LayeredMemoryItemEntity): PromptMemory {
    return {
        id: row.id,
        layer: row.layer,
        type: row.type,
        workspaceKey: row.workspaceKey,
        content: row.content,
        lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
        createdAt: row.createdAt.toISOString()
    }
}
