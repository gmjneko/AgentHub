import { Module } from '@nestjs/common'
import { TypeOrmModule } from '@nestjs/typeorm'
import { UserModule } from '../../user/user.module.js'
import { LayeredMemoryController } from './layered-memory.controller.js'
import { LayeredMemoryService } from './layered-memory.service.js'
import { LayeredMemoryItemEntity } from './entities/layered-memory-item.entity.js'

@Module({
    imports: [TypeOrmModule.forFeature([LayeredMemoryItemEntity]), UserModule],
    controllers: [LayeredMemoryController],
    providers: [LayeredMemoryService],
    exports: [LayeredMemoryService]
})
export class LayeredMemoryModule {}
