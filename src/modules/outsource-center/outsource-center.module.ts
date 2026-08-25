import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchLabTestListModule } from '../branch-lab-test-list/branch-lab-test-list.module';
import { BranchLabPanelListModule } from '../branch-lab-panel-list/branch-lab-panel-list.module';
import { OutsourceCenterController } from './outsource-center.controller';
import { OutsourceCenterDocumentController } from './outsource-center-document.controller';
import { OutsourceCenterService } from './outsource-center.service';

/**
 * Outsource-center feature module. Exports `OutsourceCenterService` so a future
 * accession-routing module can resolve a center's assigned lab test/panel.
 */
@Module({
  imports: [PrismaModule, BranchLabTestListModule, BranchLabPanelListModule],
  controllers: [OutsourceCenterController, OutsourceCenterDocumentController],
  providers: [OutsourceCenterService],
  exports: [OutsourceCenterService],
})
export class OutsourceCenterModule {}
