import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { UserDepartmentScopeService } from './user-department-scope.service';

/**
 * Exposes {@link UserDepartmentScopeService} so any listing module can scope its
 * queries by the caller's departments (Technician Reporting, Accession In-House
 * Orders, …) without pulling in the heavy `UsersService`. Depends only on
 * `PrismaModule`, so it never introduces a circular module dependency.
 */
@Module({
  imports: [PrismaModule],
  providers: [UserDepartmentScopeService],
  exports: [UserDepartmentScopeService],
})
export class UserDepartmentScopeModule {}
