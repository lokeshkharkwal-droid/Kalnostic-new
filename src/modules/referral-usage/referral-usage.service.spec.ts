import { OrderStatus } from '@prisma/client';
import { ReferralUsageService } from './referral-usage.service';

type GroupByArgs = {
  by: string[];
  where: Record<string, unknown>;
  _max: Record<string, boolean>;
};

describe('ReferralUsageService.findLastOrderCreatedAt', () => {
  const build = (rows: unknown[]) => {
    const groupBy = jest.fn().mockResolvedValue(rows);
    const svc = new ReferralUsageService({ order: { groupBy } } as never);
    const argsOf = () =>
      (groupBy.mock.calls as unknown[][])[0]![0] as GroupByArgs;
    return { svc, groupBy, argsOf };
  };

  it('returns an empty map without querying when the page is empty', async () => {
    const { svc, groupBy } = build([]);
    const result = await svc.findLastOrderCreatedAt(
      't1',
      'referralPanelId',
      [],
    );
    expect(result.size).toBe(0);
    expect(groupBy).not.toHaveBeenCalled();
  });

  it('groups by the referral FK and takes MAX(createdAt) over counted orders', async () => {
    const { svc, argsOf } = build([]);
    await svc.findLastOrderCreatedAt('t1', 'referredByDoctorId', ['d1', 'd2']);
    const args = argsOf();
    expect(args.by).toEqual(['referredByDoctorId']);
    expect(args._max).toEqual({ createdAt: true });
    expect(args.where).toEqual({
      tenantId: 't1',
      referredByDoctorId: { in: ['d1', 'd2'] },
      deletedAt: null,
      status: { notIn: [OrderStatus.DRAFT, OrderStatus.QUOTE] },
    });
  });

  it('maps each referral id to its latest order time; ids without orders are absent', async () => {
    const latest = new Date('2026-11-10T09:45:00.000Z');
    const { svc } = build([
      { externalReferralId: 'e1', _max: { createdAt: latest } },
      // Defensive: a group with no max (never expected) is skipped.
      { externalReferralId: 'e2', _max: { createdAt: null } },
    ]);
    const result = await svc.findLastOrderCreatedAt(
      't1',
      'externalReferralId',
      ['e1', 'e2', 'e3'],
    );
    expect(result.get('e1')).toBe(latest);
    expect(result.has('e2')).toBe(false);
    expect(result.has('e3')).toBe(false);
  });
});
