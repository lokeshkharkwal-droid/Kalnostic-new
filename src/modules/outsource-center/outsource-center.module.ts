import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { OutsourceCenterController } from './outsource-center.controller';
import { OutsourceCenterService } from './outsource-center.service';

/**
 * Outsource-center feature module. Imports `BranchModule` to validate
 * client-supplied branch ids (CLAUDE.md §4.7). Exports `OutsourceCenterService`
 * so a future accession-routing module can resolve a center's branch assignments.
 */
@Module({
  imports: [PrismaModule, BranchModule],
  controllers: [OutsourceCenterController],
  providers: [OutsourceCenterService],
  exports: [OutsourceCenterService],
})
export class OutsourceCenterModule {}
