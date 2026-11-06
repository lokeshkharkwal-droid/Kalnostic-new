import { LabReportService } from './lab-report.service';
import { OrderSampleService } from '../accession/accession-sample.service';
import { tenantContext } from '../../prisma/tenant-context';
import { ReferralPanelAccessDeniedException } from '../../common/exceptions/referral-panel-access.exception';

/**
 * B2B Referral Panel isolation on report printing / sharing and on the Order Console
 * overview's samples: a panel session acts only on its own orders; every other
 * session is untouched.
 */
describe('B2B panel isolation — report print / share / order samples', () => {
  const prisma = {
    order: { findFirst: jest.fn() },
    labReport: { findFirst: jest.fn() },
  };
  const reports = Object.create(LabReportService.prototype) as Record<
    string,
    unknown
  >;
  reports.prisma = prisma;
  const samples = Object.create(OrderSampleService.prototype) as Record<
    string,
    unknown
  >;
  samples.prisma = prisma;

  const orderGate = (t: string, o: string) =>
    (
      reports as unknown as {
        assertOrderInActivePanel: (t: string, o: string) => Promise<void>;
      }
    ).assertOrderInActivePanel(t, o);
  const reportGate = (t: string, r: string) =>
    (
      reports as unknown as {
        assertReportInActivePanel: (t: string, r: string) => Promise<void>;
      }
    ).assertReportInActivePanel(t, r);
  const asPanel = <T>(fn: () => Promise<T>) =>
    tenantContext.run({ tenantId: 't1', referralPanelId: 'panel-A' }, fn);

  beforeEach(() => jest.resetAllMocks());

  describe('order-level actions (Print All, share)', () => {
    it('lets the panel act on its own order', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o1',
        referralPanelId: 'panel-A',
      });
      await expect(
        asPanel(() => orderGate('t1', 'o1')),
      ).resolves.toBeUndefined();
    });

    it("refuses another panel's order", async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o2',
        referralPanelId: 'panel-B',
      });
      await expect(asPanel(() => orderGate('t1', 'o2'))).rejects.toBeInstanceOf(
        ReferralPanelAccessDeniedException,
      );
    });

    it('refuses a walk-in order with no panel', async () => {
      prisma.order.findFirst.mockResolvedValue({
        id: 'o3',
        referralPanelId: null,
      });
      await expect(asPanel(() => orderGate('t1', 'o3'))).rejects.toBeInstanceOf(
        ReferralPanelAccessDeniedException,
      );
    });

    it('refuses an unknown order the same way (no "exists" leak)', async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(
        asPanel(() => orderGate('t1', 'nope')),
      ).rejects.toBeInstanceOf(ReferralPanelAccessDeniedException);
    });

    it('does nothing for a non-B2B session (no query at all)', async () => {
      await expect(orderGate('t1', 'o2')).resolves.toBeUndefined();
      expect(prisma.order.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('single report (Print Report)', () => {
    it('lets the panel print its own report', async () => {
      prisma.labReport.findFirst.mockResolvedValue({
        id: 'r1',
        orderItem: { order: { referralPanelId: 'panel-A' } },
      });
      await expect(
        asPanel(() => reportGate('t1', 'r1')),
      ).resolves.toBeUndefined();
    });

    it("refuses another panel's report", async () => {
      prisma.labReport.findFirst.mockResolvedValue({
        id: 'r2',
        orderItem: { order: { referralPanelId: 'panel-B' } },
      });
      await expect(
        asPanel(() => reportGate('t1', 'r2')),
      ).rejects.toBeInstanceOf(ReferralPanelAccessDeniedException);
    });

    it('refuses an unknown report', async () => {
      prisma.labReport.findFirst.mockResolvedValue(null);
      await expect(
        asPanel(() => reportGate('t1', 'nope')),
      ).rejects.toBeInstanceOf(ReferralPanelAccessDeniedException);
    });

    it('does nothing for a non-B2B session', async () => {
      await expect(reportGate('t1', 'r2')).resolves.toBeUndefined();
      expect(prisma.labReport.findFirst).not.toHaveBeenCalled();
    });
  });

  describe("Order Console overview: an order's samples", () => {
    const grouped = (o: string) =>
      (
        samples as unknown as {
          findOrderGrouped: (t: string, o: string) => Promise<unknown>;
        }
      ).findOrderGrouped('t1', o);

    it("refuses an order that is not the panel's, before reading any sample", async () => {
      prisma.order.findFirst.mockResolvedValue(null);
      await expect(asPanel(() => grouped('o2'))).rejects.toBeInstanceOf(
        ReferralPanelAccessDeniedException,
      );
      expect(prisma.order.findFirst).toHaveBeenCalledWith({
        where: {
          id: 'o2',
          tenantId: 't1',
          deletedAt: null,
          referralPanelId: 'panel-A',
        },
        select: { id: true },
      });
    });
  });
});
