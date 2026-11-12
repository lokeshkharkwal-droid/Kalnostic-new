import { Injectable } from '@nestjs/common';
import {
  AccessionBarcodeSeparator,
  BarcodeCounterKind,
  Prisma,
} from '@prisma/client';
import { UploadsService } from '../uploads/uploads.service';
import { renderCode128Png as renderCode128PngImage } from '../../common/utils/barcode-image.util';

/** Separator glyphs for `AccessionSetting.*BarcodeSettings_Separator`. */
const SEPARATOR_TOKENS: Record<AccessionBarcodeSeparator, string> = {
  NONE: '',
  HYPHEN: '-',
  SLASH: '/',
  UNDERSCORE: '_',
};

/**
 * Barcode numbers start at 10001: a tenant's counter starts at this value (the
 * last number "issued") and never goes below it.
 */
export const BARCODE_NUMBER_FLOOR = 10000;

/**
 * Clash-probe sizing for the rare case where the number the tenant counter
 * issues is already in use (a value issued in another branch format, imported
 * data, or a request still running on the old per-branch code during the
 * deploy that introduced the counter). The skip checks runs of consecutive
 * numbers, one `IN (...)` query per run, growing from
 * {@link BARCODE_CLASH_PROBE_MIN_SIZE} by {@link BARCODE_CLASH_PROBE_GROWTH}×
 * up to {@link BARCODE_CLASH_PROBE_MAX_SIZE}, so even a long run of used
 * numbers costs only a few queries. Normally the issued number is free and the
 * first probe returns it.
 */
export const BARCODE_CLASH_PROBE_MIN_SIZE = 100;
/** Each probe is this many times larger than the previous one, up to the max. */
export const BARCODE_CLASH_PROBE_GROWTH = 4;
/** Largest probe; keeps one `IN (...)` list well inside query-parameter limits. */
export const BARCODE_CLASH_PROBE_MAX_SIZE = 5000;

/** A branch's barcode format (prefix/separator/zero-padding/suffix). */
interface BarcodeFormat {
  prefix: string;
  separator: AccessionBarcodeSeparator;
  numberLength: number;
  suffix: string;
}

/** Format for a branch with no saved Accession Settings (the column defaults). */
const DEFAULT_BARCODE_FORMAT: BarcodeFormat = {
  prefix: '',
  separator: AccessionBarcodeSeparator.NONE,
  numberLength: 5,
  suffix: '',
};

/**
 * Barcode value allocation + Code 128 image rendering/storage for orders and
 * accession samples. Owns two concerns:
 *
 * 1. **Value** — issues the next number from the tenant-wide
 *    `TenantBarcodeCounter` (one counter for order barcodes, one for sample
 *    barcodes) and formats it with the branch's Accession Settings
 *    (`{prefix}{sep}{number}{sep}{suffix}`).
 * 2. **Image** — renders that value as a Code 128 PNG (`jsbarcode`) and uploads
 *    it to S3 via {@link UploadsService}, returning the stored asset URL.
 *
 * **Why one counter per tenant:** barcodes must be unique across all of a
 * tenant's branches. Per-branch counters forced each branch to skip every
 * number the others had used; a quiet branch fell ~1,800 numbers behind and its
 * order transaction timed out on every attempt (DIAGNOSTICS-BHAINSA,
 * 2026-11-07). A single tenant counter never issues a used number.
 *
 * **Concurrency / transaction safety:** the counter is advanced by one
 * `INSERT … ON CONFLICT DO UPDATE SET current_number = current_number + 1
 * RETURNING` statement inside the caller's transaction. It locks the counter row
 * until that transaction ends, so concurrent allocations from any branch queue
 * on it and each receives a distinct number; the very first allocation of a
 * tenant creates the row in the same statement (no create race). If the
 * caller's transaction rolls back, the increment rolls back with it, so a
 * failed order or collection gives its number back. Lock order is always
 * tenant row → ORDER counter → SAMPLE counter (order creation holds the tenant
 * row first; collection only takes the SAMPLE counter), so no deadlock cycle.
 *
 * Wired through the module (CLAUDE.md rule #3): `AccessionModule` imports
 * `UploadsModule` and provides this service; it is injected into
 * `OrderSampleService` and `OrderService`.
 */
@Injectable()
export class BarcodeService {
  constructor(private readonly uploads: UploadsService) {}

