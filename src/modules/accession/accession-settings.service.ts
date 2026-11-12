import { Injectable } from '@nestjs/common';
import {
  AccessionBarcodeResetCycle,
  AccessionBarcodeSeparator,
  AccessionSetting,
  BarcodeCounterKind,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BARCODE_NUMBER_FLOOR } from './barcode.service';
import { BranchService } from '../branch/branch.service';
import { ValidationException } from '../../common/exceptions/kaltros.exception';
import {
  AccessionSettingsMap,
  AccessionTypedSettings,
  DEFAULT_ACCESSION_SETTINGS,
  DEFAULT_ACCESSION_TYPED_SETTINGS,
} from './constants/accession-settings.default';
import { SaveAccessionSettingsDto } from './dto/save-accession-settings.dto';

const SEPARATOR_TOKENS: Record<AccessionBarcodeSeparator, string> = {
  NONE: '',
  HYPHEN: '-',
  SLASH: '/',
  UNDERSCORE: '_',
};

/**
 * The tenant's last-issued order and sample barcode numbers
 * (`TenantBarcodeCounter`); both at least {@link BARCODE_NUMBER_FLOOR}.
 */
interface BarcodeCounters {
  order: number;
  sample: number;
}

/** Full Accession Module Settings response: master-data lists + typed columns + computed barcode previews. */
export type AccessionSettingsResponse = AccessionSettingsMap &
  AccessionTypedSettings & {
    SampleBarcodeSettings_Preview: string;
    OrderBarcodeSettings_Preview: string;
  };

/**
 * Per-branch Accession Module Settings (LIMS Settings Master — Accession
 * Module). Tenant-scoped **and** branch-level (CLAUDE.md §4.7): every query
 * carries `tenantId` + `branchId`. Mirrors `OrderFieldConfigService` — one row
 * per branch (unique `(tenantId, branchId)`). Master-data lists live in the
 * `config` JSON column; Sample Barcode Settings and Accession
 * (TAT/acceptance-window/barcode-mapping) settings are native typed columns.
 * A branch with no saved row uses the module defaults; `resolve` always
 * returns a complete settings object (stored values merged over the
 * defaults), which `OrderSampleService` uses for TAT thresholds and the
 * FE uses to populate both the Settings page and action-modal dropdowns.
 */
