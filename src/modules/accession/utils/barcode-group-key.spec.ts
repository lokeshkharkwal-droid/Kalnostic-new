import { AccessionGroupingMode } from '@prisma/client';
import { barcodeGroupKey, BarcodeGroupable } from './barcode-group-key';

/** A minimal groupable sample; override only the fields a case cares about. */
function sample(over: Partial<BarcodeGroupable> = {}): BarcodeGroupable {
  return {
    id: 's1',
    departmentId: 'dept-a',
    sampleGroupLabel: 'EDTA',
    ...over,
  };
}

describe('barcodeGroupKey — the one shared grouping rule', () => {
  it('ORDER mode buckets the whole order together (key ignores the sample)', () => {
    expect(barcodeGroupKey(sample(), AccessionGroupingMode.ORDER)).toBe('ORDER');
    // Two different samples collapse to the same key → one group per order.
    expect(barcodeGroupKey(sample({ id: 's2' }), AccessionGroupingMode.ORDER)).toBe(
      'ORDER',
    );
  });

  it('SAMPLE_NAME mode gives every sample its own group (keyed by id)', () => {
    expect(barcodeGroupKey(sample({ id: 's1' }), AccessionGroupingMode.SAMPLE_NAME)).toBe(
      'SAMPLE::s1',
    );
    expect(barcodeGroupKey(sample({ id: 's2' }), AccessionGroupingMode.SAMPLE_NAME)).toBe(
      'SAMPLE::s2',
    );
  });

  it('DEPARTMENT mode buckets by department id, with a stable "none" fallback', () => {
    expect(barcodeGroupKey(sample({ departmentId: 'dept-a' }), AccessionGroupingMode.DEPARTMENT)).toBe(
      'DEPT::dept-a',
    );
    expect(barcodeGroupKey(sample({ departmentId: null }), AccessionGroupingMode.DEPARTMENT)).toBe(
      'DEPT::none',
    );
  });

  it('DEPARTMENT_SAMPLE_NAME mode buckets by department + sample name', () => {
    expect(
      barcodeGroupKey(
        sample({ departmentId: 'dept-a', sampleGroupLabel: 'EDTA' }),
        AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME,
      ),
    ).toBe('DEPT_SAMPLE::dept-a::EDTA');
    // Null department + null label fall back to the same stable tokens.
    expect(
      barcodeGroupKey(
        sample({ departmentId: null, sampleGroupLabel: null }),
        AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME,
      ),
    ).toBe('DEPT_SAMPLE::none::General');
  });

  it('samples that share a bucket produce an IDENTICAL key (the group-membership contract)', () => {
    const a = sample({ id: 'a', departmentId: 'd1', sampleGroupLabel: 'Serum' });
    const b = sample({ id: 'b', departmentId: 'd1', sampleGroupLabel: 'Serum' });
    const mode = AccessionGroupingMode.DEPARTMENT_SAMPLE_NAME;
    expect(barcodeGroupKey(a, mode)).toBe(barcodeGroupKey(b, mode));
    // ...but a different sample name splits them.
    expect(barcodeGroupKey(a, mode)).not.toBe(
      barcodeGroupKey({ ...b, sampleGroupLabel: 'Plasma' }, mode),
    );
  });
});
