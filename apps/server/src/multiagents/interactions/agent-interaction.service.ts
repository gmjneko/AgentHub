import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { MoreThan, Repository } from 'typeorm'
import { setTimeout as delay } from 'node:timers/promises'
import type { AgentInteractionEvent, AgentInteractionResponse } from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'
import { AgentInteraction } from './agent-interaction.entity.js'

export interface InteractionOwner { userId: string; sessionId: string; turnId: string; groupId?: string }

@Injectable()
export class AgentInteractionService implements OnModuleDestroy {
    private readonly shutdown = new AbortController()
    constructor(@InjectRepository(AgentInteraction) private readonly repo: Repository<AgentInteraction>) {}
    onModuleDestroy(): void { this.shutdown.abort() }

    /** Database polling lets a response reach the owner even when REST runs in another worker. */
    async request(owner: InteractionOwner, event: AgentInteractionEvent, signal: AbortSignal): Promise<AgentInteractionResponse> {
        const combined = AbortSignal.any([signal, this.shutdown.signal])
        combined.throwIfAborted()
        const id = event.request.requestId
        await this.repo.save(this.repo.create({ id, ...owner, groupId: owner.groupId ?? null, event, response: null, status: 'pending', expiresAt: new Date(Date.now() + 15 * 60_000) }))
        try {
            while (true) {
                combined.throwIfAborted()
                const row = await this.repo.findOneBy({ id, userId: owner.userId })
                if (!row || row.status === 'closed' || row.expiresAt.getTime() <= Date.now()) throw new Error('Interaction expired')
                if (row.status === 'answered' && row.response) return row.response
                await delay(250, undefined, { signal: combined })
            }
        } finally {
            await this.repo.update({ id, status: 'pending' }, { status: 'closed' })
        }
    }

    async list(userId: string, scope: { sessionId?: string; groupId?: string }): Promise<AgentInteraction[]> {
        if (!scope.sessionId && !scope.groupId) throw BusinessException.badRequest('chatId or groupId is required')
        return this.repo.find({ where: { userId, ...scope, status: 'pending', expiresAt: MoreThan(new Date()) } })
    }

    async respond(userId: string, id: string, response: AgentInteractionResponse): Promise<{ accepted: true }> {
        const row = await this.repo.findOneBy({ id, userId })
        if (!row) throw BusinessException.notFound('Interaction not found')
        if (row.status === 'closed' || row.expiresAt.getTime() <= Date.now()) throw BusinessException.badRequest('Interaction is no longer active')
        if (row.status === 'answered') {
            if (JSON.stringify(row.response) === JSON.stringify(response)) return { accepted: true }
            throw BusinessException.badRequest('Interaction has already been answered')
        }
        const allowed = row.event.type === 'permission_request' ? ['approve', 'deny', 'cancel'] : ['answer', 'cancel']
        if (!allowed.includes(response.decision)) throw BusinessException.badRequest('Invalid interaction decision')
        if (response.decision === 'answer') {
            for (const q of row.event.request.questions ?? []) {
                if (typeof response.answers?.[q.id] !== 'string' || !response.answers[q.id].trim()) throw BusinessException.badRequest(`Missing answer for ${q.id}`)
            }
        }
        const result = await this.repo.update({ id, userId, status: 'pending' }, { status: 'answered', response })
        if (!result.affected) throw BusinessException.badRequest('Interaction has already been answered')
        return { accepted: true }
    }
}
