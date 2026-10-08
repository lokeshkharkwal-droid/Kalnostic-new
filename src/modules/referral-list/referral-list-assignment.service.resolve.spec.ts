import { ReferralType } from '@prisma/client';
import { ReferralListAssignmentService } from './referral-list-assignment.service';

/**
 * Which price lists an order/quote draws from. Priority, first one with a list
 * wins: Referral Panel -> Patient (PT) Category -> Referred-by doctor -> Internal
 * -> External -> the branch's default Walk-in lists. Create Order and the Quotation
 * form both use this one lookup.
 */
const TENANT = 't1';
const BRANCH = 'b1';
const WALK = { test: 'walk-test', panel: 'walk-panel' };

type Lists = { test?: string | null; panel?: string | null };

function build(opts: {
  assignments?: Partial<Record<ReferralType, Lists>>;
  categories?: Record<string, Lists | null>;
  defaults?: { test: string | null; panel: string | null };
}) {
  const defaults = opts.defaults ?? WALK;
  const prisma = {
    referralListAssignment: {
      findFirst: jest.fn(
        ({ where }: { where: { referralType: ReferralType } }) => {
          const a = opts.assignments?.[where.referralType];
          return Promise.resolve(
            a
              ? {
                  branchLabTestListId: a.test ?? null,
                  branchLabPanelListId: a.panel ?? null,
                }
              : null,
          );
        },
      ),
    },
    branchLabTestList: {
      findFirst: jest
        .fn()
        .mockResolvedValue(defaults.test ? { id: defaults.test } : null),
    },
    branchLabPanelList: {
      findFirst: jest
        .fn()
        .mockResolvedValue(defaults.panel ? { id: defaults.panel } : null),
    },
  };
  const ptCategoryService = {
    getResolvedListIds: jest.fn((_t: string, _b: string, id: string) => {
      const c = opts.categories?.[id];
      return Promise.resolve(
        c
          ? {
              branchLabTestListId: c.test ?? null,
              branchLabPanelListId: c.panel ?? null,
            }
          : null,
      );
    }),
  };
  const service = new ReferralListAssignmentService(
    prisma as never,
    ptCategoryService as never,
  );
  return { service, prisma, ptCategoryService };
}

const ALL_SELECTED = {
  referralPanelId: 'panel-1',
  ptCategoryId: 'cat-1',
  referredByDoctorId: 'doc-1',
  internalReferralId: 'int-1',
  externalReferralId: 'ext-1',
};

describe('ReferralListAssignmentService.resolve - priority', () => {
  const everyOneHasAList = {
    assignments: {
      PANEL: { test: 'panel-test', panel: 'panel-panel' },
      DOCTOR: { test: 'doc-test', panel: 'doc-panel' },
      INTERNAL: { test: 'int-test', panel: 'int-panel' },
      EXTERNAL: { test: 'ext-test', panel: 'ext-panel' },
    },
    categories: { 'cat-1': { test: 'cat-test', panel: 'cat-panel' } },
  };

  it('the Referral Panel wins over everything else', async () => {
    const { service } = build(everyOneHasAList);
    await expect(
      service.resolve(TENANT, BRANCH, ALL_SELECTED),
    ).resolves.toEqual({
      branchLabTestListId: 'panel-test',
      branchLabPanelListId: 'panel-panel',
      source: 'PANEL',
    });
  });

  it('without a panel, the Patient Category wins over the doctor, internal and external', async () => {
    const { service } = build(everyOneHasAList);
    const { referralPanelId: _p, ...rest } = ALL_SELECTED;
    await expect(service.resolve(TENANT, BRANCH, rest)).resolves.toEqual({
      branchLabTestListId: 'cat-test',
      branchLabPanelListId: 'cat-panel',
      source: 'PT_CATEGORY',
    });
  });

  it('without a panel or category, the Referred-by doctor wins over internal and external', async () => {
    const { service } = build(everyOneHasAList);
    await expect(
      service.resolve(TENANT, BRANCH, {
        referredByDoctorId: 'doc-1',
        internalReferralId: 'int-1',
        externalReferralId: 'ext-1',
      }),
    ).resolves.toMatchObject({
      source: 'DOCTOR',
      branchLabTestListId: 'doc-test',
    });
  });

  it('then the Internal referral wins over the External one', async () => {
    const { service } = build(everyOneHasAList);
    await expect(
      service.resolve(TENANT, BRANCH, {
        internalReferralId: 'int-1',
        externalReferralId: 'ext-1',
      }),
    ).resolves.toMatchObject({
      source: 'INTERNAL',
      branchLabTestListId: 'int-test',
    });
  });

  it('and the External referral on its own resolves to its list', async () => {
    const { service } = build(everyOneHasAList);
    await expect(
      service.resolve(TENANT, BRANCH, { externalReferralId: 'ext-1' }),
    ).resolves.toMatchObject({
      source: 'EXTERNAL',
      branchLabTestListId: 'ext-test',
    });
  });
});

