import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm'
import type { GroupIssueAssigneeType, GroupIssueStatus } from '@agenthub/shared'

@Entity('group_issue')
export class GroupIssue {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Column({ type: 'varchar', length: 256 })
    title!: string

    @Column({ type: 'text', nullable: true })
    description!: string | null

    @Column({ type: 'varchar', length: 16, default: 'todo' })
    status!: GroupIssueStatus

    @Column({ type: 'varchar', length: 16, nullable: true })
    assigneeType!: GroupIssueAssigneeType | null

    @Column({ type: 'varchar', length: 36, nullable: true })
    assigneeId!: string | null

    @Column({ type: 'text', nullable: true })
    blockedReason!: string | null

    @Column({ type: 'varchar', length: 36, nullable: true })
    lastRunId!: string | null

    @Column({ type: 'varchar', length: 36 })
    createdByUserId!: string

    @CreateDateColumn()
    createdAt!: Date

    @UpdateDateColumn()
    updatedAt!: Date
}
