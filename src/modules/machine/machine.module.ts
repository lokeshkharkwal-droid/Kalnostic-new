import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { DepartmentModule } from '../department/department.module';
import { MachineController } from './machine.controller';
import { MachineService } from './machine.service';

/**
 * Machine Management feature module. Tenant-scoped, tenant-level: machines are
 * owned by the business and assigned to branches via `MachineBranch`. Imports
 * `DepartmentModule` + `BranchModule` to validate the referenced department and
 * branch assignments via their services (rule #3 — DI, not direct file imports).
 */
@Module({
  imports: [PrismaModule, DepartmentModule, BranchModule],
  controllers: [MachineController],
  providers: [MachineService],
  exports: [MachineService],
})
export class MachineModule {}
