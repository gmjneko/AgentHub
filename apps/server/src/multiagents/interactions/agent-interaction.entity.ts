import { Column, Entity, Index, PrimaryColumn } from 'typeorm'
import type { AgentInteractionEvent, AgentInteractionResponse } from '@agenthub/shared'

/** Pending SDK callbacks are persisted separately so parallel tool requests cannot overwrite one another. */
@Entity('agent_interaction')
export class AgentInteraction {
    @PrimaryColumn({ type: 'varchar', length: 36 }) id!: string
    @Index() @Column({ type: 'varchar', length: 36 }) userId!: string
    @Index() @Column({ type: 'varchar', length: 36 }) sessionId!: string
    @Column({ type: 'varchar', length: 128 }) turnId!: string
    @Index() @Column({ type: 'varchar', length: 36, nullable: true }) groupId!: string | null
    @Column({ type: 'json' }) event!: AgentInteractionEvent
    @Column({ type: 'json', nullable: true }) response!: AgentInteractionResponse | null
    @Column({ type: 'varchar', length: 16 }) status!: 'pending' | 'answered' | 'closed'
    @Column({ type: 'datetime' }) expiresAt!: Date
}
