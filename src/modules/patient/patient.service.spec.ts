import { EventEmitter2 } from '@nestjs/event-emitter';
import { ExternalIdFormat } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ExternalIdService } from '../registration-settings/external-id.service';
import { PatientService } from './patient.service';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientUmIdRequiredException } from './exceptions/patient.exceptions';

/**
 * Unit coverage for `findAllForTenant`'s scoping. Search Existing Patient must be
 * **tenant-wide** — the query is scoped by `tenantId` (+ `deletedAt: null`) and
 * only narrows to a branch when a `branchId` filter is explicitly supplied. This
 * locks the tenant-scoped (not branch-scoped) behaviour the frontend relies on.
 */
/** The shape of the `findMany` argument we assert against. */
type FindManyArg = { where: Record<string, unknown> & { OR?: unknown[] } };

describe('PatientService.findAllForTenant scoping', () => {
  let prismaMock: {
    patient: { findMany: jest.Mock; count: jest.Mock };
  };
  let service: PatientService;

  const firstFindManyArg = (): FindManyArg => {
    const calls = prismaMock.patient.findMany.mock.calls as FindManyArg[][];
    return calls[0]?.[0] as FindManyArg;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      patient: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    };
    service = new PatientService(
      prismaMock as unknown as PrismaService,
      {} as unknown as PtCategoryService,
      {} as unknown as ExternalIdService,
      {} as unknown as EventEmitter2,
    );
  });

  it('scopes to the tenant only (no branchId) when none is supplied', async () => {
    await service.findAllForTenant('t1', 1, 20, { search: '9876543210' });

    const arg = firstFindManyArg();
    expect(arg.where).toMatchObject({ tenantId: 't1', deletedAt: null });
    expect(arg.where).not.toHaveProperty('branchId');
    // Search matches name OR mobile across the whole tenant.
    expect(arg.where.OR).toEqual(
      expect.arrayContaining([
        { mobile: { contains: '9876543210', mode: 'insensitive' } },
      ]),
    );
  });

  it('narrows to a branch only when a branchId filter is explicitly passed', async () => {
    await service.findAllForTenant('t1', 1, 20, { branchId: 'b1' });

    const arg = firstFindManyArg();
    expect(arg.where).toMatchObject({
      tenantId: 't1',
      deletedAt: null,
      branchId: 'b1',
    });
  });

  it('without includeFamily, still lists family members as plain matches', async () => {
    await service.findAllForTenant('t1', 1, 10, { search: '8919441487' });

    const arg = firstFindManyArg();
    expect(arg.where).not.toHaveProperty('AND');
    expect(arg.where.OR).toHaveLength(4);
  });
});

/**
 * Behaviour coverage for the family-aware search (`includeFamily` + `search`,
 * the Create Order dropdown) against an in-memory patient/link store. Locks the
 * failure modes found in review: household members as separate rows, deleted
 * anchors hiding their family, link cycles / self-links / deep chains making
 * patients unfindable, and members with several anchors.
 */
