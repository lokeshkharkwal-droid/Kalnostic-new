import { Prisma } from '@prisma/client';
import { OrderService } from './order.service';
import { ListOrdersDto } from './dto/list-orders.dto';

/**
 * The Order Console (`GET /orders?scopeByDepartment=true`) shows a user only the
 * orders that contain at least one test/panel visible to their department(s) —
 * the same department-visibility rule enforced on Accession In-House Orders and
 * the Technician Reporting worklist. A test/panel with NO department is visible
 * to everyone; a user with NO department assignment is unrestricted. These tests
 * pin that behaviour to `buildOrderWhere` + the `UserDepartmentScopeService`
 * resolution in `findAll`.
 */
describe('OrderService.findAll — Order Console department visibility', () => {
  const resolveDepartmentIds = jest.fn<Promise<string[]>, [string, string]>();
  const orderMock = {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  };

  const deps = Array(15).fill(undefined) as unknown[];
  deps[0] = { order: orderMock };
  deps[14] = { resolveDepartmentIds };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  const internals = service as unknown as {
    buildOrderWhere: (
      q: ListOrdersDto,
      tenantId: string,
      branchId: string | null,
      opts?: { departmentScopeIds?: string[] },
    ) => Promise<{ where: Prisma.OrderWhereInput }>;
  };
  let buildSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    buildSpy = jest.spyOn(internals, 'buildOrderWhere');
  });
  afterEach(() => buildSpy.mockRestore());

  /** The extra AND clauses `buildOrderWhere` assembled for `query`. */
  const andClausesFor = async (
    query: ListOrdersDto,
    personId?: string,
  ): Promise<Prisma.OrderWhereInput[]> => {
    await service.findAll('tenant-1', 'branch-1', query, personId);
    const result = buildSpy.mock.results[0];
    if (!result) throw new Error('buildOrderWhere was not called');
    const { where } = (await result.value) as {
      where: Prisma.OrderWhereInput;
    };
    const and = where.AND;
    return Array.isArray(and) ? and : and ? [and] : [];
  };

  it('scopes to the caller’s departments (unassigned OR their depts) when opted in', async () => {
    resolveDepartmentIds.mockResolvedValue(['dept-a', 'dept-b']);
    const and = await andClausesFor(
      { scopeByDepartment: true, section: 'DIAGNOSTICS' },
      'person-1',
    );
    expect(resolveDepartmentIds).toHaveBeenCalledWith('tenant-1', 'person-1');

    const deptVisible = {
      OR: [
        { departmentId: null },
        { departmentId: { in: ['dept-a', 'dept-b'] } },
      ],
    };
    expect(and).toContainEqual({
      items: {
        some: {
          deletedAt: null,
          OR: [
            { branchLabTest: { is: deptVisible } },
            { branchLabPanel: { is: deptVisible } },
          ],
        },
      },
    });
  });

  it('adds no department clause for a user with no department assignment', async () => {
    resolveDepartmentIds.mockResolvedValue([]);
    const and = await andClausesFor(
      { scopeByDepartment: true, section: 'DIAGNOSTICS' },
      'person-1',
    );
    expect(resolveDepartmentIds).toHaveBeenCalledTimes(1);
    expect(and.some((c) => 'items' in c)).toBe(false);
  });

  it('never resolves or scopes departments without the opt-in flag (Billing/Quotations)', async () => {
    const and = await andClausesFor({ section: 'DIAGNOSTICS' }, 'person-1');
    expect(resolveDepartmentIds).not.toHaveBeenCalled();
    expect(and.some((c) => 'items' in c)).toBe(false);
  });
});
