import { LabReportService } from './lab-report.service';
import { LabReportController } from './lab-report.controller';
import {
  toWorklistRow,
  type LabReportListRow,
} from './entities/lab-report.entity';
import {
  ActiveBranchRequiredException,
  LabReportAlreadyLockedException,
  LabReportLockedException,
  LabReportNotFoundException,
  LabReportNotLockedException,
} from './exceptions/lab-report.exceptions';
import { BUSINESS_PERMISSIONS_KEY } from '../permissions/decorators/require-permission.decorator';
import { PERMISSION_KEYS } from '../permissions/constants/module-permissions.constant';

/**
 * Technician Reporting — Lock Test / Unlock Test.
 *  - a locked test cannot be locked again (who/why must not be overwritten);
 *  - every lock and every unlock leaves a record (who, when, reason) even though
 *    unlock clears the report's own lock fields;
 *  - a blank reason counts as no reason, a real one is stored exactly as typed;
 *  - a locked test cannot be re-run;
 *  - the lock reason/locker reach the screen so the Unlock dialog can show them.
 */
const T = 't1';
const B = 'b1';
const ACTOR = 'person-1';

type Call = { where: Record<string, unknown>; data: Record<string, unknown> };

function build(
  opts: { found?: boolean; updated?: number; locked?: boolean } = {},
) {
  const found = opts.found ?? true;
  const report = { id: 'r1', isLocked: opts.locked ?? false };
  const labReport = {
    findFirst: jest.fn().mockResolvedValue(found ? report : null),
    updateMany: jest
      .fn<Promise<{ count: number }>, [Call]>()
      .mockResolvedValue({
        count: opts.updated ?? 1,
      }),
    findUniqueOrThrow: jest
      .fn()
      .mockResolvedValue({ id: 'r1', isLocked: true }),
  };
  const labReportNote = {
    create: jest
      .fn<Promise<unknown>, [{ data: Record<string, unknown> }]>()
      .mockResolvedValue({}),
    deleteMany: jest.fn(),
  };
  const tx = { labReport, labReportNote };
  const person = { findMany: jest.fn().mockResolvedValue([]) };
  const prisma = {
    labReport,
    labReportNote,
    person,
    withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  return { service, prisma, labReport, labReportNote, person };
}

const noteBody = (n: ReturnType<typeof build>) =>
  n.labReportNote.create.mock.calls[0]![0].data;

describe('LabReportService.lock', () => {
  it('locks the report and records who locked it and why', async () => {
    const m = build();
    await m.service.lock('r1', T, B, ACTOR, 'Instrument fault');
    const set = m.labReport.updateMany.mock.calls[0]![0];
    expect(set.data).toMatchObject({
      isLocked: true,
      lockedBy: ACTOR,
      lockNotes: 'Instrument fault',
    });
    expect(set.data.lockedAt).toBeInstanceOf(Date);
    expect(noteBody(m)).toMatchObject({
      tenantId: T,
      labReportId: 'r1',
      category: 'LOCK',
      body: 'Instrument fault',
      createdBy: ACTOR,
    });
  });

  it('only locks a report that is not already locked (compare-and-set)', async () => {
    const m = build();
    await m.service.lock('r1', T, B, ACTOR);
    expect(m.labReport.updateMany.mock.calls[0]![0].where).toMatchObject({
      id: 'r1',
      tenantId: T,
      branchId: B,
      deletedAt: null,
      isLocked: false,
    });
  });

  it('refuses to lock a report that is already locked and writes nothing', async () => {
    const m = build({ updated: 0, locked: true });
    await expect(
      m.service.lock('r1', T, B, ACTOR, 'again'),
    ).rejects.toBeInstanceOf(LabReportAlreadyLockedException);
    expect(m.labReportNote.create).not.toHaveBeenCalled();
  });

  it('stores the reason exactly as typed, spaces and line breaks included', async () => {
    const m = build();
    const text = '  Line 1\n\nLine 2 — café  ';
    await m.service.lock('r1', T, B, ACTOR, text);
    expect(m.labReport.updateMany.mock.calls[0]![0].data.lockNotes).toBe(text);
    expect(noteBody(m).body).toBe(text);
  });

  it.each([undefined, '', '   ', '\n\t '])(
    'a blank reason (%j) counts as no reason',
    async (blank) => {
      const m = build();
      await m.service.lock('r1', T, B, ACTOR, blank);
      expect(
        m.labReport.updateMany.mock.calls[0]![0].data.lockNotes,
      ).toBeNull();
    },
  );

  it('still records the lock when no reason was given (who and when)', async () => {
    const m = build();
    await m.service.lock('r1', T, B, ACTOR);
    expect(noteBody(m)).toMatchObject({
      category: 'LOCK',
      body: '',
      createdBy: ACTOR,
    });
  });

  it('rejects a report that does not exist', async () => {
    const m = build({ found: false });
    await expect(m.service.lock('r1', T, B, ACTOR)).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
    expect(m.labReport.updateMany).not.toHaveBeenCalled();
  });

  it('needs an active branch', async () => {
    const m = build();
    await expect(m.service.lock('r1', T, null, ACTOR)).rejects.toBeInstanceOf(
      ActiveBranchRequiredException,
    );
  });
});

describe('LabReportService.unlock', () => {
  it('clears every lock field on the report', async () => {
    const m = build({ locked: true });
    await m.service.unlock('r1', T, B, ACTOR);
    expect(m.labReport.updateMany.mock.calls[0]![0].data).toEqual({
      isLocked: false,
      lockedAt: null,
      lockedBy: null,
      lockNotes: null,
    });
  });

  it('only unlocks a report that is locked', async () => {
    const m = build({ locked: true });
    await m.service.unlock('r1', T, B, ACTOR);
    expect(m.labReport.updateMany.mock.calls[0]![0].where).toMatchObject({
      id: 'r1',
      branchId: B,
      isLocked: true,
    });
  });

  it('records who unlocked it, so the history survives the fields being cleared', async () => {
    const m = build({ locked: true });
    await m.service.unlock('r1', T, B, ACTOR);
    expect(noteBody(m)).toMatchObject({
      tenantId: T,
      labReportId: 'r1',
      category: 'UNLOCK',
      createdBy: ACTOR,
    });
  });

  it('never deletes the earlier LOCK record', async () => {
    const m = build({ locked: true });
    await m.service.unlock('r1', T, B, ACTOR);
    expect(m.labReportNote.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a report that is not locked and writes no record', async () => {
    const m = build({ updated: 0 });
    await expect(m.service.unlock('r1', T, B, ACTOR)).rejects.toBeInstanceOf(
      LabReportNotLockedException,
    );
    expect(m.labReportNote.create).not.toHaveBeenCalled();
  });

  it('rejects a report that does not exist', async () => {
    const m = build({ found: false });
    await expect(m.service.unlock('r1', T, B, ACTOR)).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
  });

  it('is not refused outright any more (the old hard-coded denial is gone)', async () => {
    const m = build({ locked: true });
    await expect(m.service.unlock('r1', T, B, ACTOR)).resolves.toBeDefined();
  });
});

describe('LabReportService.resetForRerun on a locked report', () => {
  it('is refused and changes nothing', async () => {
    const m = build({ locked: true });
    await expect(
      m.service.resetForRerun('r1', T, B, ACTOR),
    ).rejects.toBeInstanceOf(LabReportLockedException);
    expect(m.prisma.withTenant).not.toHaveBeenCalled();
  });

  it('an unlocked report passes the lock check', async () => {
    const m = build({ locked: false });
    m.prisma.withTenant.mockImplementation(() => {
      throw new Error('reached the reset');
    });
    await expect(m.service.resetForRerun('r1', T, B, ACTOR)).rejects.toThrow(
      'reached the reset',
    );
  });
});

describe('lock details reach the screen', () => {
  const row = (over: Record<string, unknown>) =>
    ({
      id: 'r1',
      status: 'PENDING',
      isUrgent: false,
      isOutsourced: false,
      createdAt: new Date('2026-10-08T00:00:00Z'),
      isLocked: false,
      lockNotes: null,
      lockedAt: null,
      lockedBy: null,
      branchId: B,
      ...over,
    }) as unknown as LabReportListRow;

  it('a locked report carries its reason, time and locker', () => {
    const at = new Date('2026-10-08T09:30:00Z');
    const r = toWorklistRow(
      row({ isLocked: true, lockNotes: 'why', lockedAt: at, lockedBy: 'p9' }),
    );
    expect(r).toMatchObject({
      isLocked: true,
      lockNotes: 'why',
      lockedAt: at,
      lockedBy: 'p9',
      lockedByName: null,
    });
  });

  it('an unlocked report shows no lock details even if stale values remain', () => {
    const r = toWorklistRow(
      row({
        isLocked: false,
        lockNotes: 'stale',
        lockedAt: new Date(),
        lockedBy: 'p9',
      }),
    );
    expect(r).toMatchObject({
      isLocked: false,
      lockNotes: null,
      lockedAt: null,
      lockedBy: null,
    });
  });

  describe('the locker name', () => {
    const attach = (m: ReturnType<typeof build>, rows: unknown[]) =>
      (
        m.service as unknown as {
          attachLockedByNames: (
            r: unknown[],
          ) => Promise<Array<{ lockedByName: string | null }>>;
        }
      ).attachLockedByNames(rows);

    it('is looked up once for the locked rows and filled in', async () => {
      const m = build();
      m.person.findMany.mockResolvedValue([
        { id: 'p9', firstName: 'Sushant', middleName: null, lastName: 'Tech' },
      ]);
      const out = await attach(m, [
        { id: 'a', lockedBy: 'p9', lockedByName: null },
        { id: 'b', lockedBy: 'p9', lockedByName: null },
        { id: 'c', lockedBy: null, lockedByName: null },
      ]);
      expect(out.map((r) => r.lockedByName)).toEqual([
        'Sushant Tech',
        'Sushant Tech',
        null,
      ]);
      expect(m.person.findMany).toHaveBeenCalledTimes(1);
    });

    it('makes no lookup at all when nothing is locked', async () => {
      const m = build();
      await attach(m, [{ id: 'a', lockedBy: null, lockedByName: null }]);
      expect(m.person.findMany).not.toHaveBeenCalled();
    });

    it('stays empty when the person cannot be found', async () => {
      const m = build();
      const out = await attach(m, [
        { id: 'a', lockedBy: 'gone', lockedByName: null },
      ]);
      expect(out[0]!.lockedByName).toBeNull();
    });
  });
});

describe('LabReportController — who may lock and unlock', () => {
  // Nest stores the permission on the route method itself.
  const need = (method: 'lock' | 'unlock') =>
    Reflect.getMetadata(
      BUSINESS_PERMISSIONS_KEY,
      Object.getOwnPropertyDescriptor(LabReportController.prototype, method)!
        .value as object,
    ) as string[] | undefined;

  it('unlock needs the same permission as lock', () => {
    expect(need('unlock')).toEqual([PERMISSION_KEYS.LAB_MARK_LOCK_TEST]);
    expect(need('lock')).toEqual(need('unlock'));
  });
});

/**
 * Opening a locked test (the Enter button now works on one, so it can be unlocked)
 * makes the popup load the Order/Sample/Tech notes. Reading must work while locked;
 * adding a note must not.
 */
describe('notes on a locked test', () => {
  function buildNotes(
    over: { locked?: boolean; hasSample?: boolean; found?: boolean } = {},
  ) {
    const report = {
      id: 'r1',
      orderItemId: 'oi1',
      isLocked: over.locked ?? true,
      orderItem: { orderId: 'o1' },
    };
    const note = {
      id: 'n1',
      category: 'TECH',
      body: 'a note',
      createdBy: 'p1',
      createdAt: new Date(),
    };
    const prisma = {
      labReport: {
        findFirst: jest
          .fn()
          .mockResolvedValue(over.found === false ? null : report),
        findMany: jest.fn().mockResolvedValue([{ id: 'r1' }]),
      },
      orderSampleTest: {
        findFirst: jest
          .fn()
          .mockResolvedValue(over.hasSample === false ? null : { id: 's1' }),
      },
      labReportNote: {
        findMany: jest
          .fn<Promise<unknown[]>, [{ where: { category: { in: string[] } } }]>()
          .mockResolvedValue([note]),
        create: jest.fn().mockResolvedValue(note),
      },
      person: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const deps = Array(11).fill(undefined) as unknown[];
    deps[0] = prisma;
    const service = new LabReportService(
      ...(deps as ConstructorParameters<typeof LabReportService>),
    );
    return { service, prisma };
  }

  it('can be read while the test is locked', async () => {
    const m = buildNotes({ locked: true });
    const out = await m.service.findNotes('r1', T, B, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ body: 'a note' });
  });

  it('reads the same way when the test is not locked', async () => {
    const m = buildNotes({ locked: false });
    await expect(m.service.findNotes('r1', T, B, {})).resolves.toHaveLength(1);
  });

  it('never lists the lock / unlock records in the plain notes tabs', async () => {
    const m = buildNotes();
    await m.service.findNotes('r1', T, B, {});
    const where = m.prisma.labReportNote.findMany.mock.calls[0]![0].where;
    expect(where.category.in).toEqual(['ORDER', 'SAMPLE', 'TECH']);
  });

  it('still refuses a report that does not exist', async () => {
    const m = buildNotes({ found: false });
    await expect(m.service.findNotes('r1', T, B, {})).rejects.toBeInstanceOf(
      LabReportNotFoundException,
    );
  });

  it('adding a note to a locked test is still refused and nothing is written', async () => {
    const m = buildNotes({ locked: true });
    await expect(
      m.service.createNote('r1', T, B, ACTOR, {
        category: 'TECH',
        body: 'x',
      } as never),
    ).rejects.toBeInstanceOf(LabReportLockedException);
    expect(m.prisma.labReportNote.create).not.toHaveBeenCalled();
  });
});
