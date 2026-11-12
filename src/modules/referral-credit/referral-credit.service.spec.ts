import {
  InvoicePaymentStatus,
  ReferralClientType,
  type ReferralPanelSettings,
} from '@prisma/client';
import { ReferralCreditService } from './referral-credit.service';
import {
  ReferralOrderCreditLimitException,
  ReferralReportCreditDaysException,
} from './referral-credit.exceptions';
import type { PrismaService } from '../../prisma/prisma.service';

/**
 * Regression: a Postpaid referral panel that paid its invoice in full stayed
 * blocked ("dues unpaid for 9 day(s), beyond the allowed credit period of 3
 * day(s)") because the credit gate summed only `PaymentDetails`, while invoice
 * receipts land on the invoice ledger. Orders on a COMPLETED invoice must now
 * count as settled — the same rule as the Outstanding report — while PARTIAL,
 * cancelled and un-invoiced dues still block.
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

const daysAgo = (n: number) => new Date(Date.now() - n * DAY_MS);

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
const build = (orders: FakeOrder[], panelSetting = setting()) => {
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
  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue({
        referralPanelId: 'panel-1',
        referredByDoctorId: null,
        internalReferralId: null,
        externalReferralId: null,
      }),
      findMany,
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
