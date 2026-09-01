import { Injectable } from '@nestjs/common';
import { createCanvas } from '@napi-rs/canvas';
import JsBarcode from 'jsbarcode';
import {
  AccessionBarcodeResetCycle,
  AccessionBarcodeSeparator,
  Prisma,
} from '@prisma/client';
import { UploadsService } from '../uploads/uploads.service';

/** Separator glyphs for `AccessionSetting.SampleBarcodeSettings_Separator`. */
const SEPARATOR_TOKENS: Record<AccessionBarcodeSeparator, string> = {
  NONE: '',
  HYPHEN: '-',
  SLASH: '/',
  UNDERSCORE: '_',
};

/**
 * Barcodes are system-sequential starting at 10001. The counter reuses the
 * per-branch `AccessionSetting.SampleBarcodeSettings_CurrentNumber`, but is
 * floored so the first emitted value is always 10001 (even for a fresh row
 * whose counter defaults to 0, or after a reset-cycle rollover).
 */
const BARCODE_NUMBER_FLOOR = 10000;

/** S3 key sub-folder under which rendered barcode images are stored. */
const BARCODE_FOLDER = 'barcodes';

/**
 * Barcode value allocation + Code 39 image rendering/storage for accession
 * samples. Owns two concerns:
 *
 * 1. **Value** — atomically allocates the next sequential barcode id from the
 *    branch's `AccessionSetting.SampleBarcodeSettings_*` counter (shared with
 *    the Settings-page preview), formatted `{prefix}{sep}{number}{sep}{suffix}`.
 * 2. **Image** — renders that value as a Code 39 PNG (`jsbarcode`) and uploads
 *    it to S3 via {@link UploadsService}, returning the stored asset URL.
 *
 * Wired through the module (CLAUDE.md rule #3): `AccessionModule` imports
 * `UploadsModule` and provides this service; it is injected into
 * `OrderSampleService`.
 */
@Injectable()
export class BarcodeService {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Allocate the next sequential barcode VALUE for a branch, inside an existing
   * (already tenant-scoped) transaction. Finds-or-creates the branch's
   * `AccessionSetting` row, applies the configured reset cycle, then advances
   * `SampleBarcodeSettings_CurrentNumber` — **skipping any composed value that is
   * already in use by an `OrderSample` in this tenant** — and formats the value
   * using the branch's prefix/suffix/separator/number-length. The number is
   * floored so the first value is `10001`.
   *
   * **Concurrency:** the counter is advanced with an atomic `{ increment }`
   * `update`, which takes a row lock on the `AccessionSetting` row for the life
   * of the transaction; a concurrent allocation blocks on that lock until this
   * one commits, so two callers can never receive the same value.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope
   * @param branchId active branch (barcodes are branch-level counters, so the
   *   settings row this counter lives on is keyed per branch)
   * @returns the formatted barcode value (e.g. `10001`)
   */
  async allocateNumberInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const now = new Date();
    const row =
      (await tx.accessionSetting.findFirst({
        where: { tenantId, branchId, deletedAt: null },
      })) ??
      (await tx.accessionSetting.create({ data: { tenantId, branchId } }));

    const didReset = this.shouldReset(
      row.SampleBarcodeSettings_ResetInterval,
      row.SampleBarcodeSettings_LastResetAt,
      now,
    );

    // Floor the counter (and stamp the reset) before advancing, so the first
    // emitted value is 10001. This `update` also takes the row lock that
    // serialises concurrent allocations.
    const base = didReset ? 0 : row.SampleBarcodeSettings_CurrentNumber;
    await tx.accessionSetting.update({
      where: { id: row.id },
      data: {
        SampleBarcodeSettings_CurrentNumber: Math.max(
          base,
          BARCODE_NUMBER_FLOOR,
        ),
        SampleBarcodeSettings_LastResetAt: didReset
          ? now
          : (row.SampleBarcodeSettings_LastResetAt ?? now),
      },
    });

    // Advance one at a time, skipping any value already taken by a sample in the
    // tenant, until an unused barcode is found.
    for (;;) {
      const advanced = await tx.accessionSetting.update({
        where: { id: row.id },
        data: { SampleBarcodeSettings_CurrentNumber: { increment: 1 } },
        select: { SampleBarcodeSettings_CurrentNumber: true },
      });
      const value = this.compose({
        prefix: row.SampleBarcodeSettings_Prefix,
        separator: row.SampleBarcodeSettings_Separator,
        number: advanced.SampleBarcodeSettings_CurrentNumber,
        numberLength: row.SampleBarcodeSettings_NumberLength,
        suffix: row.SampleBarcodeSettings_Suffix,
      });
      const clash = await tx.orderSample.findFirst({
        where: { tenantId, barcode: value, deletedAt: null },
        select: { id: true },
      });
      if (!clash) return value;
    }
  }

  /**
   * Render a barcode value as a Code 39 PNG and upload it to S3.
   * @param value the barcode value/id to encode (e.g. `10001`)
   * @param tenantId owning tenant (namespaces the S3 key)
   * @returns the stored image's public S3 URL
   * @throws UploadNotConfiguredException / UploadFailedException if S3 is
   *   unset or the put fails (the caller rolls the barcode write back)
   */
  async generateAndUpload(value: string, tenantId: string): Promise<string> {
    const png = this.renderCode39Png(value);
    const { url } = await this.uploads.uploadBuffer(
      png,
      'image/png',
      '.png',
      tenantId,
      BARCODE_FOLDER,
    );
    return url;
  }

  /**
   * Render a Code 39 barcode PNG for the given value. Uses a fixed generation
   * configuration (bar width, height, human-readable value shown) so the same
   * value always produces a consistently scannable image.
   * @param value the barcode value/id to encode
   * @returns the PNG image bytes
   */
  renderCode39Png(value: string): Buffer {
    const canvas = createCanvas(300, 120);
    JsBarcode(canvas, value, {
      format: 'CODE39',
      displayValue: true,
      width: 2,
      height: 60,
      margin: 10,
      fontSize: 16,
    });
    return canvas.toBuffer('image/png');
  }

  /** Compose `{prefix}{sep}{paddedNumber}{sep}{suffix}` (mirrors the Settings preview). */
  private compose(params: {
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
   * Whether the barcode counter has rolled over since `lastResetAt` for its
   * configured cycle (so the next value restarts). `NEVER` never resets.
   */
  private shouldReset(
    cycle: AccessionBarcodeResetCycle,
    lastResetAt: Date | null,
    now: Date,
  ): boolean {
    if (cycle === AccessionBarcodeResetCycle.NEVER || !lastResetAt)
      return false;
    const sameYear = lastResetAt.getFullYear() === now.getFullYear();
    const sameMonth = sameYear && lastResetAt.getMonth() === now.getMonth();
    const sameDay = sameMonth && lastResetAt.getDate() === now.getDate();
    switch (cycle) {
      case AccessionBarcodeResetCycle.DAILY:
        return !sameDay;
      case AccessionBarcodeResetCycle.MONTHLY:
        return !sameMonth;
      case AccessionBarcodeResetCycle.YEARLY:
        return !sameYear;
      default:
        return false;
    }
  }
}
