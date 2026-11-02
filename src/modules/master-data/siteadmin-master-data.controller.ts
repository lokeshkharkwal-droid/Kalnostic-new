import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { MasterDataService } from './master-data.service';
import { ResetAbnormalFlagLogicQueryDto } from './dto/reset-abnormal-flag-logic.dto';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin master-data maintenance tooling (`/siteadmin/master-data`). This is
 * the one sanctioned cross-tenant entry point (CLAUDE.md §4.7); the tenant is
 * passed explicitly as a query param, never read from a business JWT.
 *
 * `@Public()` opts out of the global *business* JwtAuthGuard; auth here is the
 * SiteAdmin token validated by `SiteAdminPermissionGuard`. Reference-value
 * content is master data, so writes require `master-data:write` (content_admin
 * and above).
 */
@Controller('siteadmin/master-data')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminMasterDataController {
  constructor(private readonly masterDataService: MasterDataService) {}

  /**
   * One-off data normalisation for a single tenant (id from the `tenantId` query
   * param): change the "Abnormal Flag Logic" of all its existing reference ranges
   * and reference values from "Bold and Red" (`BOLD_AND_RED`) to "Bold"
   * (`BOLD_ONLY`). Any other flag value is left untouched.
   */
  @Post('abnormal-flag-logic/reset-to-bold')
  @Audit({
    module: AuditModule.MASTER_DATA,
    action: AuditAction.UPDATE,
    description:
      'Reset Abnormal Flag Logic to Bold across a tenant master data',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  resetAbnormalFlagLogicToBold(@Query() query: ResetAbnormalFlagLogicQueryDto) {
    return this.masterDataService.resetAbnormalFlagLogicToBold(query.tenantId);
  }
}
