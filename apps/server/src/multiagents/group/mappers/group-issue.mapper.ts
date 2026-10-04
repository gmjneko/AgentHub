import type { GroupIssueCommentView, GroupIssueView } from '@agenthub/shared'
import type { GroupIssue } from '../entities/group-issue.entity.js'
import type { GroupIssueComment } from '../entities/group-issue-comment.entity.js'

export function toGroupIssueCommentView(entity: GroupIssueComment): GroupIssueCommentView {
    return {
        id: entity.id,
        issueId: entity.issueId,
        groupChatId: entity.groupChatId,
        authorRole: entity.authorRole,
        authorAgentId: entity.authorAgentId,
        authorUserId: entity.authorUserId,
        body: entity.body,
        mentions: entity.mentions ?? [],
        runId: entity.runId,
        createdAt: entity.createdAt.toISOString()
    }
}

export function toGroupIssueView(
    entity: GroupIssue,
    comments: GroupIssueComment[] = [],
    activeRunId: string | null = null
): GroupIssueView {
    return {
        id: entity.id,
        groupChatId: entity.groupChatId,
        title: entity.title,
        description: entity.description,
        status: entity.status,
        assigneeType: entity.assigneeType,
        assigneeId: entity.assigneeId,
        blockedReason: entity.blockedReason,
        lastRunId: entity.lastRunId,
        createdByUserId: entity.createdByUserId,
        createdAt: entity.createdAt.toISOString(),
        updatedAt: entity.updatedAt.toISOString(),
        comments: comments.map(toGroupIssueCommentView),
        activeRunId
    }
}
