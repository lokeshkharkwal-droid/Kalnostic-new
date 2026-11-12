import { StaffStatus } from '@prisma/client';
import {
  assertPanelHasBranch,
  assertNoExistingB2bUser,
  ReferralPanelUserService,
} from './referral-panel-user.service';
import { ConflictException } from '../../common/exceptions/kaltros.exception';

describe('referral-panel-user guards', () => {
  it('rejects a panel without a branch', () => {
    expect(() => assertPanelHasBranch({ id: 'p1', branchId: null })).toThrow(
      ConflictException,
    );
  });

  it('accepts a panel with a branch', () => {
    expect(() =>
      assertPanelHasBranch({ id: 'p1', branchId: 'b1' }),
    ).not.toThrow();
  });

  it('rejects when a b2b user already exists for the panel', () => {
    expect(() => assertNoExistingB2bUser('p1', { id: 'existing' })).toThrow(
      ConflictException,
    );
  });

  it('accepts when no b2b user exists yet', () => {
    expect(() => assertNoExistingB2bUser('p1', null)).not.toThrow();
  });
});

describe('ReferralPanelUserService.findPanelIdsWithEnabledLogin', () => {
  type Profile = { referralPanelId: string | null; personId: string };
  const build = (
    profiles: Profile[],
    activePersonIds: string[],
    inactiveMembershipPersonIds: string[],
  ) => {
    const profileFindMany = jest.fn().mockResolvedValue(profiles);
    const personFindMany = jest
      .fn()
      .mockResolvedValue(activePersonIds.map((id) => ({ id })));
    const membershipFindMany = jest
      .fn()
      .mockResolvedValue(
        inactiveMembershipPersonIds.map((personId) => ({ personId })),
      );
    const prisma = {
      userBranchProfile: { findMany: profileFindMany },
      person: { findMany: personFindMany },
      tenantStaffMembership: { findMany: membershipFindMany },
    };
    const svc = new ReferralPanelUserService(
      prisma as never,
      null as never,
      null as never,
    );
    const whereOf = (fn: jest.Mock) =>
      ((fn.mock.calls as unknown[][])[0]![0] as { where: unknown }).where;
    return {
      svc,
      profileFindMany,
      personFindMany,
      membershipFindMany,
      whereOf,
    };
  };

  it('returns an empty set without querying for an empty page', async () => {
    const { svc, profileFindMany } = build([], [], []);
    expect((await svc.findPanelIdsWithEnabledLogin('t1', [])).size).toBe(0);
    expect(profileFindMany).not.toHaveBeenCalled();
  });

  it('only reads live B2B profiles of the page (mirrors the login gate)', async () => {
    const { svc, profileFindMany, personFindMany, whereOf } = build([], [], []);
    await svc.findPanelIdsWithEnabledLogin('t1', ['p1', 'p2']);
    expect(whereOf(profileFindMany)).toEqual({
      tenantId: 't1',
      referralPanelId: { in: ['p1', 'p2'] },
      authRole: { key: 'b2b_referring_panel' },
      isActive: true,
      branchStatus: StaffStatus.ACTIVE,
      deletedAt: null,
    });
    // No live profile → no person / membership lookups.
    expect(personFindMany).not.toHaveBeenCalled();
  });

  it('includes a panel whose login user is active; excludes an inactive person or an INACTIVE membership', async () => {
    const { svc, personFindMany, membershipFindMany, whereOf } = build(
      [
        { referralPanelId: 'p1', personId: 'u1' }, // can sign in
        { referralPanelId: 'p2', personId: 'u2' }, // person deactivated / deleted
        { referralPanelId: 'p3', personId: 'u3' }, // tenant membership INACTIVE
      ],
      ['u1', 'u3'],
      ['u3'],
    );
    const result = await svc.findPanelIdsWithEnabledLogin('t1', [
      'p1',
      'p2',
      'p3',
      'p4', // no B2B login at all
    ]);
    expect([...result]).toEqual(['p1']);
    expect(whereOf(personFindMany)).toEqual({
      id: { in: ['u1', 'u2', 'u3'] },
      isActive: true,
      deletedAt: null,
    });
    expect(whereOf(membershipFindMany)).toEqual({
      tenantId: 't1',
      personId: { in: ['u1', 'u2', 'u3'] },
      status: StaffStatus.INACTIVE,
      deletedAt: null,
    });
  });
});
