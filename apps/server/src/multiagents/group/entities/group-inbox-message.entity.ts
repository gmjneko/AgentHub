import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'

/**
 * GroupInboxMessage — 某个成员尚未读过的一条发言副本。
 *
 * 群聊气泡是给人看的原文。Agent 发到群里时，按发言人名字给其他每个成员各放一行。
 * 该成员下次运行时把未消费行拼进提示，然后写入 consumedAt。
 */
@Entity('group_inbox_message')
@Index(['groupId', 'toAgentId', 'consumedAt'])
export class GroupInboxMessage {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    groupId!: string

    @Column({ type: 'varchar', length: 36, nullable: true })
    runId!: string | null

    @Column({ type: 'varchar', length: 36 })
    toAgentId!: string

    /** 发言 Agent 的名字；用户消息为「用户」 */
    @Column({ type: 'varchar', length: 128 })
    fromName!: string

    @Column({ type: 'text' })
    text!: string

    @Column({ type: 'datetime', nullable: true })
    consumedAt!: Date | null

    @CreateDateColumn()
    createdAt!: Date
}
