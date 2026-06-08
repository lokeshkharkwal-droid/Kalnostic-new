import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';

/**
 * Schedule feature module. Imports `BranchModule` to resolve/validate the
 * owning branch (CLAUDE.md rule #3 — services are injected, never imported
 * directly).
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [ScheduleController],
  providers: [ScheduleService],
  exports: [ScheduleService],
})
export class ScheduleModule {}
