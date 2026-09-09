import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { Audit } from '../../common/decorators/audit.decorator';
import { LabTestFieldPermissionsService } from './lab-test-field-permissions.service';
import { UpdateLabTestFieldPermissionDto } from './dto/update-lab-test-field-permission.dto';

/**
 * Business Settings › Lab Test Master Setting. Tenant-wide (not
 * branch-scoped): `GET` is open (any authenticated business user reads the
 * effective Allow/Deny map); `PUT` requires
 * `business_admin:lab_test_master_setting__update_lab_test_master_setting`.
 */
@Controller('business-admin/lab-test-field-permissions')
@UseGuards(PermissionGuard)
export class LabTestFieldPermissionsController {
  constructor(private readonly service: LabTestFieldPermissionsService) {}

  /** Effective field permissions for the caller's tenant (defaults + overrides). */
  @Get()
  async get(@CurrentTenant() tenantId: string) {
    return { config: await this.service.getForTenant(tenantId) };
  }

  /** Save (merge) the tenant's Lab Test Master Setting field permissions. */
  @Put()
  @RequirePermission(PERMISSION_KEYS.BA_SETTINGS_LAB_TEST_MASTER_UPDATE)
  @Audit({
    module: AuditModule.LAB_TEST_FIELD_PERMISSIONS,
    action: AuditAction.UPDATE,
    description: 'Saved the lab test master setting field permissions',
  })
  async save(
    @CurrentTenant() tenantId: string,
    @Body() dto: UpdateLabTestFieldPermissionDto,
  ) {
    return { config: await this.service.saveForTenant(tenantId, dto) };
  }
}
