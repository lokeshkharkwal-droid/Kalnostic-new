import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import {
  DEFAULT_PHLEBOTOMIST_SETTINGS,
  PhlebotomistSettingsMap,
} from './constants/phlebotomist-settings.default';
import { SavePhlebotomistSettingsDto } from './dto/save-phlebotomist-settings.dto';

/**
 * Per-branch phlebotomist settings (Registration › Phlebotomist Settings).
 * Tenant-scoped **and** branch-level (CLAUDE.md §4.7): every query carries
 * `tenantId` + `branchId`. Mirrors `AppointmentSettingsService` — one row per
 * branch (unique `(tenantId, branchId)`), the payload held as JSON. A branch
 * with no saved row uses `DEFAULT_PHLEBOTOMIST_SETTINGS`; `resolve` always
 * returns a complete settings map (stored values merged over the defaults).
 */
@Injectable()
export class PhlebotomistSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve the effective settings for a branch: the stored partial merged
   * over the module defaults (never throws for a missing row — returns
   * defaults).
   * @param tenantId tenant scope
   * @param branchId active branch (null falls back to defaults)
   */
  async resolve(
    tenantId: string,
    branchId: string | null,
  ): Promise<PhlebotomistSettingsMap> {
    if (!branchId) return DEFAULT_PHLEBOTOMIST_SETTINGS;
    const row = await this.prisma.phlebotomistSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    return this.merge(row?.config);
  }

  /**
   * Fetch the branch's effective settings (validates the branch first).
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<PhlebotomistSettingsMap> {
    await this.branchService.findById(branchId, tenantId);
    return this.resolve(tenantId, branchId);
  }

  /**
   * Create or update the branch's settings, then return the effective map.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SavePhlebotomistSettingsDto,
  ): Promise<PhlebotomistSettingsMap> {
    await this.branchService.findById(branchId, tenantId);
    const existing = await this.prisma.phlebotomistSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    const merged = { ...this.merge(existing?.config), ...dto };
    const config = merged as Prisma.InputJsonValue;
    await this.prisma.phlebotomistSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, config },
      update: { config, deletedAt: null },
    });
    return this.resolve(tenantId, branchId);
  }

  /** Merge a stored partial settings JSON over the module defaults. */
  private merge(stored: Prisma.JsonValue | undefined): PhlebotomistSettingsMap {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return DEFAULT_PHLEBOTOMIST_SETTINGS;
    }
    const partial = stored as Partial<PhlebotomistSettingsMap>;
    return {
      autoAssignStrategy:
        partial.autoAssignStrategy ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.autoAssignStrategy,
      maxVisitsPerPhleboPerDay:
        partial.maxVisitsPerPhleboPerDay ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.maxVisitsPerPhleboPerDay,
      defaultServiceRadiusKm:
        partial.defaultServiceRadiusKm ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.defaultServiceRadiusKm,
      isPatientPickPhleboAllowed:
        partial.isPatientPickPhleboAllowed ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.isPatientPickPhleboAllowed,
      defaultKitItems:
        partial.defaultKitItems ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.defaultKitItems,
      minColdChainTempC:
        partial.minColdChainTempC ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.minColdChainTempC,
      maxColdChainTempC:
        partial.maxColdChainTempC ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.maxColdChainTempC,
      isPhotoOfSampleAtPickupRequired:
        partial.isPhotoOfSampleAtPickupRequired ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.isPhotoOfSampleAtPickupRequired,
      isGeoTagCaptureOnCollectionEnabled:
        partial.isGeoTagCaptureOnCollectionEnabled ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.isGeoTagCaptureOnCollectionEnabled,
      shiftStart:
        partial.shiftStart ?? DEFAULT_PHLEBOTOMIST_SETTINGS.shiftStart,
      shiftEnd: partial.shiftEnd ?? DEFAULT_PHLEBOTOMIST_SETTINGS.shiftEnd,
      pickupSlaMinutes:
        partial.pickupSlaMinutes ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.pickupSlaMinutes,
      dropBackSlaHours:
        partial.dropBackSlaHours ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.dropBackSlaHours,
      isManagerAlertOnSlaBreachEnabled:
        partial.isManagerAlertOnSlaBreachEnabled ??
        DEFAULT_PHLEBOTOMIST_SETTINGS.isManagerAlertOnSlaBreachEnabled,
    };
  }
}
