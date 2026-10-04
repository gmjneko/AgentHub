import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator'
import type {
    CreateGroupIssueCommentPayload,
    CreateGroupIssuePayload,
    GroupIssueAssigneeType,
    GroupIssueStatus,
    UpdateGroupIssuePayload
} from '@agenthub/shared'

const STATUSES: GroupIssueStatus[] = ['todo', 'in_progress', 'in_review', 'done', 'blocked', 'cancelled']
const ASSIGNEE_TYPES: GroupIssueAssigneeType[] = ['agent', 'orchestrator']

export class CreateGroupIssueDto implements CreateGroupIssuePayload {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    title!: string

    @ApiPropertyOptional({ nullable: true })
    @IsOptional()
    @IsString()
    description?: string | null

    @ApiPropertyOptional({ enum: ASSIGNEE_TYPES })
    @IsOptional()
    @IsIn(ASSIGNEE_TYPES)
    assigneeType?: GroupIssueAssigneeType

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    assigneeId?: string
}

export class UpdateGroupIssueDto implements UpdateGroupIssuePayload {
    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    title?: string

    @ApiPropertyOptional({ nullable: true })
    @IsOptional()
    @IsString()
    description?: string | null

    @ApiPropertyOptional({ enum: ASSIGNEE_TYPES, nullable: true })
    @IsOptional()
    @IsIn([...ASSIGNEE_TYPES, null])
    assigneeType?: GroupIssueAssigneeType | null

    @ApiPropertyOptional({ nullable: true })
    @IsOptional()
    @IsString()
    assigneeId?: string | null

    @ApiPropertyOptional({ enum: STATUSES })
    @IsOptional()
    @IsIn(STATUSES)
    status?: GroupIssueStatus

    @ApiPropertyOptional({ nullable: true })
    @IsOptional()
    @IsString()
    blockedReason?: string | null
}

export class CreateGroupIssueCommentDto implements CreateGroupIssueCommentPayload {
    @ApiProperty()
    @IsString()
    @IsNotEmpty()
    body!: string

    @ApiPropertyOptional({ type: [String] })
    @IsOptional()
    @IsArray()
    @IsString({ each: true })
    mentions?: string[]
}
