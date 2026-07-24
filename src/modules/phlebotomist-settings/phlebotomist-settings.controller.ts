import { Body, Controller, Get, Put } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { PhlebotomistSettingsService } from './phlebotomist-settings.service';
import { SavePhlebotomistSettingsDto } from './dto/save-phlebotomist-settings.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Phlebotomist settings endpoints (Registration › Phlebotomist Settings).
 * Business-authenticated; tenant from the JWT, branch from the active
 * profile. `GET` returns the effective settings (defaults merged with any
 * saved overrides); `PUT` upserts the active branch's settings. Falls back to
 * module defaults when the branch has never saved.
 */
@Controller('phlebotomist-settings')
export class PhlebotomistSettingsController {
  constructor(private readonly settings: PhlebotomistSettingsService) {}

  /** Effective phlebotomist settings for the active branch (defaults + overrides). */
  @Get()
  get(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.settings.getForBranch(tenantId, profile.branchId ?? '');
  }

  /** Save (upsert) the active branch's phlebotomist settings. */
  @Put()
  @Audit({
    module: AuditModule.PHLEBOTOMIST_SETTINGS,
    action: AuditAction.UPDATE,
    description: 'Updated phlebotomist settings',
  })
  save(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: SavePhlebotomistSettingsDto,
  ) {
    return this.settings.saveForBranch(tenantId, profile.branchId ?? '', dto);
  }
}
