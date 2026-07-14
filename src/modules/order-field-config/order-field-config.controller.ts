import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { OrderFieldConfigService } from './order-field-config.service';
import { SaveOrderFieldConfigDto } from './dto/save-order-field-config.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { OrderFieldConfigBranchRequiredException } from './exceptions/order-field-config.exceptions';

/**
 * Create-Order field customization endpoints. Business-authenticated; tenant
 * comes from the JWT and the branch from the active profile (branch-specific
 * config). The global `JwtAuthGuard` protects all routes.
 */
@Controller('order-field-config')
export class OrderFieldConfigController {
  constructor(
    private readonly orderFieldConfigService: OrderFieldConfigService,
  ) {}

  /** Fetch the active branch's field configuration (null when unset). */
  @Get()
  find(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    const branchId = this.requireBranch(profile);
    return this.orderFieldConfigService.getForBranch(tenantId, branchId);
  }

  /** Create or replace the active branch's field configuration. */
  @Put()
  @Audit({
    module: AuditModule.ORDER,
    action: AuditAction.UPDATE,
    description: 'Saved the create-order field configuration',
  })
  save(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SaveOrderFieldConfigDto,
  ) {
    const branchId = this.requireBranch(profile);
    return this.orderFieldConfigService.saveForBranch(tenantId, branchId, dto);
  }

  /** Resolve the active branch, or throw when the profile is tenant-level. */
  private requireBranch(profile: ActiveProfile): string {
    if (!profile.branchId) {
      throw new OrderFieldConfigBranchRequiredException();
    }
    return profile.branchId;
  }
}
