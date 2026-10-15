import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import { ListOrdersDto } from './dto/list-orders.dto';

/**
 * Patient Detail lists a patient's orders via `GET /orders?patientId=…`. Patients
 * are tenant-scoped, so that history must span every branch (like their dues) —
 * otherwise a patient registered or billed at another branch looks order-less.
 * Every other list keeps defaulting to the active branch.
 */
describe('OrderService.findAll — patient order history branch scope', () => {
  const deps = Array(13).fill(undefined) as unknown[];
  deps[0] = {
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
  };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const internals = service as unknown as {
    buildOrderWhere: (
      q: ListOrdersDto,
      tenantId: string,
      branchId: string | null,
    ) => Promise<{ where: Prisma.OrderWhereInput }>;
  };
  let buildSpy: jest.SpyInstance;

  beforeEach(() => {
    buildSpy = jest
      .spyOn(internals, 'buildOrderWhere')
      // Stop right after the scope is chosen; only its arguments matter here.
      .mockRejectedValue(new Error('stop'));
  });
  afterEach(() => buildSpy.mockRestore());

  const scopeFor = async (query: ListOrdersDto): Promise<unknown> => {
    await expect(
      service.findAll('tenant-1', 'branch-1', query),
    ).rejects.toThrow('stop');
    return (buildSpy.mock.calls[0] as unknown[])[2];
  };

  it('spans all branches for a single patient’s history', async () => {
    expect(await scopeFor({ patientId: 'p-1' })).toBeNull();
  });

  it('still defaults to the active branch for every other list', async () => {
    expect(await scopeFor({ section: 'DIAGNOSTICS' })).toBe('branch-1');
  });

  it('keeps the active branch for patient quotations (branch expiry settings)', async () => {
    expect(await scopeFor({ patientId: 'p-1', isQuotation: true })).toBe(
      'branch-1',
    );
  });
});
