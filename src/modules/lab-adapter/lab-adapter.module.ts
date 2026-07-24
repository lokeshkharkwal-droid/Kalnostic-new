import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { EquipmentModule } from '../equipment/equipment.module';
import { LabAdapterController } from './lab-adapter.controller';
import { LabAdapterService } from './lab-adapter.service';

/**
 * Lab Adapter feature module — a tenant's instrument-integration bridges
 * (tenant-scoped, tenant-level). Imports `BranchModule` (validate branch
 * assignments via `BranchService`) and `EquipmentModule` (validate the referenced
 * global equipment via `EquipmentService`) — both injected via DI (rule #3).
 * Branch-lab-test references are validated against the `BranchLabTest` model
 * directly through `PrismaService`, so no lab-test module import is needed.
 */
@Module({
  imports: [PrismaModule, BranchModule, EquipmentModule],
  controllers: [LabAdapterController],
  providers: [LabAdapterService],
  exports: [LabAdapterService],
})
export class LabAdapterModule {}
