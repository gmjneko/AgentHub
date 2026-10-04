import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type { GroupIssueAuthorRole } from '@agenthub/shared'

@Entity('group_issue_comment')
export class GroupIssueComment {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    issueId!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupChatId!: string

    @Column({ type: 'varchar', length: 16 })
    authorRole!: GroupIssueAuthorRole

    @Column({ type: 'varchar', length: 36, nullable: true })
    authorAgentId!: string | null

    @Column({ type: 'varchar', length: 36, nullable: true })
    authorUserId!: string | null

    @Column({ type: 'text' })
    body!: string

    @Column({ type: 'json', nullable: true })
    mentions!: string[] | null

    @Column({ type: 'varchar', length: 36, nullable: true })
    runId!: string | null

    @CreateDateColumn()
    createdAt!: Date
}
