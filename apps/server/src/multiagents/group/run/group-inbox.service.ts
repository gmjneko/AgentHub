import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, IsNull, Repository } from 'typeorm'
import { GroupInboxMessage } from '../entities/group-inbox-message.entity.js'
import type { TeamInboxEntry } from './agent-team-reply.js'

@Injectable()
export class GroupInboxService {
    constructor(
        @InjectRepository(GroupInboxMessage)
        private readonly inboxRepo: Repository<GroupInboxMessage>
    ) {}

    async deliver(input: {
        groupId: string
        runId: string | null
        fromName: string
        text: string
        recipientAgentIds: string[]
    }): Promise<void> {
        const recipients = [...new Set(input.recipientAgentIds.filter(Boolean))]
        if (recipients.length === 0) return
        await this.inboxRepo.save(
            recipients.map((toAgentId) =>
                this.inboxRepo.create({
                    groupId: input.groupId,
                    runId: input.runId,
                    toAgentId,
                    fromName: input.fromName,
                    text: input.text,
                    consumedAt: null
                })
            )
        )
    }

    async loadUnconsumed(groupId: string, agentId: string): Promise<TeamInboxEntry[]> {
        const rows = await this.inboxRepo.find({
            where: { groupId, toAgentId: agentId, consumedAt: IsNull() },
            order: { createdAt: 'ASC', id: 'ASC' }
        })
        return rows.map((row) => ({ id: row.id, fromName: row.fromName, text: row.text }))
    }

    async consume(ids: string[]): Promise<void> {
        if (ids.length === 0) return
        await this.inboxRepo.update({ id: In(ids) }, { consumedAt: new Date() })
    }
}
