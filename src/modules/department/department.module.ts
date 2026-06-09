import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { DepartmentController } from './department.controller';
import { DepartmentService } from './department.service';

/**
 * Department feature module. Tenant-scoped, tenant-level — manages a business's
 * departments and the staff mapped to them.
 */
@Module({
  imports: [PrismaModule],
  controllers: [DepartmentController],
  providers: [DepartmentService],
  exports: [DepartmentService],
})
export class DepartmentModule {}
