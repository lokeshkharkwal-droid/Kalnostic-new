import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RadiologistController } from './radiologist.controller';
import { RadiologistOptionsController } from './radiologist-options.controller';
import { RadiologistService } from './radiologist.service';

/**
 * Radiologist master-table module. Tenant-scoped + branch-level CRUD. Exports
 * `RadiologistService` so `OrderModule` can validate radiology-section
 * references (rule #3 — DI, not a direct file import).
 */
@Module({
  imports: [PrismaModule],
  controllers: [RadiologistOptionsController, RadiologistController],
  providers: [RadiologistService],
  exports: [RadiologistService],
})
export class RadiologistModule {}
