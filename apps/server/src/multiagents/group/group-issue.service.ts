import { Injectable } from '@nestjs/common'
import { InjectRepository } from '@nestjs/typeorm'
import { In, Repository } from 'typeorm'
import type {
    CreateGroupIssueCommentPayload,
    CreateGroupIssuePayload,
    GroupIssueCommentView,
    GroupIssueView,
    UpdateGroupIssuePayload
} from '@agenthub/shared'
import { BusinessException } from '../../common/index.js'
import { GroupChat } from './entities/group-chat.entity.js'
import { GroupChatMember } from './entities/group-chat-member.entity.js'
import { GroupIssue } from './entities/group-issue.entity.js'
import { GroupIssueComment } from './entities/group-issue-comment.entity.js'
import { GroupMessageService } from './group-message.service.js'
import { toGroupIssueCommentView, toGroupIssueView } from './mappers/group-issue.mapper.js'
import { GroupRunStream } from './run/group-run-stream.service.js'

@Injectable()
export class GroupIssueService {
    constructor(
        @InjectRepository(GroupIssue) private readonly issueRepo: Repository<GroupIssue>,
        @InjectRepository(GroupIssueComment)
        private readonly commentRepo: Repository<GroupIssueComment>,
        @InjectRepository(GroupChatMember)
        private readonly memberRepo: Repository<GroupChatMember>,
        private readonly messages: GroupMessageService,
        private readonly runStream: GroupRunStream
    ) {}

    async list(group: GroupChat, status?: string, assigneeId?: string): Promise<GroupIssueView[]> {
        const where: Record<string, unknown> = { groupChatId: group.id, userId: group.userId }
        if (status) where.status = status
        if (assigneeId) where.assigneeId = assigneeId
        const issues = await this.issueRepo.find({ where, order: { updatedAt: 'DESC' } })
        return Promise.all(issues.map((issue) => this.view(issue)))
    }

    async get(group: GroupChat, issueId: string): Promise<GroupIssue> {
        const issue = await this.issueRepo.findOne({ where: { id: issueId, groupChatId: group.id, userId: group.userId } })
        if (!issue) throw BusinessException.notFound(`Issue ${issueId} not found`)
        return issue
    }

    async view(issue: GroupIssue): Promise<GroupIssueView> {
        const comments = await this.commentRepo.find({ where: { issueId: issue.id }, order: { createdAt: 'ASC' } })
        return toGroupIssueView(issue, comments, await this.runStream.getActiveIssueRun(issue.groupChatId, issue.id))
    }

    async comments(group: GroupChat, issueId: string): Promise<GroupIssueCommentView[]> {
        const issue = await this.get(group, issueId)
        const rows = await this.commentRepo.find({ where: { issueId: issue.id }, order: { createdAt: 'ASC' } })
        return rows.map(toGroupIssueCommentView)
    }

    async create(group: GroupChat, userId: string, payload: CreateGroupIssuePayload): Promise<GroupIssueView> {
        this.assertIssuesMode(group)
        const title = payload.title?.trim()
        if (!title) throw BusinessException.badRequest('Issue title cannot be empty')
        const assigneeType = payload.assigneeType ?? 'orchestrator'
        const assigneeId = await this.validateAssignee(group, assigneeType, payload.assigneeId)
        const issue = await this.issueRepo.save(this.issueRepo.create({
            groupChatId: group.id,
            userId,
            title,
            description: payload.description?.trim() || null,
            status: 'todo',
            assigneeType,
            assigneeId,
            blockedReason: null,
            lastRunId: null,
            createdByUserId: userId
        }))
        await this.messages.appendIssueEvent(group.id, userId, { issueId: issue.id, event: 'created', title: issue.title, status: issue.status })
        return this.view(issue)
    }

    async update(group: GroupChat, userId: string, issueId: string, payload: UpdateGroupIssuePayload): Promise<GroupIssueView> {
        this.assertIssuesMode(group)
        const issue = await this.get(group, issueId)
        if (payload.title !== undefined) {
            const title = payload.title.trim()
            if (!title) throw BusinessException.badRequest('Issue title cannot be empty')
            issue.title = title
        }
        if (payload.description !== undefined) issue.description = payload.description?.trim() || null
        if (payload.assigneeType !== undefined) {
            issue.assigneeType = payload.assigneeType
            issue.assigneeId = payload.assigneeType
                ? await this.validateAssignee(group, payload.assigneeType, payload.assigneeId ?? undefined)
                : null
        } else if (payload.assigneeId !== undefined && issue.assigneeType === 'agent') {
            issue.assigneeId = await this.validateAssignee(group, 'agent', payload.assigneeId ?? undefined)
        }
        if (payload.status !== undefined) {
            if (payload.status === 'done' || payload.status === 'cancelled') {
                // Only the authenticated human-facing API may close an Issue.
                issue.status = payload.status
            } else {
                issue.status = payload.status
            }
        }
        if (payload.blockedReason !== undefined) issue.blockedReason = payload.blockedReason?.trim() || null
        await this.commentRepo.save(this.commentRepo.create({
            issueId: issue.id,
            groupChatId: issue.groupChatId,
            authorRole: 'system',
            authorAgentId: null,
            authorUserId: userId,
            body: 'Issue 已更新',
            mentions: [],
            runId: null
        }))
        await this.messages.appendIssueEvent(group.id, userId, {
            issueId: issue.id,
            event: payload.assigneeType !== undefined || payload.assigneeId !== undefined ? 'assigned' : 'status',
            title: issue.title,
            status: issue.status,
            summary: 'Issue 已更新'
        })
        return this.view(await this.issueRepo.save(issue))
    }