describe('PatientService.findAllForTenant — family-aware search', () => {
  type Row = {
    id: string;
    tenantId: string;
    firstName: string;
    middleName: string | null;
    lastName: string | null;
    mobile: string;
    age: number | null;
    umId: string | null;
    gender: string | null;
    isFamilyMember: boolean;
    createdAt: Date;
    deletedAt: Date | null;
  };
  type Link = {
    id: string;
    tenantId: string;
    patientId: string;
    memberId: string;
    relationship: string;
    createdAt: Date;
    deletedAt: Date | null;
  };
  type Args = {
    where: {
      tenantId: string;
      id?: { in: string[] };
      memberId?: { in: string[] };
      OR?: Array<Record<string, { contains: string }>>;
    };
    take?: number;
    include?: unknown;
    select?: Record<string, boolean>;
  };

  let patients: Row[];
  let links: Link[];
  let seq: number;
  let service: PatientService;

  const add = (
    id: string,
    mobile: string,
    opts: { family?: boolean; deleted?: boolean; name?: string } = {},
  ): void => {
    seq += 1;
    patients.push({
      id,
      tenantId: 't1',
      firstName: opts.name ?? id,
      middleName: null,
      lastName: null,
      mobile,
      age: 30,
      umId: null,
      gender: 'MALE',
      isFamilyMember: opts.family ?? false,
      createdAt: new Date(2026, 0, seq),
      deletedAt: opts.deleted ? new Date() : null,
    });
  };
  const link = (anchor: string, member: string): void => {
    seq += 1;
    links.push({
      id: `${anchor}->${member}`,
      tenantId: 't1',
      patientId: anchor,
      memberId: member,
      relationship: 'SON',
      createdAt: new Date(2026, 0, seq),
      deletedAt: null,
    });
  };
  const byId = (id: string): Row | undefined =>
    patients.find((p) => p.id === id);
  const alive = (id: string): boolean => byId(id)?.deletedAt === null;
  const pick = (row: Row, select: Record<string, boolean>): Partial<Row> =>
    Object.fromEntries(
      Object.keys(select).map((k) => [k, row[k as keyof Row]]),
    );

  const search = (term: string, page = 1, limit = 10) =>
    service.findAllForTenant('t1', page, limit, {
      search: term,
      includeFamily: true,
    });

  beforeEach(() => {
    patients = [];
    links = [];
    seq = 0;
    const prismaMock = {
      patient: {
        findMany: jest.fn((args: Args) => {
          const w = args.where;
          let rows = patients.filter(
            (p) => p.tenantId === w.tenantId && p.deletedAt === null,
          );
          if (w.id) rows = rows.filter((p) => w.id?.in.includes(p.id));
          if (w.OR) {
            rows = rows.filter((p) =>
              (w.OR ?? []).some((c) =>
                Object.entries(c).some(([k, v]) =>
                  String(p[k as keyof Row] ?? '')
                    .toLowerCase()
                    .includes(v.contains.toLowerCase()),
                ),
              ),
            );
          }
          rows = [...rows].sort(
            (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
          );
          if (args.take) rows = rows.slice(0, args.take);
          if (args.include) {
            return Promise.resolve(
              rows.map((p) => ({
                ...p,
                familyLinks: links
                  .filter(
                    (l) =>
                      l.patientId === p.id && !l.deletedAt && alive(l.memberId),
                  )
                  .map((l) => ({ ...l, member: byId(l.memberId) })),
                familyMemberOf: links
                  .filter(
                    (l) =>
                      l.memberId === p.id && !l.deletedAt && alive(l.patientId),
                  )
                  .map((l) => ({ ...l, patient: byId(l.patientId) })),
              })),
            );
          }
          const select = args.select;
          return Promise.resolve(
            select ? rows.map((r) => pick(r, select)) : rows,
          );
        }),
        count: jest.fn(),
      },
      patientFamilyLink: {
        findMany: jest.fn((args: Args) =>
          Promise.resolve(
            links
              .filter(
                (l) =>
                  l.tenantId === args.where.tenantId &&
                  !l.deletedAt &&
                  (args.where.memberId?.in ?? []).includes(l.memberId) &&
                  alive(l.patientId),
              )
              .map((l) => ({ patientId: l.patientId, memberId: l.memberId })),
          ),
        ),
      },
    };
    service = new PatientService(
      prismaMock as unknown as PrismaService,
      {} as unknown as PtCategoryService,
      {} as unknown as ExternalIdService,
      {} as unknown as EventEmitter2,
    );
  });

  const ids = (rows: Array<{ id: string }>): string[] =>
    rows.map((r) => r.id).sort();

  it('returns a shared-mobile household as ONE main patient with members nested', async () => {
    add('A', '8919441487');
    add('B', '8919441487', { family: true });
    add('C', '8919441487', { family: true });
    link('A', 'B');
    link('A', 'C');

    const res = await search('8919441487');

    expect(ids(res.data)).toEqual(['A']);
    expect(res.total).toBe(1);
    const [a] = res.data;
    expect((a?.familyMembers ?? []).map((f) => f.member.id).sort()).toEqual([
      'B',
      'C',
    ]);
    expect([...(a?.matchedMemberIds ?? [])].sort()).toEqual(['B', 'C']);
    expect(a?.indirectMatches).toEqual([]);
  });

  it('surfaces the main patient when only a member matches (by name)', async () => {
    add('A', '9000000001', { name: 'Suresh' });
    add('B', '9000000001', { family: true, name: 'Ravi' });
    link('A', 'B');

    const res = await search('ravi');

    expect(ids(res.data)).toEqual(['A']);
    expect(res.data[0]?.matchedMemberIds).toEqual(['B']);
  });

  it('returns a patient without family unchanged', async () => {
    add('S', '9111111111');

    const res = await search('9111111111');

    expect(ids(res.data)).toEqual(['S']);
    expect(res.data[0]?.familyMembers).toEqual([]);
    expect(res.data[0]?.matchedMemberIds).toEqual([]);
  });

  it('does not hide members whose anchor was soft-deleted', async () => {
    add('D', '9222222222', { deleted: true });
    add('E', '9222222222', { family: true });
    add('F', '9222222222', { family: true });
    link('D', 'E');
    link('D', 'F');

    const res = await search('9222222222');

    expect(ids(res.data)).toEqual(['E', 'F']);
    // The deleted anchor is not listed as a relative either.
    expect(res.data.flatMap((r) => r.familyMembers ?? [])).toEqual([]);
  });

  it('returns exactly one patient for a two-way link cycle (not zero)', async () => {
    add('G', '9333333333');
    add('H', '9333333333', { family: true });
    link('G', 'H');
    link('H', 'G');

    const res = await search('9333333333');

    // Non-flagged patient wins; the other is nested once (not duplicated).
    expect(ids(res.data)).toEqual(['G']);
    expect(res.data[0]?.familyMembers?.map((f) => f.member.id)).toEqual(['H']);
  });

  it('ignores a self-link', async () => {
    add('I', '9444444444');
    link('I', 'I');

    const res = await search('9444444444');

    expect(ids(res.data)).toEqual(['I']);
    expect(res.data[0]?.familyMembers).toEqual([]);
  });

  it('reports a match deeper than a direct link as an indirect match', async () => {
    add('X', '9555555551');
    add('A2', '9555555552', { family: true });
    add('B2', '9555555553', { family: true });
    add('D2', '9555555554', { family: true });
    link('X', 'A2');
    link('A2', 'B2');
    link('B2', 'D2');

    const res = await search('9555555554');

    expect(ids(res.data)).toEqual(['X']);
    expect(res.data[0]?.matchedMemberIds).toEqual(['D2']);
    expect(res.data[0]?.indirectMatches?.map((m) => m.id)).toEqual(['D2']);
  });

  it('lists a member with two anchors under both', async () => {
    add('P1', '9666666661');
    add('P2', '9666666662');
    add('K', '9666666669', { family: true });
    link('P1', 'K');
    link('P2', 'K');

    const res = await search('9666666669');

    expect(ids(res.data)).toEqual(['P1', 'P2']);
  });

  it('paginates over main patients, not raw matches', async () => {
    for (const h of ['1', '2', '3']) {
      add(`M${h}`, '9777777777');
      add(`M${h}-kid`, '9777777777', { family: true });
      link(`M${h}`, `M${h}-kid`);
    }

    const first = await search('9777777777', 1, 2);
    const second = await search('9777777777', 2, 2);

    expect(first.total).toBe(3);
    expect(first.data).toHaveLength(2);
    expect(second.data).toHaveLength(1);
    expect(ids([...first.data, ...second.data])).toEqual(['M1', 'M2', 'M3']);
  });
});

/**
 * `remove()` must unlink the patient's family on both sides, so an active link
 * to a deleted patient can't keep relatives out of family-aware search.
 */
describe('PatientService.remove — family links', () => {
  it('soft-deletes the patient AND its family links in one transaction', async () => {
    const tx = {
      medicalHistory: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      patientFamilyLink: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
      patient: { update: jest.fn().mockResolvedValue({ id: 'A' }) },
    };
    const prismaMock = {
      patient: { findFirst: jest.fn().mockResolvedValue({ id: 'A' }) },
      withTenant: jest.fn((_t: string, fn: (t: typeof tx) => unknown) =>
        fn(tx),
      ),
    };
    const service = new PatientService(
      prismaMock as unknown as PrismaService,
      {} as unknown as PtCategoryService,
      {} as unknown as ExternalIdService,
      {} as unknown as EventEmitter2,
    );

    await service.remove('A', 't1');

    expect(tx.patientFamilyLink.updateMany).toHaveBeenCalledWith({
      where: {
        tenantId: 't1',
        deletedAt: null,
        OR: [{ patientId: 'A' }, { memberId: 'A' }],
      },
      data: { deletedAt: expect.any(Date) as unknown },
    });
    expect(tx.patient.update).toHaveBeenCalled();
  });
});

describe('PatientService.create — manual UMID branch', () => {
  let txMock: {
    patient: { create: jest.Mock };
    medicalHistory: { createMany: jest.Mock; findMany: jest.Mock };
  };
  let prismaMock: { withTenant: jest.Mock };
  let externalIdServiceMock: { getConfiguredFormat: jest.Mock };
  let service: PatientService;

  const baseDto: CreatePatientDto = {
    firstName: 'Jane',
    mobile: '9876543210',
  };
  // `isFamilyMember: true` short-circuits person-identity resolution to
  // `{ mode: 'none' }`, keeping this test focused on the UMID branch alone.
  const ctx = { branchId: 'b1', actorId: 'u1', isFamilyMember: true };

  const createdUmId = (): unknown => {
    const calls = txMock.patient.create.mock.calls as {
      data: { umId: unknown };
    }[][];
    return calls[0]?.[0]?.data.umId;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    txMock = {
      patient: { create: jest.fn().mockResolvedValue({ id: 'p1' }) },
      medicalHistory: {
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    prismaMock = {
      withTenant: jest.fn((_tenantId: string, fn: (tx: unknown) => unknown) =>
        fn(txMock),
      ),
    };
    externalIdServiceMock = {
      getConfiguredFormat: jest.fn().mockResolvedValue(ExternalIdFormat.NONE),
    };
    service = new PatientService(
      prismaMock as unknown as PrismaService,
      {} as unknown as PtCategoryService,
      externalIdServiceMock as unknown as ExternalIdService,
      {} as unknown as EventEmitter2,
    );
  });

  it('throws PatientUmIdRequiredException when no umId is given and auto-UMID is not allowed', async () => {
    await expect(service.create('t1', baseDto, ctx)).rejects.toBeInstanceOf(
      PatientUmIdRequiredException,
    );
    expect(txMock.patient.create).not.toHaveBeenCalled();
  });

  it('auto-generates a fallback UMID when allowAutoUmId is true and none is given', async () => {
    await service.create('t1', baseDto, ctx, { allowAutoUmId: true });

    expect(txMock.patient.create).toHaveBeenCalledTimes(1);
    expect(createdUmId()).toMatch(/^PAT-QT-[0-9A-F]{8}$/);
  });

  it('still uses the manually-supplied umId as-is when one is given, regardless of allowAutoUmId', async () => {
    await service.create('t1', { ...baseDto, umId: 'MANUAL-1' }, ctx, {
      allowAutoUmId: true,
    });

    expect(createdUmId()).toBe('MANUAL-1');
  });
});
