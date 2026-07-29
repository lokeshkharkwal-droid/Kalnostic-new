import { Injectable } from '@nestjs/common';
import {
  Prisma,
  RegistrationIdResetCycle,
  RegistrationIdSeparator,
  RegistrationIdSequence,
  RegistrationIdSequenceType,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchService } from '../branch/branch.service';
import { SaveRegistrationIdSequenceDto } from './dto/save-registration-id-sequence.dto';

const SEQUENCE_TYPES: RegistrationIdSequenceType[] = [
  RegistrationIdSequenceType.ORDER,
  RegistrationIdSequenceType.QUOTATION,
  RegistrationIdSequenceType.APPOINTMENT,
  RegistrationIdSequenceType.PATIENT,
];

const SEPARATOR_TOKENS: Record<RegistrationIdSeparator, string> = {
  NONE: '',
  HYPHEN: '-',
  SLASH: '/',
  UNDERSCORE: '_',
};

export interface RegistrationIdSequenceWithPreview extends RegistrationIdSequence {
  preview: string;
}

export interface RegistrationIdSequenceEnums {
  sequenceTypes: RegistrationIdSequenceType[];
  separators: RegistrationIdSeparator[];
  resetCycles: RegistrationIdResetCycle[];
}

/**
 * Reusable per-branch ID-generation config for Registration (Order/Quotation/
 * Appointment/Patient-UMID external ids) — one `RegistrationIdSequence` row
 * per `(tenantId, branchId, sequenceType)`, mirrors `AppointmentSettingsService`'s
 * get-or-create shape. `generateNext` is the atomic counter-bump entry point
 * consuming modules (order/quotation/appointment/patient creation) will call
 * to mint a real id; it is intentionally not exposed over HTTP here.
 */
@Injectable()
export class RegistrationIdSequenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchService: BranchService,
  ) {}

  /**
   * Fetch (creating defaults where missing) all 4 sequence configs for the
   * active branch, each with a computed (not persisted) `preview` string.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async getForBranch(
    tenantId: string,
    branchId: string,
  ): Promise<RegistrationIdSequenceWithPreview[]> {
    await this.branchService.findById(branchId, tenantId);
    const rows = await Promise.all(
      SEQUENCE_TYPES.map((sequenceType) =>
        this.prisma.registrationIdSequence.upsert({
          where: {
            tenantId_branchId_sequenceType: {
              tenantId,
              branchId,
              sequenceType,
            },
          },
          create: { tenantId, branchId, sequenceType },
          update: {},
        }),
      ),
    );
    return rows.map((row) => this.withPreview(row));
  }

  /**
   * Save (partial patch) one sequence type's prefix/suffix/separator/
   * numberLength/resetCycle for the active branch. The running counter is
   * never touched here.
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async saveForBranch(
    tenantId: string,
    branchId: string,
    sequenceType: RegistrationIdSequenceType,
    dto: SaveRegistrationIdSequenceDto,
  ): Promise<RegistrationIdSequenceWithPreview> {
    await this.branchService.findById(branchId, tenantId);
    const row = await this.prisma.registrationIdSequence.upsert({
      where: {
        tenantId_branchId_sequenceType: { tenantId, branchId, sequenceType },
      },
      create: { tenantId, branchId, sequenceType, ...dto },
      update: { ...dto },
    });
    return this.withPreview(row);
  }

  /** Enum values exposed for frontend select controls. */
  getEnums(): RegistrationIdSequenceEnums {
    return {
      sequenceTypes: Object.values(RegistrationIdSequenceType),
      separators: Object.values(RegistrationIdSeparator),
      resetCycles: Object.values(RegistrationIdResetCycle),
    };
  }

  /**
   * Atomically mint the next id for a branch's sequence, applying the
   * configured reset cycle. Runs in a serializable transaction so concurrent
   * callers never receive the same number (the old system's
   * `branch_order_counter` bug this design fixes).
   * @throws BranchNotFoundException if the branch is missing/other tenant
   */
  async generateNext(
    tenantId: string,
    branchId: string,
    sequenceType: RegistrationIdSequenceType,
  ): Promise<{ id: string; sequenceNumber: number }> {
    await this.branchService.findById(branchId, tenantId);
    return this.prisma.$transaction(
      async (tx) => {
        const row = await tx.registrationIdSequence.upsert({
          where: {
            tenantId_branchId_sequenceType: {
              tenantId,
              branchId,
              sequenceType,
            },
          },
          create: { tenantId, branchId, sequenceType },
          update: {},
        });

        const now = new Date();
        const reset = this.shouldReset(row.resetCycle, row.lastResetAt, now);
        const nextNumber = reset ? 1 : row.currentNumber + 1;

        const updated = await tx.registrationIdSequence.update({
          where: { id: row.id },
          data: {
            currentNumber: nextNumber,
            lastResetAt: reset ? now : (row.lastResetAt ?? now),
          },
        });

        return {
          id: this.composeId({
            prefix: updated.prefix,
            separator: updated.separator,
            number: nextNumber,
            numberLength: updated.numberLength,
            suffix: updated.suffix,
          }),
          sequenceNumber: nextNumber,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  /** Compose the id string: `{prefix}{sep}{paddedNumber}{sep}{suffix}`. */
  private composeId(params: {
    prefix: string;
    separator: RegistrationIdSeparator;
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

  /** Whether the given reset cycle has rolled over since `lastResetAt`. */
  private shouldReset(
    resetCycle: RegistrationIdResetCycle,
    lastResetAt: Date | null,
    now: Date,
  ): boolean {
    if (resetCycle === RegistrationIdResetCycle.NEVER) return false;
    if (!lastResetAt) return true;

    const sameYear = lastResetAt.getFullYear() === now.getFullYear();
    const sameMonth = sameYear && lastResetAt.getMonth() === now.getMonth();
    const sameDay = sameMonth && lastResetAt.getDate() === now.getDate();

    switch (resetCycle) {
      case RegistrationIdResetCycle.DAILY:
        return !sameDay;
      case RegistrationIdResetCycle.MONTHLY:
        return !sameMonth;
      case RegistrationIdResetCycle.YEARLY:
        return !sameYear;
      default:
        return false;
    }
  }

  /** Attach the computed next-value preview to a stored sequence row. */
  private withPreview(
    row: RegistrationIdSequence,
  ): RegistrationIdSequenceWithPreview {
    return {
      ...row,
      preview: this.composeId({
        prefix: row.prefix,
        separator: row.separator,
        number: row.currentNumber + 1,
        numberLength: row.numberLength,
        suffix: row.suffix,
      }),
    };
  }
}
