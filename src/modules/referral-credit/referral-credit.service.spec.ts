import {
  InvoicePaymentStatus,
  ReferralClientType,
  type ReferralPanelSettings,
} from '@prisma/client';
import { ReferralCreditService } from './referral-credit.service';
import {
  ReferralOrderCreditLimitException,
  ReferralReportCreditDaysException,
  ReferralReportCreditLimitException,
} from './referral-credit.exceptions';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Regression 1: a Postpaid referral panel that paid its invoice in full stayed
 * blocked ("dues unpaid for 9 day(s), beyond the allowed credit period of 3
 * day(s)") because the credit gate summed only `PaymentDetails`, while invoice
 * receipts land on the invoice ledger. Orders on a COMPLETED invoice must now
 * count as settled — the same rule as the Outstanding report — while PARTIAL,
 * cancelled and un-invoiced dues still block.
 */

/**
 * Regression 2: a fully paid order (ORD-00518) could not open its report because
 * ANOTHER order of the same panel had ₹100 overdue. A fully paid order's reports
 * must open regardless of the panel's settings; only partly-paid / unpaid orders
 * stay credit-gated.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

interface FakeLink {
  deletedAt: Date | null;
  invoice: { deletedAt: Date | null; paymentStatus: InvoicePaymentStatus };
}
interface FakeOrder {
  id: string;
  referralPanelId: string;
  createdAt: Date;
  payments: Array<{ netAmount: number; paidAmount: number }>;
  invoiceLinks: FakeLink[];
}
type LinkFilter = {
  deletedAt: null;
  invoice: { deletedAt: null; paymentStatus: InvoicePaymentStatus };
};
type OrderWhere = {
  referralPanelId?: string;
  id?: { not: string };
  invoiceLinks?: { none: LinkFilter };
};

/** Payment state of the order whose report is being opened. */
interface FakeTarget {
  cancellationCharge: number;
  payments: Array<{
    netAmount: number;
    paidAmount: number;
    refundAmount: number;
    refundCharge: number;
  }>;
  invoiceLinks: Array<{ id: string }>;
}

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

/** The printed order's ledger: one row of `net`/`paid` (+ optional refund). */
const target = (
  net: number,
  paid: number,
  opts: { refund?: number; invoicePaid?: boolean } = {},
): FakeTarget => ({
  cancellationCharge: 0,
  payments: [
    { netAmount: net, paidAmount: paid, refundAmount: 0, refundCharge: 0 },
    ...(opts.refund
      ? [
          {
            netAmount: 0,
            paidAmount: 0,
            refundAmount: opts.refund,
            refundCharge: 0,
          },
        ]
      : []),
  ],
  invoiceLinks: opts.invoicePaid ? [{ id: 'link-1' }] : [],
});

/** Default printed order: unpaid, so the referral credit rules apply. */
const UNPAID_TARGET = target(1000, 0);

/** An unpaid postpaid order (net 1000, nothing collected at the counter). */
const unpaidOrder = (
  id: string,
  ageDays: number,
  invoiceLinks: FakeLink[] = [],
): FakeOrder => ({
  id,
  referralPanelId: 'panel-1',
  createdAt: daysAgo(ageDays),
  payments: [{ netAmount: 1000, paidAmount: 0 }],
  invoiceLinks,
});

const link = (
  paymentStatus: InvoicePaymentStatus,
  linkDeletedAt: Date | null = null,
): FakeLink => ({
  deletedAt: linkDeletedAt,
  invoice: { deletedAt: null, paymentStatus },
});

const setting = (
  overrides: Partial<ReferralPanelSettings> = {},
): ReferralPanelSettings =>
  ({
    settingName: 'Postpaid 3d',
    clientType: ReferralClientType.POSTPAID,
    creditLimitAmount: null,
    creditAllowedDays: 3,
    isRestrictReportCreditDays: true,
    isRestrictReportCreditLimit: false,
    isRestrictOrderCreditDays: false,
    isRestrictOrderCreditLimit: false,
    ...overrides,
  }) as unknown as ReferralPanelSettings;

/**
 * Builds the service over an in-memory Prisma double. `order.findMany` applies
 * the referral / exclude / `invoiceLinks.none` filters the way Postgres would,
 * so the tests exercise what the gate actually loads.
 */
const build = (
  orders: FakeOrder[],
  panelSetting = setting(),
  printed: FakeTarget = UNPAID_TARGET,
) => {
  const findMany = jest.fn(({ where }: { where: OrderWhere }) => {
    const none = where.invoiceLinks?.none;
    return Promise.resolve(
      orders.filter((o) => {
        if (
          where.referralPanelId &&
          o.referralPanelId !== where.referralPanelId
        )
          return false;
        if (where.id && o.id === where.id.not) return false;
        if (
          none &&
          o.invoiceLinks.some(
            (l) =>
              l.deletedAt === none.deletedAt &&
              l.invoice.deletedAt === none.invoice.deletedAt &&
              l.invoice.paymentStatus === none.invoice.paymentStatus,
          )
        )
          return false;
        return true;
      }),
    );
  });
  const printedOrder = {
    referralPanelId: 'panel-1',
    referredByDoctorId: null,
    internalReferralId: null,
    externalReferralId: null,
    ...printed,
  };
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(printedOrder),
      findMany,
    },
    labReport: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ orderItem: { order: printedOrder } }),
    },
    referralPanel: {
      findFirst: jest
        .fn()
        .mockResolvedValue({ referralPanelSettings: panelSetting }),
    },
  };
  const svc = new ReferralCreditService(prisma as unknown as PrismaService);
  return { svc, findMany };
};

