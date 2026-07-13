import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { PhlebotomistController } from './phlebotomist.controller';
import { PhlebotomistOptionsController } from './phlebotomist-options.controller';
import { PhlebotomistService } from './phlebotomist.service';

/**
 * Phlebotomist master-table module. Tenant-scoped + branch-level CRUD. Exports
 * `PhlebotomistService` so `OrderModule` can validate diagnostics-section
 * references (rule #3 — DI, not a direct file import).
 */
@Module({
  imports: [PrismaModule],
  controllers: [PhlebotomistOptionsController, PhlebotomistController],
  providers: [PhlebotomistService],
  exports: [PhlebotomistService],
})
export class PhlebotomistModule {}