@Injectable()
export class AccessionSettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Resolve the effective settings for a branch: the stored row merged over
   * the module defaults (never throws for a missing branch/row — returns
   * defaults).
   * @param tenantId tenant scope
   * @param branchId active branch (null falls back to defaults)
   */
  async resolve(
    tenantId: string,
    branchId: string | null,
  ): Promise<AccessionSettingsResponse> {
    const counters = await this.barcodeCounters(tenantId);
    if (!branchId) {
      return this.toResponse(
        { config: {}, ...DEFAULT_ACCESSION_TYPED_SETTINGS },
        counters,
      );
    }
    const row = await this.prisma.accessionSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
    });
    return this.toResponse(
      row ?? { config: {}, ...DEFAULT_ACCESSION_TYPED_SETTINGS },
      counters,
    );
  }

  /**
   * Read the tenant's barcode counters. Barcode numbers are tenant-wide (every
   * branch draws from the same counter and only chooses the format), so the
   * "current number" and "next barcode" preview are the same on every branch.
   * A tenant that has not issued a barcode yet reads as the floor (10000).
   */
  private async barcodeCounters(tenantId: string): Promise<BarcodeCounters> {
    const rows = await this.prisma.tenantBarcodeCounter.findMany({
      where: { tenantId },
      select: { kind: true, currentNumber: true },
    });
    const current = (kind: BarcodeCounterKind) =>
      Math.max(
        rows.find((r) => r.kind === kind)?.currentNumber ??
          BARCODE_NUMBER_FLOOR,
        BARCODE_NUMBER_FLOOR,
      );
    return {
      order: current(BarcodeCounterKind.ORDER),
      sample: current(BarcodeCounterKind.SAMPLE),
    };
  }

  /**
   * Fetch the branch's effective settings (validates the branch first).
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<AccessionSettingsResponse> {
    await this.branchService.findById(branchId, tenantId);
    return this.resolve(tenantId, branchId);
  }

  /**
   * Save (partial patch) the branch's settings, then return the effective
   * settings. Master-data lists are merged with the previously-stored config
   * (an omitted list keeps its last-saved value, it does not revert to the
   * module default); typed columns are patched individually.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   * @throws ValidationException if min/max accept-time or warning/critical
   *   thresholds are inconsistent with each other
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    dto: SaveAccessionSettingsDto,
  ): Promise<AccessionSettingsResponse> {
    await this.branchService.findById(branchId, tenantId);
    const existing = await this.prisma.accessionSetting.upsert({
      where: { tenantId_branchId: { tenantId, branchId } },
      create: { tenantId, branchId },
      update: {},
    });

    const { masterDataPatch, columnsPatch } = this.splitDto(dto);
    const mergedConfig = {
      ...this.mergeConfig(existing.config),
      ...masterDataPatch,
    };
    this.validateThresholds(existing, columnsPatch);

    const row = await this.prisma.accessionSetting.update({
      where: { id: existing.id },
      data: {
        ...columnsPatch,
        config: mergedConfig,
        deletedAt: null,
      },
    });
    return this.toResponse(row, await this.barcodeCounters(tenantId));
  }

  /** Split a save DTO into its JSON-blob master-data patch and its native-column patch. */
  private splitDto(dto: SaveAccessionSettingsDto): {
    masterDataPatch: Partial<AccessionSettingsMap>;
    columnsPatch: Partial<AccessionTypedSettings>;
  } {
    const {
      MasterData_TubeTypes,
      MasterData_SampleConditions,
      MasterData_RepeatReasons,
      MasterData_ErrorReasons,
      MasterData_HoldReasons,
      MasterData_DiscardMethods,
      MasterData_RejectionReasons,
      MasterData_LogisticsTypes,
      // Barcode reset cycles are retired: numbers come from the tenant-wide
      // counter, which never resets (it would re-issue printed numbers). Still
      // accepted from older clients, but never stored.
      SampleBarcodeSettings_ResetInterval: _sampleResetIgnored,
      OrderBarcodeSettings_ResetInterval: _orderResetIgnored,
      ...columnsPatch
    } = dto;
    const masterDataPatch: Partial<AccessionSettingsMap> = {
      ...(MasterData_TubeTypes !== undefined && { MasterData_TubeTypes }),
      ...(MasterData_SampleConditions !== undefined && {
        MasterData_SampleConditions,
      }),
      ...(MasterData_RepeatReasons !== undefined && {
        MasterData_RepeatReasons,
      }),
      ...(MasterData_ErrorReasons !== undefined && { MasterData_ErrorReasons }),
      ...(MasterData_HoldReasons !== undefined && { MasterData_HoldReasons }),
      ...(MasterData_DiscardMethods !== undefined && {
        MasterData_DiscardMethods,
      }),
      ...(MasterData_RejectionReasons !== undefined && {
        MasterData_RejectionReasons,
      }),
      ...(MasterData_LogisticsTypes !== undefined && {
        MasterData_LogisticsTypes,
      }),
    };
    return { masterDataPatch, columnsPatch };
  }

  /** Cross-field validation the DTO's per-field decorators can't express on a partial patch. */
  private validateThresholds(
    existing: AccessionSetting,
    patch: Partial<AccessionTypedSettings>,
  ): void {
    const min =
      patch.Accession_MinimumTimeToAcceptSampleMinutes ??
      existing.Accession_MinimumTimeToAcceptSampleMinutes;
    const max =
      patch.Accession_MaximumTimeToAcceptSampleMinutes ??
      existing.Accession_MaximumTimeToAcceptSampleMinutes;
    if (min > max) {
      throw new ValidationException(
        'Minimum time to accept a sample cannot exceed the maximum time.',
        { Accession_MinimumTimeToAcceptSampleMinutes: 'must be <= maximum' },
      );
    }

    const warning =
      patch.Accession_WarningThresholdMinutes ??
      existing.Accession_WarningThresholdMinutes;
    const critical =
      patch.Accession_CriticalThresholdMinutes ??
      existing.Accession_CriticalThresholdMinutes;
    if (critical > warning) {
      throw new ValidationException(
        'Critical threshold cannot exceed the warning threshold.',
        { Accession_CriticalThresholdMinutes: 'must be <= warning threshold' },
      );
    }
    if (warning > max) {
      throw new ValidationException(
        'Warning threshold cannot exceed the maximum time to accept a sample.',
        { Accession_WarningThresholdMinutes: 'must be <= maximum time' },
      );
    }
  }

  /** Merge a stored partial master-data JSON over the module defaults. */
  private mergeConfig(
    stored: Prisma.JsonValue | undefined,
  ): AccessionSettingsMap {
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
      return DEFAULT_ACCESSION_SETTINGS;
    }
    const partial = stored as Partial<AccessionSettingsMap>;
    return {
      MasterData_TubeTypes:
        partial.MasterData_TubeTypes ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_TubeTypes,
      MasterData_SampleConditions:
        partial.MasterData_SampleConditions ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_SampleConditions,
      MasterData_RepeatReasons:
        partial.MasterData_RepeatReasons ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_RepeatReasons,
      MasterData_ErrorReasons:
        partial.MasterData_ErrorReasons ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_ErrorReasons,
      MasterData_HoldReasons:
        partial.MasterData_HoldReasons ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_HoldReasons,
      MasterData_DiscardMethods:
        partial.MasterData_DiscardMethods ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_DiscardMethods,
      MasterData_RejectionReasons:
        partial.MasterData_RejectionReasons ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_RejectionReasons,
      MasterData_LogisticsTypes:
        partial.MasterData_LogisticsTypes ??
        DEFAULT_ACCESSION_SETTINGS.MasterData_LogisticsTypes,
    };
  }

  /** Compose the barcode id string: `{prefix}{sep}{paddedNumber}{sep}{suffix}`. */
  private composeBarcode(params: {
    prefix: string;
    separator: AccessionBarcodeSeparator;
    number: number;
    numberLength: number;
    suffix: string;
  }): string {
    const sep = SEPARATOR_TOKENS[params.separator];
    const paddedNumber = String(params.number).padStart(
      params.numberLength,
      '0',
    );
    return [params.prefix, paddedNumber, params.suffix]
      .filter((segment) => segment.length > 0)
      .join(sep);
  }

  /**
   * Flatten a stored (or in-memory default) row into the full API response
   * shape. The barcode "current number" and preview come from the tenant-wide
   * counters (`counters`), not the row's deprecated per-branch columns; the
   * row supplies only the branch's format. Reset intervals always read NEVER.
   */
  private toResponse(
    row: Pick<AccessionSetting, 'config'> & AccessionTypedSettings,
    counters: BarcodeCounters,
  ): AccessionSettingsResponse {
    return {
      ...this.mergeConfig(row.config),
      SampleBarcodeSettings_Prefix: row.SampleBarcodeSettings_Prefix,
      SampleBarcodeSettings_Suffix: row.SampleBarcodeSettings_Suffix,
      SampleBarcodeSettings_Separator: row.SampleBarcodeSettings_Separator,
      SampleBarcodeSettings_NumberLength:
        row.SampleBarcodeSettings_NumberLength,
      SampleBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle.NEVER,
      SampleBarcodeSettings_CurrentNumber: counters.sample,
      SampleBarcodeSettings_LastResetAt: row.SampleBarcodeSettings_LastResetAt,
      // Next sample barcode any branch of the tenant would issue, in this
      // branch's format.
      SampleBarcodeSettings_Preview: this.composeBarcode({
        prefix: row.SampleBarcodeSettings_Prefix,
        separator: row.SampleBarcodeSettings_Separator,
        number: counters.sample + 1,
        numberLength: row.SampleBarcodeSettings_NumberLength,
        suffix: row.SampleBarcodeSettings_Suffix,
      }),
      OrderBarcodeSettings_Prefix: row.OrderBarcodeSettings_Prefix,
      OrderBarcodeSettings_Suffix: row.OrderBarcodeSettings_Suffix,
      OrderBarcodeSettings_Separator: row.OrderBarcodeSettings_Separator,
      OrderBarcodeSettings_NumberLength: row.OrderBarcodeSettings_NumberLength,
      OrderBarcodeSettings_ResetInterval: AccessionBarcodeResetCycle.NEVER,
      OrderBarcodeSettings_CurrentNumber: counters.order,
      OrderBarcodeSettings_LastResetAt: row.OrderBarcodeSettings_LastResetAt,
      // Next order barcode any branch of the tenant would issue (always at least
      // 10001), in this branch's format.
      OrderBarcodeSettings_Preview: this.composeBarcode({
        prefix: row.OrderBarcodeSettings_Prefix,
        separator: row.OrderBarcodeSettings_Separator,
        number: counters.order + 1,
        numberLength: row.OrderBarcodeSettings_NumberLength,
        suffix: row.OrderBarcodeSettings_Suffix,
      }),
      Accession_MinimumTimeToAcceptSampleMinutes:
        row.Accession_MinimumTimeToAcceptSampleMinutes,
      Accession_MaximumTimeToAcceptSampleMinutes:
        row.Accession_MaximumTimeToAcceptSampleMinutes,
      Accession_WarningThresholdMinutes: row.Accession_WarningThresholdMinutes,
      Accession_CriticalThresholdMinutes:
        row.Accession_CriticalThresholdMinutes,
      Accession_InternalReferralAcceptanceThresholdMinutes:
        row.Accession_InternalReferralAcceptanceThresholdMinutes,
      Accession_ExternalReferralAcceptanceThresholdMinutes:
        row.Accession_ExternalReferralAcceptanceThresholdMinutes,
      Accession_AllowSampleBarcodeMappingBeforeAcceptInhouseOrders:
        row.Accession_AllowSampleBarcodeMappingBeforeAcceptInhouseOrders,
      Accession_AllowSampleBarcodeMappingBeforeAcceptInternalReferralOrders:
        row.Accession_AllowSampleBarcodeMappingBeforeAcceptInternalReferralOrders,
      Accession_AllowSampleBarcodeMappingBeforeAcceptExternalReferralOrders:
        row.Accession_AllowSampleBarcodeMappingBeforeAcceptExternalReferralOrders,
      Accession_AllowSampleBarcodeMappingAfterAcceptInhouseOrders:
        row.Accession_AllowSampleBarcodeMappingAfterAcceptInhouseOrders,
      Accession_AllowSampleBarcodeMappingAfterAcceptInternalReferralOrders:
        row.Accession_AllowSampleBarcodeMappingAfterAcceptInternalReferralOrders,
      Accession_AllowSampleBarcodeMappingAfterAcceptExternalReferralOrders:
        row.Accession_AllowSampleBarcodeMappingAfterAcceptExternalReferralOrders,
      Accession_AllowSampleBarcodeMappingForOutsourceOrders:
        row.Accession_AllowSampleBarcodeMappingForOutsourceOrders,
    };
  }
}
