import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { SecurityModule } from '../security/security.module';
import { TenantController } from './tenant.controller';
import { TenantService } from './tenant.service';

/**
 * Tenant feature module. Exports `TenantService` so the auth module can resolve
 * a tenant by slug during login.
 */
@Module({
  imports: [PrismaModule, SecurityModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
