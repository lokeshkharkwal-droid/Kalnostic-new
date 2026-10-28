import 'reflect-metadata';
import { LabReportStatus, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderService } from './order.service';
import { ListOrdersDto } from './dto/list-orders.dto';
import { COLLECTION_WORKFLOW_ITEM_WHERE } from '../../common/utils';

/**
 * Coverage for the Order Console's two independent status filters:
 * - `labReportStatus` ("Report Status") — per-report `LabReportStatus`: an order
 *   matches when at least one live report on a workflow item is in that status.
 * - `reportStatus` ("Order Status") — the order-level rollup from
 *   `deriveReportStatus`, which now includes `PUBLISHED`.
 * Selecting both must AND them, never let one replace the other.
 */
describe('OrderService — Order Console status filters', () => {
  const findMany = jest.fn<Promise<unknown[]>, [unknown]>();
  const deps = Array(14).fill(undefined) as unknown[];
  deps[0] = { order: { findMany } };
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );

  /** Run the private where-builder for an Order Console-shaped query. */
  const build = async (query: ListOrdersDto) => {
    const { where } = await (
      service as unknown as {
        buildOrderWhere: (
          q: ListOrdersDto,
          tenantId: string,
          branchId: string | null,
        ) => Promise<{ where: Prisma.OrderWhereInput }>;
      }
    ).buildOrderWhere(
      { section: 'DIAGNOSTICS', ...query },
      'tenant-1',
      'branch-1',
    );
    return where;
  };

  /** The clause the `labReportStatus` filter is expected to push. */
  const labReportClause = (status: LabReportStatus) => ({
    items: {
      some: {
        deletedAt: null,
        ...COLLECTION_WORKFLOW_ITEM_WHERE,
        labReports: { some: { deletedAt: null, status } },
      },
    },
  });

  beforeEach(() => {
    findMany.mockReset().mockResolvedValue([]);
  });

  it.each<LabReportStatus>([
    LabReportStatus.PENDING,
    LabReportStatus.PARTIAL_PENDING,
    LabReportStatus.SAVED,
    LabReportStatus.VALIDATION_PENDING,
    LabReportStatus.RESULT_DONE,
    LabReportStatus.APPROVED,
    LabReportStatus.PUBLISHED,
  ])(
    'matches orders with a live workflow report in %s',
    async (labReportStatus) => {
      const where = await build({ labReportStatus });
      expect(where.AND).toContainEqual(labReportClause(labReportStatus));
    },
  );

  it('is a plain where clause: no orders are loaded to scan', async () => {
    await build({ labReportStatus: LabReportStatus.SAVED });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('adds no report clause when the query omits it', async () => {
    const where = await build({});
    expect(JSON.stringify(where)).not.toContain('labReports');
  });

  it('scans for the Order Status within the Report Status matches', async () => {
    findMany.mockResolvedValue([
      {
        id: 'published',
        items: [
          {
            branchLabTest: { isBillOnlyTest: false },
            branchLabPanel: null,
            labReports: [
              {
                status: LabReportStatus.PUBLISHED,
                memberBranchLabTestId: null,
              },
            ],
          },
        ],
      },
      {
        id: 'approved',
        items: [
          {
            branchLabTest: { isBillOnlyTest: false },
            branchLabPanel: null,
            labReports: [
              {
                status: LabReportStatus.APPROVED,
                memberBranchLabTestId: null,
              },
            ],
          },
        ],
      },
    ]);
    const where = await build({
      labReportStatus: LabReportStatus.PUBLISHED,
      reportStatus: 'PUBLISHED',
    });
    // The candidate scan already carries the Report Status clause...
    const scanWhere = findMany.mock.calls[0]?.[0] as {
      where: Prisma.OrderWhereInput;
    };
    expect(scanWhere.where.AND).toContainEqual(
      labReportClause(LabReportStatus.PUBLISHED),
    );
    // ...and both clauses survive in the final where (ANDed, not replaced).
    expect(where.AND).toContainEqual(
      labReportClause(LabReportStatus.PUBLISHED),
    );
    expect(where.AND).toContainEqual({ id: { in: ['published'] } });
  });

  it('keeps a fully published order out of the APPROVED Order Status', async () => {
    findMany.mockResolvedValue([
      {
        id: 'published',
        items: [
          {
            branchLabTest: { isBillOnlyTest: false },
            branchLabPanel: null,
            labReports: [
              {
                status: LabReportStatus.PUBLISHED,
                memberBranchLabTestId: null,
              },
            ],
          },
        ],
      },
    ]);
    const where = await build({ reportStatus: 'APPROVED' });
    expect(where.AND).toContainEqual({ id: { in: [] } });
  });

  describe('the query parameters', () => {
    const check = (body: Record<string, unknown>) =>
      validate(plainToInstance(ListOrdersDto, body));

    it.each(Object.values(LabReportStatus))(
      'accepts labReportStatus=%s',
      async (v) => {
        expect(await check({ labReportStatus: v })).toHaveLength(0);
      },
    );

    it.each(['pending', 'Published', 'BANANA', 'PARTIALLY_COMPLETED', ''])(
      'rejects labReportStatus=%j',
      async (v) => {
        const errors = await check({ labReportStatus: v });
        expect(errors.some((e) => e.property === 'labReportStatus')).toBe(true);
      },
    );

    it.each([
      'PENDING',
      'PARTIALLY_COMPLETED',
      'COMPLETED',
      'APPROVED',
      'PUBLISHED',
    ])('accepts reportStatus=%s', async (v) => {
      expect(await check({ reportStatus: v })).toHaveLength(0);
    });

    it('rejects a per-report status as the Order Status', async () => {
      const errors = await check({ reportStatus: 'RESULT_DONE' });
      expect(errors.some((e) => e.property === 'reportStatus')).toBe(true);
    });
  });
});
