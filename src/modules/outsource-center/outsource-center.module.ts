import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { OutsourceCenterController } from './outsource-center.controller';
import { OutsourceCenterService } from './outsource-center.service';

/**
 * Outsource-center feature module. Exports `OutsourceCenterService` so a future
 * accession-routing module can resolve a center's assigned lab test/panel.
 */
@Module({
  imports: [PrismaModule],
  controllers: [OutsourceCenterController],
  providers: [OutsourceCenterService],
  exports: [OutsourceCenterService],
})
export class OutsourceCenterModule {}
