import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { BranchModule } from '../branch/branch.module';
import { AuthRoleModule } from '../auth-role/auth-role.module';
import { UsersModule } from '../users/users.module';
import { BranchRolePermissionController } from './branch-role-permission.controller';
import { BranchRolePermissionService } from './services/branch-role-permission.service';
import { PermissionCheckService } from './services/permission-check.service';
import { PermissionGuard } from './guards/permission.guard';

/**
 * Permissions infrastructure module. Owns tier-2 branch-role permission
 * management (`permissions/branch-roles`) and the business permission guard
 * (`@RequirePermission` + {@link PermissionGuard}).
 *
 * Imports `UsersModule` so the guard can resolve a caller's effective
 * permissions via `UsersService`, and `BranchModule`/`AuthRoleModule` so the
 * branch-role service can validate branches and roles (CLAUDE.md rule #3 —
 * injected, not imported directly).
 *
 * Exports `PermissionGuard` so feature modules can gate routes with it, and
 * re-exports `UsersModule` so those importers can also resolve the guard's
 * `UsersService` dependency (Nest instantiates a `@UseGuards`-referenced guard
 * in the consuming module's injector context).
 *
 * Marked `@Global()` so `PermissionGuard`/`PermissionCheckService` are injectable
 * in every module without an explicit import. This is what lets feature modules
 * gate routes with `@UseGuards(PermissionGuard)` — including `branch` and `users`,
 * which cannot import `PermissionsModule` directly (it already imports *them*, so
 * an explicit back-import would be a circular dependency).
 */
@Global()
@Module({
  imports: [PrismaModule, BranchModule, AuthRoleModule, UsersModule],
  controllers: [BranchRolePermissionController],
  providers: [
    BranchRolePermissionService,
    PermissionCheckService,
    PermissionGuard,
  ],
  exports: [
    PermissionGuard,
    PermissionCheckService,
    BranchRolePermissionService,
    UsersModule,
  ],
})
export class PermissionsModule {}
