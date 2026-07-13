import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { BranchModule } from '../branch/branch.module';
import { AuthRoleModule } from '../auth-role/auth-role.module';
import { UserManagementController } from './user-management.controller';
import { SiteAdminRegisteredUsersController } from './siteadmin-registered-users.controller';
import { RadiologyTechnicianOptionsController } from './radiology-technician-options.controller';
import { UsersService } from './users.service';

/**
 * Users feature module. Exports `UsersService` so the auth module can read a
 * person's profiles when building the JWT. Hosts the User Management v2.0
 * controller (`users/manage`). Imports AuthRoleModule to resolve role keys to
 * AuthRole FKs (CLAUDE.md rule #3).
 */
@Module({
  imports: [PrismaModule, SecurityModule, BranchModule, AuthRoleModule],
  controllers: [
    UserManagementController,
    SiteAdminRegisteredUsersController,
    RadiologyTechnicianOptionsController,
  ],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