describe('ReferralCreditService — invoice-settled orders', () => {
  it('excludes orders on a COMPLETED, non-deleted invoice in the query', async () => {
    const { svc, findMany } = build([]);
    await svc.assertReportAccessAllowedByOrderId('t1', 'o-print');
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({
      tenantId: 't1',
      referralPanelId: 'panel-1',
      invoiceLinks: {
        none: {
          deletedAt: null,
          invoice: {
            deletedAt: null,
            paymentStatus: InvoicePaymentStatus.COMPLETED,
          },
        },
      },
    });
  });

  it('allows the report once the invoice covering the old dues is fully paid', async () => {
    const { svc } = build([
      unpaidOrder('o-old', 9, [link(InvoicePaymentStatus.COMPLETED)]),
    ]);
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).resolves.toBeUndefined();
  });

  it('still blocks while the invoice is only PARTIAL', async () => {
    const { svc } = build([
      unpaidOrder('o-old', 9, [link(InvoicePaymentStatus.PARTIAL)]),
    ]);
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).rejects.toBeInstanceOf(ReferralReportCreditDaysException);
  });

  it('blocks again when the paid invoice was cancelled (link soft-deleted)', async () => {
    const { svc } = build([
      unpaidOrder('o-old', 9, [
        link(InvoicePaymentStatus.COMPLETED, daysAgo(1)),
      ]),
    ]);
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).rejects.toBeInstanceOf(ReferralReportCreditDaysException);
  });

  it('ages from the oldest un-invoiced due, not the settled one', async () => {
    const { svc } = build([
      unpaidOrder('o-settled', 9, [link(InvoicePaymentStatus.COMPLETED)]),
      unpaidOrder('o-uninvoiced', 5),
    ]);
    const err: unknown = await svc
      .assertReportAccessAllowedByOrderId('t1', 'o-print')
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ReferralReportCreditDaysException);
    expect((err as ReferralReportCreditDaysException).context).toMatchObject({
      ageDays: 5,
      creditAllowedDays: 3,
    });
  });

  it('order-creation credit limit ignores invoice-settled dues too', async () => {
    const orders = [
      unpaidOrder('o-settled', 9, [link(InvoicePaymentStatus.COMPLETED)]),
      unpaidOrder('o-open', 1),
    ];
    const limitSetting = setting({
      isRestrictReportCreditDays: false,
      isRestrictOrderCreditLimit: true,
      creditLimitAmount:
        1500 as unknown as ReferralPanelSettings['creditLimitAmount'],
    });
    // Outstanding 1000 (settled order excluded) < 1500 → allowed.
    await expect(
      build(orders, limitSetting).svc.assertOrderCreationAllowed('t1', {
        referralPanelId: 'panel-1',
      }),
    ).resolves.toBeUndefined();
    // Same dues on a PARTIAL invoice → 2000 ≥ 1500 → blocked.
    orders[0]!.invoiceLinks = [link(InvoicePaymentStatus.PARTIAL)];
    await expect(
      build(orders, limitSetting).svc.assertOrderCreationAllowed('t1', {
        referralPanelId: 'panel-1',
      }),
    ).rejects.toBeInstanceOf(ReferralOrderCreditLimitException);
  });
});

describe('ReferralCreditService — fully paid orders always open their reports', () => {
  /** The panel has an order with dues unpaid for 9 days (> 3 allowed). */
  const overduePanel = () => [unpaidOrder('o-overdue', 9)];
  const limitAndDays = setting({
    isRestrictReportCreditLimit: true,
    creditLimitAmount:
      500 as unknown as ReferralPanelSettings['creditLimitAmount'],
  });

  it('allows a fully paid order despite overdue panel dues — without loading the panel', async () => {
    const { svc, findMany } = build(
      overduePanel(),
      limitAndDays,
      target(180, 180),
    );
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).resolves.toBeUndefined();
    await expect(
      svc.assertReportAccessAllowedByReportId('t1', 'r-print'),
    ).resolves.toBeUndefined();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('allows an order settled on a fully paid (COMPLETED) invoice', async () => {
    const { svc } = build(
      overduePanel(),
      limitAndDays,
      target(1000, 0, { invoicePaid: true }),
    );
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).resolves.toBeUndefined();
  });

  it('allows a zero-value order (nothing to collect)', async () => {
    const { svc } = build(overduePanel(), limitAndDays, target(0, 0));
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).resolves.toBeUndefined();
  });

  it('still gates a partly paid order (180 net / 80 paid) on overdue panel dues', async () => {
    const { svc } = build(overduePanel(), setting(), target(180, 80));
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).rejects.toBeInstanceOf(ReferralReportCreditDaysException);
    await expect(
      svc.assertReportAccessAllowedByReportId('t1', 'r-print'),
    ).rejects.toBeInstanceOf(ReferralReportCreditDaysException);
  });

  it('treats a paid-then-refunded order as not fully paid (matches stored status)', async () => {
    const { svc } = build(
      overduePanel(),
      setting(),
      target(180, 180, { refund: 100 }),
    );
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).rejects.toBeInstanceOf(ReferralReportCreditDaysException);
  });

  it('still applies the credit limit to an unpaid order', async () => {
    const { svc } = build(
      overduePanel(),
      setting({
        isRestrictReportCreditDays: false,
        isRestrictReportCreditLimit: true,
        creditLimitAmount:
          500 as unknown as ReferralPanelSettings['creditLimitAmount'],
      }),
      target(1000, 0),
    );
    await expect(
      svc.assertReportAccessAllowedByOrderId('t1', 'o-print'),
    ).rejects.toBeInstanceOf(ReferralReportCreditLimitException);
  });
});
