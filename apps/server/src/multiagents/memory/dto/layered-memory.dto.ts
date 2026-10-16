import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'
import { IsIn, IsOptional, IsString } from 'class-validator'
import type {
    CreateLayeredMemoryPayload,
    LayeredMemoryItem,
    LayeredMemoryLayer,
    LayeredMemorySourceType,
    LayeredMemoryStatus,
    LayeredMemoryType,
    ListLayeredMemoryQuery
} from '@agenthub/shared'

const LAYERS: LayeredMemoryLayer[] = ['long_term', 'workspace']
const TYPES: LayeredMemoryType[] = ['preference', 'code_style', 'convention', 'decision']

export class ListLayeredMemoryDto implements ListLayeredMemoryQuery {
    @ApiPropertyOptional({ enum: LAYERS })
    @IsOptional()
    @IsIn(LAYERS)
    layer?: LayeredMemoryLayer

    @ApiPropertyOptional()
    @IsOptional()
    @IsString()
    workspaceDir?: string
}

export class CreateLayeredMemoryDto implements CreateLayeredMemoryPayload {
    @ApiProperty({ enum: LAYERS })
    @IsIn(LAYERS)
    layer!: LayeredMemoryLayer

    @ApiProperty({ enum: TYPES })
    @IsIn(TYPES)
    type!: LayeredMemoryType

    @ApiProperty()
    @IsString()
    content!: string

    @ApiPropertyOptional({ nullable: true })
    @IsOptional()
    @IsString()
    workspaceDir?: string | null
}

const STATUSES: LayeredMemoryStatus[] = ['active', 'stale', 'deprecated']
const SOURCES: LayeredMemorySourceType[] = ['user', 'agent', 'blackboard']

export class LayeredMemoryItemDto implements LayeredMemoryItem {
    @ApiProperty() id!: string
    @ApiProperty({ enum: LAYERS }) layer!: LayeredMemoryLayer
    @ApiProperty({ enum: TYPES }) type!: LayeredMemoryType
    @ApiProperty({ type: String, nullable: true }) workspaceKey!: string | null
    @ApiProperty() content!: string
    @ApiProperty({ enum: SOURCES }) sourceType!: LayeredMemorySourceType
    @ApiProperty({ type: String, nullable: true }) sourceRef!: string | null
    @ApiProperty({ enum: STATUSES }) status!: LayeredMemoryStatus
    @ApiProperty() createdAt!: string
    @ApiProperty({ type: String, nullable: true }) lastUsedAt!: string | null
}
