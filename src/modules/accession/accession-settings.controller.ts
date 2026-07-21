import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { SaveAccessionSettingsDto } from './dto/save-accession-settings.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Accession settings endpoints (PDF §G). Business-authenticated; tenant from the
 * JWT, branch from the active profile. `GET` returns the effective settings
 * (defaults merged with any saved overrides); `PUT` upserts the active branch's
 * settings. Falls back to module defaults when the branch has never saved.
 */
@Controller('accession/settings')
export class AccessionSettingsController {
  constructor(private readonly settings: AccessionSettingsService) {}

  /** Effective accession settings for the active branch (defaults + overrides). */
  @Get()
  get(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.settings.getForBranch(tenantId, profile.branchId ?? '');
  }

  /** Save (upsert) the active branch's accession settings. */
  @Put()
  @Audit({
    module: AuditModule.ACCESSION,
    action: AuditAction.UPDATE,
    description: 'Updated accession settings',
  })
  save(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SaveAccessionSettingsDto,
  ) {
    return this.settings.saveForBranch(tenantId, profile.branchId ?? '', dto);
  }
}
