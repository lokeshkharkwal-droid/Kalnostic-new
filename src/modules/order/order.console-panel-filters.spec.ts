import { OrderService } from './order.service';
import { orderItemDetails } from './entities/order.entity';

/**
 * Order Console: the Department and Lab Test filters reach a test through the panels on the order
 * (by the tests actually ordered), and the "Order Item" hover gets each panel's ordered tests.
 */
describe('Order Console panel-aware filters', () => {
  const prisma = {
    labTest: { findMany: jest.fn() },
    branchLabTest: { findMany: jest.fn(), findFirst: jest.fn() },
    branchLabPanelTest: { findMany: jest.fn() },
  };
  const deps = Array(15).fill(undefined) as unknown[];
  deps[0] = prisma;
  const service = new OrderService(
    ...(deps as ConstructorParameters<typeof OrderService>),
  );
  const internals = service as unknown as {
    departmentFilterClause: (t: string, d: string) => Promise<unknown>;
    labTestFilterClause: (t: string, id: string) => Promise<unknown>;
  };

  beforeEach(() => jest.resetAllMocks());

  describe('Department filter', () => {
    it('matches a panel through its ordered member tests in the department, not the panel’s own label', async () => {
      prisma.labTest.findMany.mockResolvedValue([{ id: 'master-1' }]);
      prisma.branchLabTest.findMany.mockResolvedValue([
        { id: 'sgpt' },
        { id: 'sgot' },
      ]);
      prisma.branchLabPanelTest.findMany.mockResolvedValue([
        { branchLabPanelId: 'panel-a' },
      ]);

      const clause = await internals.departmentFilterClause('t1', 'dept-bio');

      expect(clause).toEqual({
        OR: [
          {
            branchLabTest: {
              is: {
                OR: [
                  { departmentId: 'dept-bio' },
                  { departmentId: null, sourceLabTestId: { in: ['master-1'] } },
                ],
              },
            },
          },
          {
            branchLabPanelId: { in: ['panel-a'] },
            OR: [
              { selectedMemberBranchLabTestIds: { isEmpty: true } },
              { selectedMemberBranchLabTestIds: { hasSome: ['sgpt', 'sgot'] } },
            ],
          },
        ],
      });
      // The panel's own department column is never consulted.
      expect(JSON.stringify(clause)).not.toContain('branchLabPanel:');
    });

    it('falls back to a standalone-test match when no panel contains a test of the department', async () => {
      prisma.labTest.findMany.mockResolvedValue([]);
      prisma.branchLabTest.findMany.mockResolvedValue([{ id: 'cbc' }]);
      prisma.branchLabPanelTest.findMany.mockResolvedValue([]);

      const clause = await internals.departmentFilterClause('t1', 'dept-hae');

      expect(clause).toEqual({
        branchLabTest: { is: { OR: [{ departmentId: 'dept-hae' }] } },
      });
    });
  });

  describe('Lab Test filter', () => {
    it('matches the test ordered alone OR inside a panel (any pricing-list copy of the test)', async () => {
      prisma.branchLabTest.findFirst.mockResolvedValue({
        sourceLabTestId: 'src-1',
      });
      prisma.branchLabTest.findMany.mockResolvedValue([
        { id: 'sgpt' },
        { id: 'sgpt-copy' },
      ]);
      prisma.branchLabPanelTest.findMany.mockResolvedValue([
        { branchLabPanelId: 'panel-a' },
        { branchLabPanelId: 'panel-c' },
      ]);

      const clause = await internals.labTestFilterClause('t1', 'sgpt');

      expect(clause).toEqual({
        OR: [
          { branchLabTestId: 'sgpt' },
          {
            branchLabPanelId: { in: ['panel-a', 'panel-c'] },
            OR: [
              { selectedMemberBranchLabTestIds: { isEmpty: true } },
              {
                selectedMemberBranchLabTestIds: {
                  hasSome: ['sgpt', 'sgpt-copy'],
                },
              },
            ],
          },
        ],
      });
    });

    it('is the plain test match when no panel contains the test (behaviour unchanged)', async () => {
      prisma.branchLabTest.findFirst.mockResolvedValue({
        sourceLabTestId: null,
      });
      prisma.branchLabPanelTest.findMany.mockResolvedValue([]);

      expect(await internals.labTestFilterClause('t1', 'cbc')).toEqual({
        branchLabTestId: 'cbc',
      });
    });
  });

  describe('orderItemDetails (panel hover)', () => {
    const members = new Map([
      [
        'panel-a',
        [
          { id: 'cbc', name: 'CBC' },
          { id: 'hb', name: 'Hemoglobin' },
          { id: 'sgpt', name: 'SGPT' },
        ],
      ],
    ]);
    const panel = (selected: string[]) => ({
      direct: null,
      selectedMemberBranchLabTestIds: selected,
      branchLabTest: null,
      branchLabPanel: { id: 'panel-a', panelName: 'Panel A' },
    });

    it('lists every member of a panel ordered in full', () => {
      expect(orderItemDetails([panel([])], members)).toEqual([
        {
          name: 'Panel A',
          isPanel: true,
          panelTests: ['CBC', 'Hemoglobin', 'SGPT'],
        },
      ]);
    });

    it('lists only the ordered tests of a partially ordered panel', () => {
      expect(orderItemDetails([panel(['cbc', 'sgpt'])], members)).toEqual([
        { name: 'Panel A', isPanel: true, panelTests: ['CBC', 'SGPT'] },
      ]);
    });

    it('leaves a standalone test without panel tests and skips bill-only items, in the same order as itemNames', () => {
      const out = orderItemDetails(
        [
          {
            direct: null,
            branchLabTest: { testName: 'LFT' },
            branchLabPanel: null,
          },
          {
            direct: null,
            branchLabTest: { testName: 'Hidden', isBillOnlyTest: true },
            branchLabPanel: null,
          },
          panel([]),
        ],
        members,
      );
      expect(out.map((d) => d.name)).toEqual(['LFT', 'Panel A']);
      expect(out[0]).toEqual({ name: 'LFT', isPanel: false, panelTests: [] });
      expect(out[1]?.isPanel).toBe(true);
    });
  });
});
