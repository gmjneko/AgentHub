import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm'
import type {
    LayeredMemoryLayer,
    LayeredMemorySourceType,
    LayeredMemoryStatus,
    LayeredMemoryType
} from '@agenthub/shared'

@Entity('layered_memory_item')
export class LayeredMemoryItemEntity {
    @PrimaryGeneratedColumn('uuid')
    id!: string

    @Index()
    @Column({ type: 'varchar', length: 36 })
    userId!: string

    @Index()
    @Column({ type: 'varchar', length: 16 })
    layer!: LayeredMemoryLayer

    @Column({ type: 'varchar', length: 32 })
    type!: LayeredMemoryType

    @Index()
    @Column({ type: 'varchar', length: 512, nullable: true })
    workspaceKey!: string | null

    @Column({ type: 'text' })
    content!: string

    @Column({ type: 'varchar', length: 16 })
    sourceType!: LayeredMemorySourceType

    @Column({ type: 'varchar', length: 256, nullable: true })
    sourceRef!: string | null

    @Column({ type: 'varchar', length: 16, default: 'active' })
    status!: LayeredMemoryStatus

    @CreateDateColumn()
    createdAt!: Date

    @Column({ type: 'datetime', nullable: true })
    lastUsedAt!: Date | null
}
