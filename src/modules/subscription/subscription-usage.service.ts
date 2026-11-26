import { Injectable } from '@nestjs/common';
import {
  AdapterStatus,
  BranchStatus,
  BranchType,
  CommunicationStatus,
  MessagingChannel,
  OrderStatus,
  PaymentEntryType,
  Prisma,
  StaffStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  BUSINESS_FEATURE,
  DAILY_BUSINESS_FEATURES,
  MONTHLY_BUSINESS_FEATURES,
  SUBSCRIPTION_REPORT_TYPE,
  USER_ROLE_GROUPS,
  type ReportContext,
  type SubscriptionReportType,
} from './business-feature.constants';
import { BusinessFeatureCountDto } from './dto/business-feature-count.dto';

/** One metric's value — a `count` (integer) or a monetary/aggregate `value`. */
export interface FeatureMetric {
  count?: number;
  value?: number;
}

/** The computed `{ code → metric }` map returned for a business + period. */
export type FeatureCountMap = Record<string, FeatureMetric>;

/**
 * The EzHealthTrack-shaped response envelope the subscription scheduler expects
 * (`{ s, m, data }`, `s === '200'` = ok). Returned raw by the controller so the
 * scheduler sees a byte-compatible payload, NOT the Kalnostics `{ success, data,
 * meta }` envelope.
 */
export interface SubscriptionUsageEnvelope {
  s: string;
  m: string;
  data?: unknown;
}

/** Narrow window the collector computes over. */
interface ReportWindow {
  reportType: SubscriptionReportType;
  from: Date;
  to: Date;
  features: string[];
}

/**
 * Computes a tenant's per-period subscription "business feature" usage — the
 * Kalnostics port of EzHealthTrack's `BusinessFeature::getFeaturesCount` +
 * `BusinessSubscriptionReport::generateReport`.
 *
 * The flow is **inbound pull, send-only**: the external subscription scheduler
 * calls our endpoint per business (daily + monthly); we resolve the integer
 * `business_id` to a tenant, aggregate the requested metrics live from the
 * transactional tables (inside `prisma.withTenant` so RLS is satisfied without a
 * JWT), and **return** them in the response. Nothing is persisted locally.
 *
 * Metrics with no Kalnostics source yet (transaction failures, PG commission,
 * marketing-channel split, in-app login counts, CMS) are emitted as `0` with a
 * TODO, mirroring the legacy endpoint which shipped those fields stubbed.
 */
