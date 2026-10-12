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
});

/**
 * Unit coverage for the manual-UMID (`ExternalIdFormat.NONE`) branch of
 * `create()`. `POST /patients` (Create Patient / Create Order) must keep
 * requiring a manual UMID; only a trusted caller passing
 * `{ allowAutoUmId: true }` (the quotation patient-creation route) may get a
 * system-generated fallback instead.
 */
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

/**
 * Symptoms are per-visit on the Registration Create pages, so those pages omit
 * `richHistory.symptoms`. An omitted list must never wipe the patient's stored
 * symptoms (JSON or flat `has*` columns); an explicit list still replaces them.
 */
describe('PatientService medical-history symptoms', () => {
  /** The `data` argument of a medicalHistory write. */
  type WriteArg = { data: Record<string, unknown> };

  let prismaMock: {
    patient: { findFirst: jest.Mock };
    medicalHistory: {
      findFirst: jest.Mock;
      update: jest.Mock;
      create: jest.Mock;
    };
  };
  let service: PatientService;

  const stored = {
    id: 'mh1',
    richHistory: {
      entries: { medical: [] },
      symptoms: ['Cough', 'Fever'],
    },
  };
  const medicalEntry = { condition: 'Diabetes', since: '2020' };

  const writtenData = (mock: jest.Mock): Record<string, unknown> =>
    (mock.mock.calls[0] as [WriteArg])[0].data;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock = {
      patient: {
        findFirst: jest.fn().mockResolvedValue({ id: 'p1', branchId: 'b1' }),
      },
      medicalHistory: {
        findFirst: jest.fn().mockResolvedValue(stored),
        update: jest.fn().mockResolvedValue(stored),
        create: jest.fn().mockResolvedValue(stored),
      },
    };
    service = new PatientService(
      prismaMock as unknown as PrismaService,
      {} as unknown as PtCategoryService,
      {} as unknown as ExternalIdService,
      {} as unknown as EventEmitter2,
    );
  });

  it('keeps the stored symptoms when an update omits them', async () => {
    await service.updateMedicalHistory('mh1', 't1', 'p1', {
      richHistory: { entries: { medical: [medicalEntry] } },
    });

    const data = writtenData(prismaMock.medicalHistory.update);
    expect(data.richHistory).toEqual({
      entries: { medical: [medicalEntry] },
      symptoms: ['Cough', 'Fever'],
    });
    expect(data.hasDiabetes).toBe(true);
    expect(data.hasCough).toBe(true);
    expect(data.hasFever).toBe(true);
  });

  it('writes no symptom columns when an update omits them and none are stored', async () => {
    prismaMock.medicalHistory.findFirst.mockResolvedValue({
      id: 'mh1',
      richHistory: null,
    });

    await service.updateMedicalHistory('mh1', 't1', 'p1', {
      richHistory: { entries: { medical: [medicalEntry] } },
    });

    const data = writtenData(prismaMock.medicalHistory.update);
    expect(data.richHistory).not.toHaveProperty('symptoms');
    expect(data).not.toHaveProperty('hasCough');
    expect(data.hasDiabetes).toBe(true);
  });

  it('replaces the stored symptoms when an update sends them explicitly', async () => {
    await service.updateMedicalHistory('mh1', 't1', 'p1', {
      richHistory: { symptoms: ['Fever'] },
    });

    const data = writtenData(prismaMock.medicalHistory.update);
    expect(data.richHistory).toEqual({ symptoms: ['Fever'] });
    expect(data.hasFever).toBe(true);
    expect(data.hasCough).toBe(false);
  });

  it('clears the stored symptoms when an update sends an empty list', async () => {
    await service.updateMedicalHistory('mh1', 't1', 'p1', {
      richHistory: { symptoms: [] },
    });

    const data = writtenData(prismaMock.medicalHistory.update);
    expect(data.richHistory).toEqual({ symptoms: [] });
    expect(data.hasCough).toBe(false);
    expect(data.hasFever).toBe(false);
  });

  it('writes no symptom columns when a create omits them', async () => {
    await service.addMedicalHistory('t1', 'p1', {
      richHistory: { entries: { medical: [medicalEntry] } },
    });

    const data = writtenData(prismaMock.medicalHistory.create);
    expect(data).not.toHaveProperty('hasCough');
    expect(data.richHistory).not.toHaveProperty('symptoms');
    expect(data.hasDiabetes).toBe(true);
  });
});