    async addUserComment(group: GroupChat, userId: string, issueId: string, payload: CreateGroupIssueCommentPayload): Promise<GroupIssueCommentView> {
        this.assertIssuesMode(group)
        const issue = await this.get(group, issueId)
        const body = payload.body?.trim()
        if (!body) throw BusinessException.badRequest('Issue comment cannot be empty')
        const mentions = await this.validateMentions(group, payload.mentions ?? [])
        const comment = await this.commentRepo.save(this.commentRepo.create({
            issueId: issue.id,
            groupChatId: group.id,
            authorRole: 'user',
            authorAgentId: null,
            authorUserId: userId,
            body,
            mentions,
            runId: null
        }))
        await this.messages.appendIssueEvent(group.id, group.userId, {
            issueId: issue.id,
            event: 'comment',
            title: issue.title,
            status: issue.status,
            summary: body
        })
        return toGroupIssueCommentView(comment)
    }

    async addRuntimeComment(
        group: GroupChat,
        issueId: string,
        body: string,
        authorRole: 'agent' | 'orchestrator' | 'system',
        authorAgentId: string | null,
        runId: string | null,
        mentions: string[] = []
    ): Promise<GroupIssueCommentView> {
        const issue = await this.get(group, issueId)
        const comment = await this.commentRepo.save(this.commentRepo.create({
            issueId: issue.id,
            groupChatId: issue.groupChatId,
            authorRole,
            authorAgentId,
            authorUserId: null,
            body: body.trim(),
            mentions,
            runId
        }))
        await this.messages.appendIssueEvent(group.id, group.userId, {
            issueId: issue.id,
            event: 'comment',
            title: issue.title,
            status: issue.status,
            summary: body
        })
        return toGroupIssueCommentView(comment)
    }

    async updateRuntime(
        group: GroupChat,
        issueId: string,
        patch: { status?: GroupIssue['status']; blockedReason?: string | null; lastRunId?: string | null }
    ): Promise<GroupIssueView> {
        const issue = await this.get(group, issueId)
        if (patch.status) issue.status = patch.status
        if (patch.blockedReason !== undefined) issue.blockedReason = patch.blockedReason
        if (patch.lastRunId !== undefined) issue.lastRunId = patch.lastRunId
        return this.view(await this.issueRepo.save(issue))
    }

    async convertMessage(group: GroupChat, userId: string, messageId: string): Promise<GroupIssueView> {
        const text = ((await this.messages.getMessageText(group.id, messageId)) ?? '').trim()
        if (!text) throw BusinessException.badRequest('Message has no text to convert')
        const firstLine = text.split(/\r?\n/, 1)[0]?.trim() || '来自群聊消息的 Issue'
        return this.create(group, userId, { title: firstLine.slice(0, 256), description: text })
    }

    private assertIssuesMode(group: GroupChat): void {
        if (group.mode !== 'issues') throw BusinessException.badRequest('Issue APIs require an issues group')
    }

    private async validateAssignee(group: GroupChat, type: 'agent' | 'orchestrator', id?: string): Promise<string | null> {
        if (type === 'orchestrator') return null
        if (!id) throw BusinessException.badRequest('Agent assignee id is required')
        const member = await this.memberRepo.findOne({ where: { groupChatId: group.id, agentId: id } })
        if (!member) throw BusinessException.badRequest('Assignee must be a member Agent of this group')
        return id
    }

    private async validateMentions(group: GroupChat, mentions: string[]): Promise<string[]> {
        const unique = [...new Set(mentions.filter(Boolean))]
        const agentIds = unique.filter((id) => id !== 'orchestrator')
        if (agentIds.length === 0) return unique
        const members = await this.memberRepo.find({ where: { groupChatId: group.id, agentId: In(agentIds) } })
        if (members.length !== agentIds.length) throw BusinessException.badRequest('Mention target is not a member of this group')
        return unique
    }
}
