import {
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { LocationSyncService } from './location-sync.service';
import { SiteAdminPermissionGuard } from '../siteadmin/guards/siteadmin-permission.guard';
import { RequireSiteAdminPermission } from '../siteadmin/decorators/require-siteadmin-permission.decorator';
import { SITE_ADMIN_PERM } from '../siteadmin/constants/siteadmin-permissions.constant';
import { Public } from '../auth/decorators/public.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * SiteAdmin bulk location sync (`/siteadmin/locations/sync`). Imports the bundled
 * India location master (country → states/UTs → districts-as-cities). `@Public()`
 * opts out of the business `JwtAuthGuard`; `SiteAdminPermissionGuard` enforces the
 * SiteAdmin token and `master-data:write` (content_admin and above), matching the
 * other SiteAdmin location controllers.
 */
@Controller('siteadmin/locations/sync')
@Public()
@UseGuards(SiteAdminPermissionGuard)
export class SiteAdminLocationSyncController {
  constructor(private readonly locationSyncService: LocationSyncService) {}

  /**
   * Import/refresh the India location master from the bundled JSON. Idempotent —
   * existing country/states/cities are reused, only missing rows are created, and
   * nothing is deleted.
   * @returns per-tier tallies of created vs. already-existing records
   */
  @Post('india')
  @HttpCode(HttpStatus.OK)
  @Audit({
    module: AuditModule.LOCATION,
    action: AuditAction.CREATE,
    description: 'Synced India location master data',
  })
  @RequireSiteAdminPermission(SITE_ADMIN_PERM.MASTER_DATA_WRITE)
  syncIndia() {
    return this.locationSyncService.syncIndiaData();
  }
}
