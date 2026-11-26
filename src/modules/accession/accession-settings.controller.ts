import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { AuditAction, AuditModule } from '@prisma/client';
import { AccessionSettingsService } from './accession-settings.service';
import { SaveAccessionSettingsDto } from './dto/save-accession-settings.dto';
import { PermissionGuard } from '../permissions/guards/permission.guard';
import { RequirePermission } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { Audit } from '../../common/decorators/audit.decorator';

/**
 * Accession Module Settings endpoints (LIMS Settings Master — Accession
 * Module: Master Data, Sample Barcode Settings, Accession TAT/acceptance
 * settings). Business-authenticated; tenant from the JWT, branch from the
 * active profile. `GET` returns the effective settings (defaults merged with
 * any saved overrides); `PUT` saves a partial patch of the active branch's
 * settings. Falls back to module defaults when the branch has never saved.
 */
@Controller('accession/settings')
@UseGuards(PermissionGuard)
export class AccessionSettingsController {
  constructor(private readonly settings: AccessionSettingsService) {}

  /** Effective accession settings for the active branch (defaults + overrides). */
  @Get()
  @RequirePermission(PERMISSION_KEYS.ACC_SETTINGS_VIEW)
  get(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.settings.getForBranch(tenantId, profile.branchId ?? '');
  }

  /**
   * The active branch's accession settings **as they apply** — read by the
   * operational screens (In-House / Referral / Outsource worklists, Sample
   * Search, Order Overview) for the Master Data lists (tube types, sample
   * conditions, rejection/repeat reasons, discard methods, logistics types)
   * and acceptance rules.
   *
   * Login-only on purpose (no `@RequirePermission`; the class-level
   * `PermissionGuard` is opt-in): the `view/update accession settings`
   * permissions control who may open and change the Accession Settings PAGE,
   * never whether the saved settings take effect. Gating this read made every
   * screen fall back to the defaults / empty lists for a user without the view
   * permission, although nothing had changed in the database.
   *
   * Same effective object as the gated `GET` (stored row merged over the
   * module defaults, plus the tenant barcode counters). Tenant + branch come
   * only from the JWT; read-only.
   */
  @Get('effective')
  getEffective(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
  ) {
    return this.settings.getForBranch(tenantId, profile.branchId ?? '');
  }

  /** Save (upsert) the active branch's accession settings. */
  @Put()
  @RequirePermission(PERMISSION_KEYS.ACC_SETTINGS_UPDATE)
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