  /**
   * Allocate the next SAMPLE barcode value inside an existing (already
   * tenant-scoped) transaction: the next number from the tenant's SAMPLE
   * counter, formatted with the branch's `SampleBarcodeSettings_*`. Checked
   * against the tenant's samples (`OrderSample.barcode`) and moved past any
   * value already in use.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope (owns the counter)
   * @param branchId branch whose barcode format is used
   * @returns the formatted barcode value (e.g. `10001`)
   */
  async allocateNumberInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const settings = await tx.accessionSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
      select: {
        SampleBarcodeSettings_Prefix: true,
        SampleBarcodeSettings_Separator: true,
        SampleBarcodeSettings_NumberLength: true,
        SampleBarcodeSettings_Suffix: true,
      },
    });
    const format: BarcodeFormat = settings
      ? {
          prefix: settings.SampleBarcodeSettings_Prefix,
          separator: settings.SampleBarcodeSettings_Separator,
          numberLength: settings.SampleBarcodeSettings_NumberLength,
          suffix: settings.SampleBarcodeSettings_Suffix,
        }
      : DEFAULT_BARCODE_FORMAT;
    return this.allocateInTx(
      tx,
      tenantId,
      BarcodeCounterKind.SAMPLE,
      format,
      async (values) =>
        (
          await tx.orderSample.findMany({
            where: { tenantId, barcode: { in: values }, deletedAt: null },
            select: { barcode: true },
          })
        ).map((s) => s.barcode),
    );
  }

  /**
   * Allocate the next ORDER barcode value inside an existing (already
   * tenant-scoped) transaction. The order barcode is a **separate entity** from
   * the sample barcode: its own tenant counter (kind ORDER) and the branch's
   * `OrderBarcodeSettings_*` format, checked only against **other orders**
   * (`Order.orderIdBarcode`) — never samples, so an order and a sample may share
   * a number. The tenant-wide unique index
   * `orders_tenant_order_barcode_active_unique` backs this up in the database.
   * @param tx active Prisma transaction client (already tenant-scoped)
   * @param tenantId tenant scope (owns the counter)
   * @param branchId branch whose barcode format is used
   * @returns the formatted order barcode value (e.g. `10001`)
   */
  async allocateOrderNumberInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    branchId: string,
  ): Promise<string> {
    const settings = await tx.accessionSetting.findFirst({
      where: { tenantId, branchId, deletedAt: null },
      select: {
        OrderBarcodeSettings_Prefix: true,
        OrderBarcodeSettings_Separator: true,
        OrderBarcodeSettings_NumberLength: true,
        OrderBarcodeSettings_Suffix: true,
      },
    });
    const format: BarcodeFormat = settings
      ? {
          prefix: settings.OrderBarcodeSettings_Prefix,
          separator: settings.OrderBarcodeSettings_Separator,
          numberLength: settings.OrderBarcodeSettings_NumberLength,
          suffix: settings.OrderBarcodeSettings_Suffix,
        }
      : DEFAULT_BARCODE_FORMAT;
    return this.allocateInTx(
      tx,
      tenantId,
      BarcodeCounterKind.ORDER,
      format,
      async (values) =>
        (
          await tx.order.findMany({
            where: {
              tenantId,
              orderIdBarcode: { in: values },
              deletedAt: null,
            },
            select: { orderIdBarcode: true },
          })
        ).map((o) => o.orderIdBarcode),
    );
  }

  /**
   * Issue the next number from the tenant counter, format it, and make sure the
   * value is not already in use. Normally it is free and this costs two queries
   * (increment + one check). If it is taken, the next free number is found with
   * batched probes and the counter is moved to it; this transaction already
   * holds the counter row lock from the increment, so that write is safe.
   */
  private async allocateInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: BarcodeCounterKind,
    format: BarcodeFormat,
    findTaken: (values: string[]) => Promise<Array<string | null>>,
  ): Promise<string> {
    const issued = await this.incrementCounterInTx(tx, tenantId, kind);
    const next = await this.findFreeNumberFrom(
      issued,
      (number) => this.compose({ ...format, number }),
      findTaken,
    );
    if (next.number !== issued) {
      await tx.tenantBarcodeCounter.update({
        where: { tenantId_kind: { tenantId, kind } },
        data: { currentNumber: next.number },
      });
    }
    return next.value;
  }

  /**
   * Atomically advance the tenant's counter for `kind` and return the new
   * value, creating the row (at 10001) on the tenant's first allocation. One
   * statement, so there is no read-then-write window: it takes the row lock (or,
   * for two simultaneous first allocations, waits for the other insert to
   * commit and then increments), and holds it until the transaction ends.
   */
  private async incrementCounterInTx(
    tx: Prisma.TransactionClient,
    tenantId: string,
    kind: BarcodeCounterKind,
  ): Promise<number> {
    const first = BARCODE_NUMBER_FLOOR + 1;
    const rows = await tx.$queryRaw<Array<{ current_number: number }>>`
      INSERT INTO "tenant_barcode_counters"
        ("id", "tenant_id", "kind", "current_number", "created_at", "updated_at")
      VALUES (
        gen_random_uuid()::text, ${tenantId}, ${kind}::"BarcodeCounterKind",
        ${first}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("tenant_id", "kind") DO UPDATE
        SET "current_number" = GREATEST("tenant_barcode_counters"."current_number" + 1, ${first}),
            "updated_at" = CURRENT_TIMESTAMP
      RETURNING "current_number"`;
    const counter = rows[0];
    // INSERT … ON CONFLICT DO UPDATE … RETURNING always yields exactly one row.
    if (!counter) throw new Error('Barcode counter upsert returned no row');
    return counter.current_number;
  }

  /**
   * The first number at or after `start` whose formatted value is not already
   * used. Checks runs of consecutive candidates, one query per run, with runs
   * growing from {@link BARCODE_CLASH_PROBE_MIN_SIZE} to
   * {@link BARCODE_CLASH_PROBE_MAX_SIZE}, so the query count stays small however
   * many used values follow `start`. Always terminates: a tenant has finitely
   * many used values, so some run eventually contains a free one.
   * @param start the first candidate number
   * @param format formats a number into the stored barcode value
   * @param findTaken returns which of the given values are already in use
   * @returns the chosen number and its formatted value
   */
  private async findFreeNumberFrom(
    start: number,
    format: (number: number) => string,
    findTaken: (values: string[]) => Promise<Array<string | null>>,
  ): Promise<{ number: number; value: string }> {
    let from = start;
    let size = BARCODE_CLASH_PROBE_MIN_SIZE;
    for (;;) {
      const candidates = Array.from({ length: size }, (_, i) => ({
        number: from + i,
        value: format(from + i),
      }));
      const taken = new Set(await findTaken(candidates.map((c) => c.value)));
      const free = candidates.find((c) => !taken.has(c.value));
      if (free) return free;
      from += size;
      size = Math.min(
        size * BARCODE_CLASH_PROBE_GROWTH,
        BARCODE_CLASH_PROBE_MAX_SIZE,
      );
    }
  }

  /**
   * Render a barcode value as a Code 128 PNG and upload it to S3.
   * @param value the barcode value/id to encode (e.g. `10001`)
   * @param tenantId owning tenant (namespaces the S3 key)
   * @returns the stored image's public S3 URL
   * @throws UploadNotConfiguredException / UploadFailedException if S3 is
   *   unset or the put fails (the caller rolls the barcode write back)
   */
  async generateAndUpload(value: string, tenantId: string): Promise<string> {
    const png = this.renderCode128Png(value);
    const { url } = await this.uploads.uploadBuffer(
      png,
      'image/png',
      '.png',
      tenantId,
    );
    return url;
  }

  /**
   * Render a Code 128 barcode PNG for the given value. Uses a fixed generation
   * configuration (bar width, height, human-readable value shown) so the same
   * value always produces a consistently scannable image. `jsbarcode` picks the
   * optimal Code 128 subset (128A/B/C) for the value automatically.
   * Delegates to the shared {@link renderCode128Png} util, which print
   * contexts also use to inline barcodes, so both always produce the same image.
   * @param value the barcode value/id to encode
   * @returns the PNG image bytes
   */
  renderCode128Png(value: string): Buffer {
    return renderCode128PngImage(value);
  }

  /** Compose `{prefix}{sep}{paddedNumber}{sep}{suffix}` (mirrors the Settings preview). */
  private compose(params: BarcodeFormat & { number: number }): string {
    const sep = SEPARATOR_TOKENS[params.separator];
    const paddedNumber = String(params.number).padStart(
      params.numberLength,
      '0',
    );
    return [params.prefix, paddedNumber, params.suffix]
      .filter((segment) => segment.length > 0)
      .join(sep);
  }
}
