import { Injectable } from '@nestjs/common';
import {
  ExternalIdCounterType,
  ExternalIdFormat,
  ExternalIdPurpose,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { RegistrationSettingsService } from './registration-settings.service';

/** Parts used to build a formatted external id. */
export interface ExternalIdParts {
  now: Date;
  /** Branch short name, used only by the BRANCH_* formats. */
  shortName: string;
  /** 1-based running sequence for the format's reset period. */
  sequence: number;
}

/**
 * Fixed, non-configurable entity prefix prepended to every AUTO-generated
 * external id (never applied to manual/NONE entries). The operator cannot change
 * these from the settings UI.
 */
export const EXTERNAL_ID_PREFIX: Record<ExternalIdPurpose, string> = {
  [ExternalIdPurpose.ORDER]: 'ORD',
  [ExternalIdPurpose.QUOTATION]: 'QUO',
  [ExternalIdPurpose.APPOINTMENT]: 'APT',
  [ExternalIdPurpose.PATIENT]: 'PAT',
};

/** The next external id a branch would mint for a purpose (peek, no bump). */
export interface ExternalIdPreview {
  format: ExternalIdFormat;
  /** Formatted preview, or null when the format is NONE (manual entry). */
  value: string | null;
}

/**
 * Which reset period a format's running sequence uses. NONE has no counter
 * (manual entry).
 */
export function counterTypeForFormat(
  format: ExternalIdFormat,
): ExternalIdCounterType | null {
  switch (format) {
    case ExternalIdFormat.YMD_DAILY:
    case ExternalIdFormat.BRANCH_YMD_DAILY:
    case ExternalIdFormat.YMD_COMPACT_DAILY:
      return ExternalIdCounterType.DAILY;
    case ExternalIdFormat.YM_MONTHLY:
    case ExternalIdFormat.BRANCH_YM_MONTHLY:
      return ExternalIdCounterType.MONTHLY;
    case ExternalIdFormat.Y_YEARLY:
    case ExternalIdFormat.BRANCH_Y_YEARLY:
      return ExternalIdCounterType.YEARLY;
    case ExternalIdFormat.NONE:
    default:
      return null;
  }
}

/**
 * Whether a counter of the given type has rolled over since `lastResetAt`
 * (so the next sequence should restart at 1). Mirrors the legacy Kishan
 * `branch_order_counter` day/month/year comparison.
 */
export function shouldResetCounter(
  counterType: ExternalIdCounterType,
  lastResetAt: Date,
  now: Date,
): boolean {
  const sameYear = lastResetAt.getFullYear() === now.getFullYear();
  const sameMonth = sameYear && lastResetAt.getMonth() === now.getMonth();
  const sameDay = sameMonth && lastResetAt.getDate() === now.getDate();
  switch (counterType) {
    case ExternalIdCounterType.DAILY:
      return !sameDay;
    case ExternalIdCounterType.MONTHLY:
      return !sameMonth;
    case ExternalIdCounterType.YEARLY:
      return !sameYear;
    default:
      return false;
  }
}

/**
 * Pure formatter porting the legacy Kishan external-order-id builder
 * (`LabMasterCodes::getFormattedExternalOrderIdForOrderSequence`, RP-code
 * variants excluded). Full 4-digit year; sequence zero-padded to 4 digits.
 * Returns null for NONE. Examples (2026-04-19, seq 1, shortName "ABC"):
 *   YMD_DAILY → 2026/04/19/0001    BRANCH_YMD_DAILY → ABC/2026/04/19/0001
 *   YMD_COMPACT_DAILY → 202604190001
 *   YM_MONTHLY → 2026/04/0001      BRANCH_YM_MONTHLY → ABC/2026/04/0001
 *   Y_YEARLY → 2026/0001           BRANCH_Y_YEARLY → ABC/2026/0001
 */
export function formatExternalId(
  format: ExternalIdFormat,
  parts: ExternalIdParts,
): string | null {
  const { now, shortName, sequence } = parts;
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const seq4 = String(sequence).padStart(4, '0');
  const branch = shortName.trim();
  switch (format) {
    case ExternalIdFormat.YMD_DAILY:
      return `${yyyy}/${mm}/${dd}/${seq4}`;
    case ExternalIdFormat.BRANCH_YMD_DAILY:
      return `${branch}/${yyyy}/${mm}/${dd}/${seq4}`;
    case ExternalIdFormat.YMD_COMPACT_DAILY:
      return `${yyyy}${mm}${dd}${seq4}`;
    case ExternalIdFormat.YM_MONTHLY:
      return `${yyyy}/${mm}/${seq4}`;
    case ExternalIdFormat.BRANCH_YM_MONTHLY:
      return `${branch}/${yyyy}/${mm}/${seq4}`;
    case ExternalIdFormat.Y_YEARLY:
      return `${yyyy}/${seq4}`;
    case ExternalIdFormat.BRANCH_Y_YEARLY:
      return `${branch}/${yyyy}/${seq4}`;
    case ExternalIdFormat.NONE:
    default:
      return null;
  }
}

/**
 * Generates the legacy-style external id for a branch from its configured
 * `ExternalIdFormat` (Registration Settings), backed by a per-branch running
 * counter (`ExternalIdCounter`) that resets daily/monthly/yearly. Orders,
 * quotations, appointments and patients (UMID) keep independent counters (see
 * `ExternalIdPurpose`) and each auto-generated id carries its fixed entity
 * prefix (`EXTERNAL_ID_PREFIX`: ORD/QUO/APT/PAT). `generateInTx` runs inside the
 * caller's create transaction so the bump commits atomically with the record;
 * `generateCommitted` bumps in its own transaction (used by the globally-unique
 * patient UMID path so a failed insert + retry always advances the counter);
 * `previewNext` peeks without bumping so the frontend can show a disabled
 * preview before submit. The prefix is applied only to AUTO ids — NONE (manual
 * entry) returns null and is stored as the operator typed it, un-prefixed.
 */
@Injectable()
export class ExternalIdService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
    private readonly registrationSettingsService: RegistrationSettingsService,
  ) {}

  /**
   * The branch's configured format for a purpose (each of ORDER / QUOTATION /
   * APPOINTMENT / PATIENT has its own dropdown in Registration Settings).
   */
  async getConfiguredFormat(
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
  ): Promise<ExternalIdFormat> {
    const settings = await this.registrationSettingsService.getForBranch(
      tenantId,
      branchId,
    );
    switch (purpose) {
      case ExternalIdPurpose.QUOTATION:
        return settings.Quotation_AutoIncrementExternalQuoteIdFormat;
      case ExternalIdPurpose.APPOINTMENT:
        return settings.Appointment_AutoIncrementExternalAppointmentIdFormat;
      case ExternalIdPurpose.PATIENT:
        return settings.Patients_AutoIncrementExternalPatientIdFormat;
      case ExternalIdPurpose.ORDER:
      default:
        return settings.OrderIdConfiguration_AutoIncrementExternalOrderIdFormat;
    }
  }

  /**
   * Atomically bump the branch's counter for `(purpose, format)` and return the
   * prefixed formatted id (e.g. `ORD2026/04/19/0001`). MUST be called inside a
   * transaction (`tx`) — typically the create transaction. Returns null when
   * `format` is NONE (manual entry — no prefix applied).
   * @param shortName the branch's short name (BRANCH_* formats)
   */
  async generateInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
    format: ExternalIdFormat,
    shortName: string,
  ): Promise<string | null> {
    const counterType = counterTypeForFormat(format);
    if (!counterType) return null; // NONE → manual entry

    const now = new Date();
    const existing = await tx.externalIdCounter.findUnique({
      where: {
        tenantId_branchId_purpose_counterType: {
          tenantId,
          branchId,
          purpose,
          counterType,
        },
      },
    });

    let sequence: number;
    if (!existing) {
      await tx.externalIdCounter.create({
        data: {
          tenantId,
          branchId,
          purpose,
          counterType,
          counter: 1,
          lastResetAt: now,
        },
      });
      sequence = 1;
    } else {
      const reset = shouldResetCounter(counterType, existing.lastResetAt, now);
      sequence = reset ? 1 : existing.counter + 1;
      await tx.externalIdCounter.update({
        where: { id: existing.id },
        data: {
          counter: sequence,
          lastResetAt: reset ? now : existing.lastResetAt,
        },
      });
    }

    return this.withPrefix(
      purpose,
      formatExternalId(format, { now, shortName, sequence }),
    );
  }

  /**
   * Like `generateInTx` but bumps the counter in its OWN committed transaction
   * (not the caller's), so the allocated number survives even if the caller's
   * subsequent insert is rolled back. Used by the globally-unique patient UMID
   * path: on a unique-index collision the caller retries and, because this bump
   * already committed, the next attempt draws a fresh (higher) sequence —
   * guaranteeing forward progress. A burned number on collision is acceptable.
   * Returns null when `format` is NONE.
   */
  async generateCommitted(
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
    format: ExternalIdFormat,
    shortName: string,
  ): Promise<string | null> {
    if (!counterTypeForFormat(format)) return null; // NONE → manual entry
    return this.prisma.withTenant(tenantId, (tx) =>
      this.generateInTx(tx, tenantId, branchId, purpose, format, shortName),
    );
  }

  /**
   * Resolve the branch's configured format + short name and mint a committed,
   * prefixed id in its own transaction. Returns `{ format, value }` — `value` is
   * null when the branch's format is NONE (manual entry). Used by the
   * globally-unique patient UMID path, which retries this on collision.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async generateCommittedForBranch(
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
  ): Promise<ExternalIdPreview> {
    const format = await this.getConfiguredFormat(tenantId, branchId, purpose);
    if (!counterTypeForFormat(format)) return { format, value: null };
    const branch = await this.branchService.findById(branchId, tenantId);
    const value = await this.generateCommitted(
      tenantId,
      branchId,
      purpose,
      format,
      branch.shortName,
    );
    return { format, value };
  }

  /** Prepend the fixed entity prefix to an auto id; pass through null (NONE). */
  private withPrefix(
    purpose: ExternalIdPurpose,
    formatted: string | null,
  ): string | null {
    return formatted === null ? null : EXTERNAL_ID_PREFIX[purpose] + formatted;
  }

  /**
   * Peek the next external id a branch would mint for a purpose, WITHOUT
   * bumping the counter — used by the frontend to show the disabled preview on
   * the create form. Returns `{ format, value: null }` when the format is NONE.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async previewNext(
    tenantId: string,
    branchId: string,
    purpose: ExternalIdPurpose,
  ): Promise<ExternalIdPreview> {
    const branch = await this.branchService.findById(branchId, tenantId);
    const format = await this.getConfiguredFormat(tenantId, branchId, purpose);
    const counterType = counterTypeForFormat(format);
    if (!counterType) return { format, value: null };

    const now = new Date();
    const existing = await this.prisma.externalIdCounter.findUnique({
      where: {
        tenantId_branchId_purpose_counterType: {
          tenantId,
          branchId,
          purpose,
          counterType,
        },
      },
    });
    const nextSequence =
      !existing || shouldResetCounter(counterType, existing.lastResetAt, now)
        ? 1
        : existing.counter + 1;
    return {
      format,
      value: this.withPrefix(
        purpose,
        formatExternalId(format, {
          now,
          shortName: branch.shortName,
          sequence: nextSequence,
        }),
      ),
    };
  }
}
