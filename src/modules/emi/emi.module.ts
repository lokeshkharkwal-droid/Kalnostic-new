import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma';
import { UploadsModule } from '../uploads/uploads.module';
import { EmiController } from './emi.controller';
import { EmiService } from './emi.service';

/**
 * EMI (External Machine Interface) module — the lab-analyzer compatibility layer
 * (`/emi/orders`, `/emi/submitResult`). Machine-authenticated via `LabAdapter`
 * tokens (resolved against the DB in the service). Writes (result values, report
 * status, audit rows) go through `PrismaService` inside the adapter's tenant
 * context; `UploadsModule` provides the S3 helper used to store analyzer
 * histogram images before they're linked as `LabReportAttachment`s.
 */
@Module({
  imports: [PrismaModule, UploadsModule],
  controllers: [EmiController],
  providers: [EmiService],
})
export class EmiModule {}
