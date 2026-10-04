import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import type { GroupIssueCommentView, GroupIssueView } from '@agenthub/shared'

export class GroupIssueCommentViewDto implements GroupIssueCommentView {
    @ApiProperty() id!: string
    @ApiProperty() issueId!: string
    @ApiProperty() groupChatId!: string
    @ApiProperty({ enum: ['user', 'agent', 'orchestrator', 'system'] }) authorRole!: GroupIssueCommentView['authorRole']
    @ApiPropertyOptional({ nullable: true }) authorAgentId!: string | null
    @ApiPropertyOptional({ nullable: true }) authorUserId!: string | null
    @ApiProperty() body!: string
    @ApiProperty({ type: [String] }) mentions!: string[]
    @ApiPropertyOptional({ nullable: true }) runId!: string | null
    @ApiProperty() createdAt!: string
}

export class GroupIssueViewDto implements GroupIssueView {
    @ApiProperty() id!: string
    @ApiProperty() groupChatId!: string
    @ApiProperty() title!: string
    @ApiPropertyOptional({ nullable: true }) description!: string | null
    @ApiProperty({ enum: ['todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled'] }) status!: GroupIssueView['status']
    @ApiPropertyOptional({ enum: ['agent', 'orchestrator'], nullable: true }) assigneeType!: GroupIssueView['assigneeType']
    @ApiPropertyOptional({ nullable: true }) assigneeId!: string | null
    @ApiPropertyOptional({ nullable: true }) blockedReason!: string | null
    @ApiPropertyOptional({ nullable: true }) lastRunId!: string | null
    @ApiProperty() createdByUserId!: string
    @ApiProperty() createdAt!: string
    @ApiProperty() updatedAt!: string
    @ApiProperty({ type: [GroupIssueCommentViewDto] }) comments!: GroupIssueCommentView[]
    @ApiPropertyOptional({ nullable: true }) activeRunId!: string | null
}
