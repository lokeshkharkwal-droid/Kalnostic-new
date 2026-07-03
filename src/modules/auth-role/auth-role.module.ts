import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuthRoleController } from './auth-role.controller';
import { SiteAdminAuthRoleController } from './siteadmin-auth-role.controller';
import { AuthRoleService } from './auth-role.service';

/**
 * Role feature module. Owns the AuthRole entity, the tenant-scoped `/roles` CRUD
 * (business JWT) and the SiteAdmin `/siteadmin/roles` global-catalogue surface,
 * and exports AuthRoleService so `tenant`, `users`, and `auth` can resolve roles
 * by key / attach the initial admin's role (CLAUDE.md rule #3 — injected, not
 * imported). The SiteAdmin controller's guard resolves via the globally-registered
 * `jwt-siteadmin` strategy (no SiteAdminModule import needed, as in DepartmentModule).
 */
@Module({
  imports: [PrismaModule],
  controllers: [AuthRoleController, SiteAdminAuthRoleController],
  providers: [AuthRoleService],
  exports: [AuthRoleService],
})
export class AuthRoleModule {}
