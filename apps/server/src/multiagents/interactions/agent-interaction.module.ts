import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from '../../user/user.module.js'
import { AgentInteraction } from './agent-interaction.entity.js'
import { AgentInteractionService } from './agent-interaction.service.js'
import { AgentInteractionController } from './agent-interaction.controller.js'

@Module({ imports: [TypeOrmModule.forFeature([AgentInteraction]), UserModule], providers: [AgentInteractionService], controllers: [AgentInteractionController], exports: [AgentInteractionService] })
export class AgentInteractionModule {}