describe('ReferralListAssignmentService.resolve - falling through to the next choice', () => {
  it('nothing selected resolves to the Walk-in lists', async () => {
    const { service } = build({});
    await expect(service.resolve(TENANT, BRANCH, {})).resolves.toEqual({
      branchLabTestListId: WALK.test,
      branchLabPanelListId: WALK.panel,
      source: 'DEFAULT',
    });
  });

  it('a Patient Category with no list (the auto-created "General") is skipped, so the doctor decides', async () => {
    const { service } = build({
      categories: { general: null },
      assignments: { DOCTOR: { test: 'doc-test' } },
    });
    await expect(
      service.resolve(TENANT, BRANCH, {
        ptCategoryId: 'general',
        referredByDoctorId: 'doc-1',
      }),
    ).resolves.toMatchObject({
      source: 'DOCTOR',
      branchLabTestListId: 'doc-test',
    });
  });

  it('General alone resolves to Walk-in, never to its own list', async () => {
    const { service } = build({ categories: { general: null } });
    await expect(
      service.resolve(TENANT, BRANCH, { ptCategoryId: 'general' }),
    ).resolves.toMatchObject({
      source: 'DEFAULT',
      branchLabTestListId: WALK.test,
      branchLabPanelListId: WALK.panel,
    });
  });

  it('a panel with no assignment is skipped, so the Patient Category decides', async () => {
    const { service } = build({
      assignments: {},
      categories: { 'cat-1': { test: 'cat-test' } },
    });
    await expect(
      service.resolve(TENANT, BRANCH, {
        referralPanelId: 'panel-1',
        ptCategoryId: 'cat-1',
      }),
    ).resolves.toMatchObject({
      source: 'PT_CATEGORY',
      branchLabTestListId: 'cat-test',
    });
  });

  it('an assignment with both lists empty counts as no assignment', async () => {
    const { service } = build({
      assignments: {
        DOCTOR: { test: null, panel: null },
        INTERNAL: { test: 'int-test' },
      },
    });
    await expect(
      service.resolve(TENANT, BRANCH, {
        referredByDoctorId: 'doc-1',
        internalReferralId: 'int-1',
      }),
    ).resolves.toMatchObject({ source: 'INTERNAL' });
  });

  it('the doctor is skipped when the internal referral carries the list', async () => {
    const { service } = build({
      assignments: { INTERNAL: { test: 'int-test' } },
    });
    await expect(
      service.resolve(TENANT, BRANCH, {
        referredByDoctorId: 'doc-1',
        internalReferralId: 'int-1',
      }),
    ).resolves.toMatchObject({ source: 'INTERNAL' });
  });

  it('when nothing carries a list it resolves to the Walk-in lists', async () => {
    const { service } = build({ assignments: {}, categories: {} });
    await expect(
      service.resolve(TENANT, BRANCH, ALL_SELECTED),
    ).resolves.toMatchObject({
      source: 'DEFAULT',
      branchLabTestListId: WALK.test,
    });
  });
});

