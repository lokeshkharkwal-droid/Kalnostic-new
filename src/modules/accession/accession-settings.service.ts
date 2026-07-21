import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import {
  AccessionSettingsMap,
  DEFAULT_ACCESSION_SETTINGS,
} from './constants/accession-settings.default';
import { SaveAccessionSettingsDto } from './dto/save-accession-settings.dto';

/**
 * Per-branch accession settings (PDF §G). Tenant-scoped **and** branch-level
 * (CLAUDE.md §4.7): every query carries `tenantId` + `branchId`. Mirrors
 * `OrderFieldConfigService` — one row per branch (unique `(tenantId, branchId)`),
 * the payload held as JSON. A branch with no saved row uses
 * `DEFAULT_ACCESSION_SETTINGS`; `resolve` always returns a complete settings map
 * (stored values merged over the defaults), which the sample service uses for TAT
 * thresholds and the FE uses to populate action-modal dropdowns.
 */
@Injectable()
export class AccessionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve the effective settings for a branch: the stored partial merged over
   * the module defaults (never throws for a missing row — returns defaults).
   * @param tenantId tenant scope
   * @param branchId active branch (null falls back to defaults)
   */
  async resolve(
    tenantId: string,
    branchId: string | null,
  ): Promise<AccessionSettingsMap> {
    if (!branchId) return DEFAULT_ACCESSION_SETTINGS;
    const row = await this.prisma.accessionSetting.findFirst({
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
  ): Promise<AccessionSettingsMap> {
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
    dto: SaveAccessionSettingsDto,
  ): Promise<AccessionSettingsMap> {
    await this.branchService.findById(branchId, tenantId);
    const config = dto as Prisma.InputJsonValue;
    await this.prisma.accessionSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId, config },
      update: { config, deletedAt: null },
    });
    return this.resolve(tenantId, branchId);
  }

  /** Merge a stored partial settings JSON over the module defaults. */
  private merge(stored: Prisma.JsonValue | undefined): AccessionSettingsMap {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return DEFAULT_ACCESSION_SETTINGS;
    }
    const partial = stored as Partial<AccessionSettingsMap>;
    return {
      tubeTypes: partial.tubeTypes ?? DEFAULT_ACCESSION_SETTINGS.tubeTypes,
      sampleConditions:
        partial.sampleConditions ?? DEFAULT_ACCESSION_SETTINGS.sampleConditions,
      repeatReasons:
        partial.repeatReasons ?? DEFAULT_ACCESSION_SETTINGS.repeatReasons,
      discardMethods:
        partial.discardMethods ?? DEFAULT_ACCESSION_SETTINGS.discardMethods,
      rejectionReasons:
        partial.rejectionReasons ?? DEFAULT_ACCESSION_SETTINGS.rejectionReasons,
      logisticsTypes:
        partial.logisticsTypes ?? DEFAULT_ACCESSION_SETTINGS.logisticsTypes,
      tat: partial.tat ?? DEFAULT_ACCESSION_SETTINGS.tat,
    };
  }
}
