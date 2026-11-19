import { AccessionGroupingMode } from '@prisma/client';
import { SampleTransferService } from './sample-transfer.service';

/**
 * A transferred sample belongs to the SAME order as its source, so the referral queue groups it by that
 * order's own grouping mode - the same rule the In-House list uses - not by the tenant's current mode.
 */
describe("SampleTransferService.withGroupKeys - grouped by the order's own mode", () => {
  const withGroupKeys = (
    rows: unknown[],
    fallback: AccessionGroupingMode,
  ): { groupingMode: AccessionGroupingMode; groupKey: string }[] =>
    (
      Object.create(SampleTransferService.prototype) as unknown as {
        withGroupKeys: (
          rows: unknown[],
          fallbackMode: AccessionGroupingMode,
        ) => { groupingMode: AccessionGroupingMode; groupKey: string }[];
      }
    ).withGroupKeys(rows, fallback);

  const row = (
    id: string,
    dept: string,
    mode: AccessionGroupingMode | null,
  ) => ({
    id,
    sample: {
      id: `s-${id}`,
      orderId: 'o1',
      departmentId: dept,
      sampleGroupLabel: 'Serum',
      order: { id: 'o1', groupingMode: mode },
    },
  });

  it('an order in DEPARTMENT mode keeps one group per department although the tenant is now ORDER', () => {
    const [a, b] = withGroupKeys(
      [
        row('t1', 'd1', AccessionGroupingMode.DEPARTMENT),
        row('t2', 'd2', AccessionGroupingMode.DEPARTMENT),
      ],
      AccessionGroupingMode.ORDER,
    );
    expect(a!.groupingMode).toBe(AccessionGroupingMode.DEPARTMENT);
    expect(a!.groupKey).toBe('o1::DEPT::d1');
    expect(b!.groupKey).toBe('o1::DEPT::d2');
  });

  it('an order in ORDER mode collapses into one group although the tenant is now DEPARTMENT', () => {
    const [a, b] = withGroupKeys(
      [
        row('t1', 'd1', AccessionGroupingMode.ORDER),
        row('t2', 'd2', AccessionGroupingMode.ORDER),
      ],
      AccessionGroupingMode.DEPARTMENT,
    );
    expect(a!.groupKey).toBe('o1::ORDER');
    expect(b!.groupKey).toBe('o1::ORDER');
  });

  it('an order with no mode yet falls back to the tenant mode', () => {
    const [a] = withGroupKeys(
      [row('t1', 'd1', null)],
      AccessionGroupingMode.ORDER,
    );
    expect(a!.groupingMode).toBe(AccessionGroupingMode.ORDER);
    expect(a!.groupKey).toBe('o1::ORDER');
  });

  it('two orders in one page can use different modes', () => {
    const rows = [
      {
        ...row('t1', 'd1', AccessionGroupingMode.ORDER),
        sample: {
          ...row('t1', 'd1', AccessionGroupingMode.ORDER).sample,
          orderId: 'oA',
        },
      },
      {
        ...row('t2', 'd1', AccessionGroupingMode.DEPARTMENT),
        sample: {
          ...row('t2', 'd1', AccessionGroupingMode.DEPARTMENT).sample,
          orderId: 'oB',
        },
      },
    ];
    const [a, b] = withGroupKeys(
      rows,
      AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME,
    );
    expect(a!.groupKey).toBe('oA::ORDER');
    expect(b!.groupKey).toBe('oB::DEPT::d1');
  });
});