describe('ReferralListAssignmentService.resolve - a list that is only half set', () => {
  it('a panel with only a test list takes the Walk-in panel list', async () => {
    const { service } = build({
      assignments: { PANEL: { test: 'panel-test' } },
    });
    await expect(
      service.resolve(TENANT, BRANCH, { referralPanelId: 'panel-1' }),
    ).resolves.toEqual({
      branchLabTestListId: 'panel-test',
      branchLabPanelListId: WALK.panel,
      source: 'PANEL',
    });
  });

  it('a panel with only a panel list takes the Walk-in test list', async () => {
    const { service } = build({
      assignments: { PANEL: { panel: 'panel-panel' } },
    });
    await expect(
      service.resolve(TENANT, BRANCH, { referralPanelId: 'panel-1' }),
    ).resolves.toEqual({
      branchLabTestListId: WALK.test,
      branchLabPanelListId: 'panel-panel',
      source: 'PANEL',
    });
  });

  it('a Patient Category with only a test list takes the Walk-in panel list', async () => {
    const { service } = build({
      categories: { 'cat-1': { test: 'cat-test' } },
    });
    await expect(
      service.resolve(TENANT, BRANCH, { ptCategoryId: 'cat-1' }),
    ).resolves.toEqual({
      branchLabTestListId: 'cat-test',
      branchLabPanelListId: WALK.panel,
      source: 'PT_CATEGORY',
    });
  });

  it('with no default Walk-in list imported yet, the missing side stays null', async () => {
    const { service } = build({
      assignments: { DOCTOR: { test: 'doc-test' } },
      defaults: { test: null, panel: null },
    });
    await expect(
      service.resolve(TENANT, BRANCH, { referredByDoctorId: 'doc-1' }),
    ).resolves.toEqual({
      branchLabTestListId: 'doc-test',
      branchLabPanelListId: null,
      source: 'DOCTOR',
    });
    await expect(service.resolve(TENANT, BRANCH, {})).resolves.toEqual({
      branchLabTestListId: null,
      branchLabPanelListId: null,
      source: 'DEFAULT',
    });
  });
});

describe('ReferralListAssignmentService.resolve - what it asks the database', () => {
  it('only looks up the choices that were actually selected', async () => {
    const { service, prisma, ptCategoryService } = build({});
    await service.resolve(TENANT, BRANCH, { referredByDoctorId: 'doc-1' });
    expect(prisma.referralListAssignment.findFirst).toHaveBeenCalledTimes(1);
    expect(ptCategoryService.getResolvedListIds).not.toHaveBeenCalled();
  });

  it('stops at the first choice that carries a list (a panel hit skips the rest)', async () => {
    const { service, prisma, ptCategoryService } = build({
      assignments: { PANEL: { test: 'panel-test' } },
    });
    await service.resolve(TENANT, BRANCH, ALL_SELECTED);
    expect(ptCategoryService.getResolvedListIds).not.toHaveBeenCalled();
    expect(prisma.referralListAssignment.findFirst).toHaveBeenCalledTimes(1);
  });

  it('scopes every lookup to the tenant and the active branch, live rows only', async () => {
    const { service, prisma, ptCategoryService } = build({});
    await service.resolve(TENANT, BRANCH, ALL_SELECTED);
    for (const [arg] of prisma.referralListAssignment.findFirst.mock
      .calls as Array<[{ where: Record<string, unknown> }]>) {
      expect(arg.where).toMatchObject({
        tenantId: TENANT,
        branchId: BRANCH,
        deletedAt: null,
      });
    }
    expect(ptCategoryService.getResolvedListIds).toHaveBeenCalledWith(
      TENANT,
      BRANCH,
      'cat-1',
    );
    const defaultsWhere = (
      prisma.branchLabTestList.findFirst.mock.calls as Array<
        [{ where: Record<string, unknown> }]
      >
    )[0]![0].where;
    expect(defaultsWhere).toMatchObject({
      tenantId: TENANT,
      branchId: BRANCH,
      isDefault: true,
      deletedAt: null,
    });
  });
});
