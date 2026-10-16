import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger'
import type { LayeredMemoryItem } from '@agenthub/shared'
import { ApiEnvelope } from '../../common/swagger/api-envelope.decorator.js'
import { JwtAuthGuard } from '../../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../../user/auth/current-user.decorator.js'
import type { User } from '../../user/entities/user.entity.js'
import {
    CreateLayeredMemoryDto,
    LayeredMemoryItemDto,
    ListLayeredMemoryDto
} from './dto/layered-memory.dto.js'
import { LayeredMemoryService } from './layered-memory.service.js'

@ApiTags('user-memory')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('user/memories')
export class LayeredMemoryController {
    constructor(private readonly memory: LayeredMemoryService) {}

    @Get()
    @ApiOperation({ summary: '查询当前用户的长期记忆和工作区记忆' })
    @ApiEnvelope(LayeredMemoryItemDto, { isArray: true })
    list(
        @CurrentUser() user: User,
        @Query() query: ListLayeredMemoryDto
    ): Promise<LayeredMemoryItem[]> {
        return this.memory.list(user.id, query)
    }

    @Post()
    @ApiOperation({ summary: '新增一条长期记忆或工作区记忆' })
    @ApiEnvelope(LayeredMemoryItemDto, { status: 201 })
    create(
        @CurrentUser() user: User,
        @Body() dto: CreateLayeredMemoryDto
    ): Promise<LayeredMemoryItem> {
        return this.memory.create(user.id, dto)
    }

    @Delete(':id')
    @ApiOperation({ summary: '删除当前用户的一条记忆' })
    @ApiEnvelope()
    async remove(@CurrentUser() user: User, @Param('id') id: string): Promise<{ deleted: true }> {
        await this.memory.remove(user.id, id)
        return { deleted: true }
    }
}
