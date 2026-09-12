import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiProperty, ApiTags, ApiResponse } from '@nestjs/swagger'
import { IsIn, IsObject, IsOptional } from 'class-validator'
import type { AgentInteractionResponse } from '@agenthub/shared'
import { JwtAuthGuard } from '../../user/auth/jwt-auth.guard.js'
import { CurrentUser } from '../../user/auth/current-user.decorator.js'
import type { User } from '../../user/entities/user.entity.js'
import { AgentInteractionService } from './agent-interaction.service.js'

export class InteractionResponseDto implements AgentInteractionResponse {
    @ApiProperty({ enum: ['approve', 'deny', 'answer', 'cancel'] })
    @IsIn(['approve', 'deny', 'answer', 'cancel']) decision!: AgentInteractionResponse['decision']
    @ApiProperty({ required: false }) @IsOptional() @IsObject() answers?: Record<string, string>
}

@ApiTags('agent-interactions') @ApiBearerAuth() @UseGuards(JwtAuthGuard)
@Controller('agent-interactions')
export class AgentInteractionController {
    constructor(private readonly service: AgentInteractionService) {}
    @Get()
    @ApiResponse({ status: 200 })
    list(@CurrentUser() user: User, @Query('chatId') chatId?: string, @Query('groupId') groupId?: string): Promise<unknown[]> {
        return this.service.list(user.id, { ...(chatId ? { sessionId: chatId } : {}), ...(groupId ? { groupId } : {}) })
    }
    @Post(':requestId/response')
    respond(@CurrentUser() user: User, @Param('requestId') requestId: string, @Body() dto: InteractionResponseDto): Promise<{ accepted: true }> {
        return this.service.respond(user.id, requestId, dto)
    }
}