@Injectable()
export class SubscriptionUsageService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Generate the scheduled daily/monthly feature report for one business
   * (`GET /subscription/api/generate-business-feature-report`). Picks the feature
   * set + window from `reportContext`, computes the metrics, and returns them in
   * the EzHealthTrack envelope. Returns `{ s: '500' }` when the business id does
   * not resolve to a tenant (mirrors the legacy "Business not found!" response).
   * @param businessIdRaw the integer business id as a string (validated upstream)
   * @param reportContext `yesterday` | `today` (daily) or `monthly`
   */
  async generateBusinessFeatureReport(
    businessIdRaw: string,
    reportContext: ReportContext,
  ): Promise<SubscriptionUsageEnvelope> {
    const tenant = await this.resolveTenantByBusinessId(businessIdRaw);
    if (!tenant) {
      return { s: '500', m: 'Business not found!' };
    }

    const window = this.resolveWindow(reportContext);
    const features = await this.collectFeatures(
      tenant.id,
      window.from,
      window.to,
      window.features,
    );

    return {
      s: '200',
      m: 'Business feature report',
      data: {
        business_id: Number(businessIdRaw),
        report_type: window.reportType,
        report_context: reportContext,
        date_from: this.formatDateTime(window.from),
        date_to: this.formatDateTime(window.to),
        features,
      },
    };
  }

  /**
   * Ad-hoc feature count for an arbitrary period + feature subset
   * (`POST /subscription/api/business-feature-count`, ports
   * `actionBusinessFeatureCount`). Returns the `{ code → metric }` map directly
   * on `data`.
   * @param dto the business id, optional period bounds, and optional feature list
   */
  async businessFeatureCount(
    dto: BusinessFeatureCountDto,
  ): Promise<SubscriptionUsageEnvelope> {
    const tenant = await this.resolveTenantByBusinessId(dto.business_id);
    if (!tenant) {
      return { s: '500', m: 'Business not found!' };
    }

    const now = new Date();
    const from = dto.bill_period_from
      ? this.parsePeriodBound(dto.bill_period_from, 'start')
      : this.startOfDay(now);
    const to = dto.bill_period_to
      ? this.parsePeriodBound(dto.bill_period_to, 'end')
      : this.endOfDay(now);
    const features =
      dto.bill_features && dto.bill_features.length > 0
        ? dto.bill_features
        : [
            ...new Set([
              ...DAILY_BUSINESS_FEATURES,
              ...MONTHLY_BUSINESS_FEATURES,
            ]),
          ];

    const data = await this.collectFeatures(tenant.id, from, to, features);
    return { s: '200', m: 'Business feature details', data };
  }

  /**
   * Resolve the integer subscription `business_id` to a (non-deleted) tenant.
   * The subscription server keys clients by the integer id, which Kalnostics
   * holds as `legacyTenantId` (migrated tenants) or `exchangeTenantId` (native).
   * `Tenant` is platform-level (no RLS), so this reads directly.
   * @param businessIdRaw the integer business id as a string
   * @returns the tenant `{ id }`, or `null` when no tenant matches
   */
  private async resolveTenantByBusinessId(
    businessIdRaw: string,
  ): Promise<{ id: string } | null> {
    const businessId = Number(businessIdRaw);
    if (!Number.isInteger(businessId) || businessId <= 0) {
      return null;
    }
    return this.prisma.tenant.findFirst({
      where: {
        deletedAt: null,
        OR: [{ legacyTenantId: businessId }, { exchangeTenantId: businessId }],
      },
      select: { id: true },
    });
  }

  /**
   * Aggregate the requested feature codes for a tenant over `[from, to]`. All
   * reads run inside `prisma.withTenant` so the RLS tenant GUC is set (the call
   * is unauthenticated — no JWT sets the context). Only the bundles whose
   * features were requested are queried.
   * @param tenantId the resolved tenant uuid
   * @param from inclusive period start
   * @param to inclusive period end
   * @param features the feature codes to compute
   */
  private async collectFeatures(
    tenantId: string,
    from: Date,
    to: Date,
    features: string[],
  ): Promise<FeatureCountMap> {
    const want = new Set(features);
    const result: FeatureCountMap = {};
    const period = { gte: from, lte: to };

    await this.prisma.withTenant(
      tenantId,
      async (tx) => {
        // ── Orders (daily) ──
        if (
          want.has(BUSINESS_FEATURE.ORDER_COUNT) ||
          want.has(BUSINESS_FEATURE.ORDER_AMOUNT) ||
          want.has(BUSINESS_FEATURE.DISCOUNT_AMOUNT) ||
          want.has(BUSINESS_FEATURE.BILLED_AMOUNT)
        ) {
          const agg = await tx.order.aggregate({
            where: {
              tenantId,
              deletedAt: null,
              status: OrderStatus.ORDER,
              createdAt: period,
            },
            _count: { _all: true },
            _sum: { grossAmount: true, discountAmount: true, netAmount: true },
          });
          if (want.has(BUSINESS_FEATURE.ORDER_COUNT)) {
            result[BUSINESS_FEATURE.ORDER_COUNT] = { count: agg._count._all };
          }
          if (want.has(BUSINESS_FEATURE.ORDER_AMOUNT)) {
            result[BUSINESS_FEATURE.ORDER_AMOUNT] = {
              value: agg._sum.grossAmount ?? 0,
            };
          }
          if (want.has(BUSINESS_FEATURE.DISCOUNT_AMOUNT)) {
            result[BUSINESS_FEATURE.DISCOUNT_AMOUNT] = {
              value: agg._sum.discountAmount ?? 0,
            };
          }
          if (want.has(BUSINESS_FEATURE.BILLED_AMOUNT)) {
            result[BUSINESS_FEATURE.BILLED_AMOUNT] = {
              value: agg._sum.netAmount ?? 0,
            };
          }
        }

        // ── Transactions: collected payments (daily) ──
        if (
          want.has(BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL) ||
          want.has(BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL_AMOUNT)
        ) {
          const agg = await tx.paymentDetails.aggregate({
            where: {
              tenantId,
              deletedAt: null,
              revertedAt: null,
              entryType: PaymentEntryType.PAYMENT,
              createdAt: period,
            },
            _count: { _all: true },
            _sum: { paidAmount: true },
          });
          if (want.has(BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL)) {
            result[BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL] = {
              count: agg._count._all,
            };
          }
          if (want.has(BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL_AMOUNT)) {
            result[BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL_AMOUNT] = {
              value: this.toNumber(agg._sum.paidAmount),
            };
          }
        }

        // ── Transactions: refunds (daily) ──
        if (
          want.has(BUSINESS_FEATURE.TRANSACTION_REFUNDED) ||
          want.has(BUSINESS_FEATURE.TRANSACTION_REFUNDED_AMOUNT)
        ) {
          const agg = await tx.paymentDetails.aggregate({
            where: {
              tenantId,
              deletedAt: null,
              revertedAt: null,
              entryType: PaymentEntryType.REFUND,
              createdAt: period,
            },
            _count: { _all: true },
            _sum: { refundAmount: true },
          });
          if (want.has(BUSINESS_FEATURE.TRANSACTION_REFUNDED)) {
            result[BUSINESS_FEATURE.TRANSACTION_REFUNDED] = {
              count: agg._count._all,
            };
          }
          if (want.has(BUSINESS_FEATURE.TRANSACTION_REFUNDED_AMOUNT)) {
            result[BUSINESS_FEATURE.TRANSACTION_REFUNDED_AMOUNT] = {
              value: this.toNumber(agg._sum.refundAmount),
            };
          }
        }

        // ── Messaging (daily) ── count messages created in-period that were sent.
        if (want.has(BUSINESS_FEATURE.SMS)) {
          result[BUSINESS_FEATURE.SMS] = {
            count: await this.channelCount(
              tx,
              tenantId,
              MessagingChannel.SMS,
              period,
            ),
          };
        }
        if (want.has(BUSINESS_FEATURE.EMAIL)) {
          result[BUSINESS_FEATURE.EMAIL] = {
            count: await this.channelCount(
              tx,
              tenantId,
              MessagingChannel.EMAIL,
              period,
            ),
          };
        }
        if (want.has(BUSINESS_FEATURE.WHATSAPP)) {
          result[BUSINESS_FEATURE.WHATSAPP] = {
            count: await this.channelCount(
              tx,
              tenantId,
              MessagingChannel.WHATSAPP,
              period,
            ),
          };
        }

        // ── Branches (monthly) ── one read, counted by type in memory.
        const branchFeatures = [
          BUSINESS_FEATURE.BRANCH,
          BUSINESS_FEATURE.OPD,
          BUSINESS_FEATURE.IPD,
          BUSINESS_FEATURE.DIAGNOSTIC,
          BUSINESS_FEATURE.RADIOLOGY,
          BUSINESS_FEATURE.COLLECTION_CENTER,
          BUSINESS_FEATURE.INVENTORY,
        ];
        if (branchFeatures.some((f) => want.has(f))) {
          const branches = await tx.branch.findMany({
            where: { tenantId, deletedAt: null, status: BranchStatus.ACTIVE },
            select: { branchType: true },
          });
          const byType = (t: BranchType) =>
            branches.filter((b) => b.branchType === t).length;
          if (want.has(BUSINESS_FEATURE.BRANCH)) {
            // Total active branches, excluding the COMBINED umbrella (EZHT parity).
            result[BUSINESS_FEATURE.BRANCH] = {
              count: branches.filter(
                (b) => b.branchType !== BranchType.COMBINED,
              ).length,
            };
          }
          if (want.has(BUSINESS_FEATURE.OPD)) {
            result[BUSINESS_FEATURE.OPD] = { count: byType(BranchType.OPD) };
          }
          if (want.has(BUSINESS_FEATURE.IPD)) {
            result[BUSINESS_FEATURE.IPD] = { count: byType(BranchType.IPD) };
          }
          if (want.has(BUSINESS_FEATURE.DIAGNOSTIC)) {
            result[BUSINESS_FEATURE.DIAGNOSTIC] = {
              count: byType(BranchType.DIAGNOSTIC),
            };
          }
          if (want.has(BUSINESS_FEATURE.RADIOLOGY)) {
            result[BUSINESS_FEATURE.RADIOLOGY] = {
              count: byType(BranchType.RADIOLOGY),
            };
          }
          if (want.has(BUSINESS_FEATURE.COLLECTION_CENTER)) {
            result[BUSINESS_FEATURE.COLLECTION_CENTER] = {
              count: byType(BranchType.COLLECTION_CENTER),
            };
          }
          if (want.has(BUSINESS_FEATURE.INVENTORY)) {
            // EZHT "inventory" = pharmacy/inventory branches.
            result[BUSINESS_FEATURE.INVENTORY] = {
              count: byType(BranchType.PHARMACY) + byType(BranchType.INVENTORY),
            };
          }
        }

        // ── Branches with the Inventory module enabled (monthly) ──
        if (want.has(BUSINESS_FEATURE.BRANCH_INVENTORY)) {
          const rows = await tx.branchModule.findMany({
            where: {
              tenantId,
              moduleKey: 'inventory',
              isEnabled: true,
              deletedAt: null,
            },
            select: { branchId: true },
            distinct: ['branchId'],
          });
          result[BUSINESS_FEATURE.BRANCH_INVENTORY] = { count: rows.length };
        }

        // ── Users (monthly) ──
        const needWeb = want.has(BUSINESS_FEATURE.USER_WEB);
        if (
          want.has(BUSINESS_FEATURE.USERS) ||
          needWeb ||
          want.has(BUSINESS_FEATURE.USER_SALES) ||
          want.has(BUSINESS_FEATURE.USER_PHLEBO) ||
          want.has(BUSINESS_FEATURE.USER_DOCTOR) ||
          want.has(BUSINESS_FEATURE.USER_ASSISTANT) ||
          want.has(BUSINESS_FEATURE.USER_WEB_B2B)
        ) {
          const total =
            want.has(BUSINESS_FEATURE.USERS) || needWeb
              ? await tx.tenantStaffMembership.count({
                  where: {
                    tenantId,
                    deletedAt: null,
                    status: StaffStatus.ACTIVE,
                  },
                })
              : 0;
          const doctor =
            want.has(BUSINESS_FEATURE.USER_DOCTOR) || needWeb
              ? await this.distinctUsersByRole(
                  tx,
                  tenantId,
                  USER_ROLE_GROUPS.DOCTOR,
                )
              : 0;
          const assistant =
            want.has(BUSINESS_FEATURE.USER_ASSISTANT) || needWeb
              ? await this.distinctUsersByRole(
                  tx,
                  tenantId,
                  USER_ROLE_GROUPS.ASSISTANT,
                )
              : 0;
          const b2b =
            want.has(BUSINESS_FEATURE.USER_WEB_B2B) || needWeb
              ? await this.distinctUsersByRole(
                  tx,
                  tenantId,
                  USER_ROLE_GROUPS.B2B,
                )
              : 0;

          if (want.has(BUSINESS_FEATURE.USERS)) {
            result[BUSINESS_FEATURE.USERS] = { count: total };
          }
          if (want.has(BUSINESS_FEATURE.USER_DOCTOR)) {
            result[BUSINESS_FEATURE.USER_DOCTOR] = { count: doctor };
          }
          if (want.has(BUSINESS_FEATURE.USER_ASSISTANT)) {
            result[BUSINESS_FEATURE.USER_ASSISTANT] = { count: assistant };
          }
          if (want.has(BUSINESS_FEATURE.USER_WEB_B2B)) {
            result[BUSINESS_FEATURE.USER_WEB_B2B] = { count: b2b };
          }
          if (want.has(BUSINESS_FEATURE.USER_SALES)) {
            result[BUSINESS_FEATURE.USER_SALES] = {
              count: await this.distinctUsersByRole(
                tx,
                tenantId,
                USER_ROLE_GROUPS.SALES,
              ),
            };
          }
          if (want.has(BUSINESS_FEATURE.USER_PHLEBO)) {
            result[BUSINESS_FEATURE.USER_PHLEBO] = {
              count: await this.distinctUsersByRole(
                tx,
                tenantId,
                USER_ROLE_GROUPS.PHLEBO,
              ),
            };
          }
          if (needWeb) {
            // Web users = total active − (doctor + assistant + b2b). The two
            // in-app login counts (sales/phlebo app) have no source yet (0), so
            // they drop out of the subtraction. See gaps below.
            result[BUSINESS_FEATURE.USER_WEB] = {
              count: Math.max(0, total - (doctor + assistant + b2b)),
            };
          }
        }

        // ── Machines / adapters (monthly) ── active (non-INACTIVE) lab adapters.
        if (
          want.has(BUSINESS_FEATURE.MACHINE_INTERFACE) ||
          want.has(BUSINESS_FEATURE.ADAPTER)
        ) {
          const adapters = await tx.labAdapter.count({
            where: {
              tenantId,
              deletedAt: null,
              status: { not: AdapterStatus.INACTIVE },
            },
          });
          if (want.has(BUSINESS_FEATURE.MACHINE_INTERFACE)) {
            result[BUSINESS_FEATURE.MACHINE_INTERFACE] = { count: adapters };
          }
          if (want.has(BUSINESS_FEATURE.ADAPTER)) {
            result[BUSINESS_FEATURE.ADAPTER] = { count: adapters };
          }
        }
      },
      { maxWait: 10000, timeout: 30000 },
    );

    // ── Gap metrics (no Kalnostics source yet) ── emit 0 for requested codes,
    //    mirroring the legacy endpoint which shipped these stubbed. TODO: wire a
    //    real source when one exists (payment-gateway failures/commission, the
    //    marketing-channel split, in-app login sessions, CMS enablement).
    const countGaps = [
      BUSINESS_FEATURE.ADAPTER_FILLED,
      BUSINESS_FEATURE.TRANSACTION_FAILED,
      BUSINESS_FEATURE.WHATSAPP_MARKETING,
      BUSINESS_FEATURE.CMS,
      BUSINESS_FEATURE.USER_APP_SALES,
      BUSINESS_FEATURE.USER_APP_PHLEBO,
    ];
    const valueGaps = [
      BUSINESS_FEATURE.TRANSACTION_COMMISSION_EZ,
      BUSINESS_FEATURE.TRANSACTION_COMMISSION_PG,
    ];
    for (const code of countGaps) {
      if (want.has(code) && !(code in result)) result[code] = { count: 0 };
    }
    for (const code of valueGaps) {
      if (want.has(code) && !(code in result)) result[code] = { value: 0 };
    }

    return result;
  }

  /** Count in-period, delivered (SENT) messages for one channel. */
  private channelCount(
    tx: Prisma.TransactionClient,
    tenantId: string,
    channel: MessagingChannel,
    period: { gte: Date; lte: Date },
  ): Promise<number> {
    return tx.communicationLog.count({
      where: {
        tenantId,
        channel,
        status: CommunicationStatus.SENT,
        deletedAt: null,
        createdAt: period,
      },
    });
  }

  /**
   * Count DISTINCT people holding any of `roleKeys` via an active branch profile
   * in the tenant (a user with the role at several branches counts once).
   */
  private async distinctUsersByRole(
    tx: Prisma.TransactionClient,
    tenantId: string,
    roleKeys: readonly string[],
  ): Promise<number> {
    const rows = await tx.userBranchProfile.findMany({
      where: {
        tenantId,
        deletedAt: null,
        isActive: true,
        authRole: { key: { in: [...roleKeys] } },
      },
      select: { personId: true },
      distinct: ['personId'],
    });
    return rows.length;
  }

  /** Pick the feature set + day/month window for a scheduled `reportContext`. */
  private resolveWindow(reportContext: ReportContext): ReportWindow {
    if (reportContext === 'monthly') {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
      const to = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
        999,
      );
      return {
        reportType: SUBSCRIPTION_REPORT_TYPE.MONTHLY,
        from,
        to,
        features: MONTHLY_BUSINESS_FEATURES,
      };
    }
    // daily — yesterday (default) or today
    const day = new Date();
    if (reportContext === 'yesterday') {
      day.setDate(day.getDate() - 1);
    }
    return {
      reportType: SUBSCRIPTION_REPORT_TYPE.DAILY,
      from: this.startOfDay(day),
      to: this.endOfDay(day),
      features: DAILY_BUSINESS_FEATURES,
    };
  }

  /** Parse a `YYYY-MM-DD` or `YYYY-MM-DD HH:mm:ss` bound to a Date (date-only → day edge). */
  private parsePeriodBound(raw: string, edge: 'start' | 'end'): Date {
    const trimmed = raw.trim();
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
    const normalized = dateOnly
      ? `${trimmed} ${edge === 'start' ? '00:00:00' : '23:59:59'}`
      : trimmed;
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      // Fall back to today's edge rather than crash on a malformed bound.
      const now = new Date();
      return edge === 'start' ? this.startOfDay(now) : this.endOfDay(now);
    }
    return parsed;
  }

  /** 00:00:00.000 of `d` (local). */
  private startOfDay(d: Date): Date {
    const out = new Date(d);
    out.setHours(0, 0, 0, 0);
    return out;
  }

  /** 23:59:59.999 of `d` (local). */
  private endOfDay(d: Date): Date {
    const out = new Date(d);
    out.setHours(23, 59, 59, 999);
    return out;
  }

  /** Format a Date as `YYYY-MM-DD HH:mm:ss` (the legacy report date format). */
  private formatDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
      `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
    );
  }

  /** Prisma `Decimal | null` → plain number (0 when null). */
  private toNumber(value: Prisma.Decimal | null): number {
    return value ? value.toNumber() : 0;
  }
}
