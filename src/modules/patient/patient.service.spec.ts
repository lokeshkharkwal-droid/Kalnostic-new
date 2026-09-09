import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { PtCategoryService } from '../pt-category/pt-category.service';
import { ExternalIdService } from '../registration-settings/external-id.service';
import { PatientService } from './patient.service';

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
