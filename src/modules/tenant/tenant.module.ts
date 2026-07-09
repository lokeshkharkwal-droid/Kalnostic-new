import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { AuthRoleModule } from '../auth-role/auth-role.module';
import { BranchModule } from '../branch/branch.module';
import { LocationModule } from '../location/location.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/**
 * Tenant feature module. Exports `TenantService` so the auth module can resolve
 * a tenant by slug during login. Imports (CLAUDE.md rule #3): AuthRoleModule to
 * attach the initial admin's `business_admin` role; LocationModule to validate
 * the tenant's Country→State→City→Area hierarchy; BranchModule to list a
 * tenant's branches for the SiteAdmin summary view.
 */
@Module({
  imports: [
    PrismaModule,
    SecurityModule,
    AuthRoleModule,
    BranchModule,
    LocationModule,
  ],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
