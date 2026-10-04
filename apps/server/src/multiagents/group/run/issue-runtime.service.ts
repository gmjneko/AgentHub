import { Injectable, Logger } from '@nestjs/common'
import type { CreateGroupIssueCommentPayload } from '@agenthub/shared'
import { GroupChat } from '../entities/group-chat.entity.js'
import { GroupIssueService } from '../group-issue.service.js'
import { GroupRunExecutor } from './group-run.executor.js'

@Injectable()
export class IssueRuntimeService {
    private readonly logger = new Logger(IssueRuntimeService.name)
    private readonly active = new Set<string>()
    private readonly pending = new Map<string, { userId: string; text: string; mentions: string[] }>()

    constructor(
        private readonly issues: GroupIssueService,
        private readonly executor: GroupRunExecutor
    ) {}

    trigger(group: GroupChat, userId: string, issueId: string, text: string, mentions: string[] = []): void {
        const key = `${group.id}:${issueId}`
        if (this.active.has(key)) {
            this.pending.set(key, { userId, text, mentions })
            return
        }
        this.active.add(key)
        void this.run(group, userId, issueId, text, mentions, key)
    }

    async createIssueRun(group: GroupChat, userId: string, issueId: string, text: string): Promise<void> {
        this.trigger(group, userId, issueId, text, [])
    }

    private async run(
        group: GroupChat,
        userId: string,
        issueId: string,
        text: string,
        mentions: string[],
        key: string
    ): Promise<void> {
        try {
            await this.executor.startIssueRun(group, userId, issueId, text, mentions)
        } catch (error) {
            this.logger.error(`Issue ${issueId} run failed: ${this.errMsg(error)}`)
        } finally {
            this.active.delete(key)
            const next = this.pending.get(key)
            this.pending.delete(key)
            if (next) this.trigger(group, next.userId, issueId, next.text, next.mentions)
        }
    }

    async addCommentAndTrigger(
        group: GroupChat,
        userId: string,
        issueId: string,
        payload: CreateGroupIssueCommentPayload
    ): Promise<void> {
        const comment = await this.issues.addUserComment(group, userId, issueId, payload)
        const issue = await this.issues.get(group, issueId)
        const targets = comment.mentions.length > 0 ? comment.mentions : issue.assigneeType === 'agent' && issue.assigneeId ? [issue.assigneeId] : ['orchestrator']
        this.trigger(group, userId, issueId, comment.body, targets)
    }

    private errMsg(error: unknown): string {
        return error instanceof Error ? error.message : String(error)
    }
}
