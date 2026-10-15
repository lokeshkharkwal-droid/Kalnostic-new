import { inLockOrder, inRequestOrder } from './request-order.util';

describe('inLockOrder', () => {
  it('sorts ascending, whatever the input order', () => {
    expect(inLockOrder(['c', 'a', 'b'])).toEqual(['a', 'b', 'c']);
    expect(inLockOrder(['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('two requests that pick the same rows in opposite orders get the SAME order', () => {
    expect(inLockOrder(['t1', 't2', 't3'])).toEqual(
      inLockOrder(['t3', 't2', 't1']),
    );
  });

  it('does not change the array it was given', () => {
    const ids = ['c', 'a', 'b'];
    inLockOrder(ids);
    expect(ids).toEqual(['c', 'a', 'b']);
  });

  it('handles empty, single and duplicate ids', () => {
    expect(inLockOrder([])).toEqual([]);
    expect(inLockOrder(['x'])).toEqual(['x']);
    expect(inLockOrder(['b', 'a', 'b'])).toEqual(['a', 'b', 'b']);
  });

  it('is locale-independent for UUIDs (plain code-unit order)', () => {
    const ids = [
      'ff000000-0000-4000-8000-000000000000',
      '00000000-0000-4000-8000-000000000001',
      'AA000000-0000-4000-8000-000000000000',
    ];
    expect(inLockOrder(ids)).toEqual([...ids].sort());
  });
});

describe('inRequestOrder', () => {
  const id = (x: string) => x;

  it('puts results back in the order the caller asked for', () => {
    expect(inRequestOrder(['a', 'b', 'c'], ['c', 'a', 'b'], id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('works on objects through the id accessor', () => {
    const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(inRequestOrder(rows, ['b', 'c', 'a'], (r) => r.id)).toEqual([
      { id: 'b' },
      { id: 'c' },
      { id: 'a' },
    ]);
  });

  it('only the processed subset is returned, in requested order (skipped rows are simply absent)', () => {
    expect(inRequestOrder(['a', 'c'], ['c', 'b', 'a'], id)).toEqual(['c', 'a']);
  });

  it('an id that was not requested goes to the end, in its own order', () => {
    expect(inRequestOrder(['z', 'a', 'y'], ['a'], id)).toEqual(['a', 'z', 'y']);
  });

  it('is stable for duplicates (a repeated id keeps its relative order)', () => {
    const rows = [
      { id: 'a', n: 1 },
      { id: 'b', n: 2 },
      { id: 'a', n: 3 },
    ];
    expect(inRequestOrder(rows, ['b', 'a'], (r) => r.id)).toEqual([
      { id: 'b', n: 2 },
      { id: 'a', n: 1 },
      { id: 'a', n: 3 },
    ]);
  });

  it('does not change the arrays it was given', () => {
    const items = ['a', 'b', 'c'];
    const requested = ['c', 'b', 'a'];
    inRequestOrder(items, requested, id);
    expect(items).toEqual(['a', 'b', 'c']);
    expect(requested).toEqual(['c', 'b', 'a']);
  });

  it('handles empty inputs', () => {
    expect(inRequestOrder([], ['a'], id)).toEqual([]);
    expect(inRequestOrder(['a'], [], id)).toEqual(['a']);
  });

  it('round-trips with inLockOrder: work in sorted order, report in asked order', () => {
    const asked = ['t3', 't1', 't2'];
    const processed = inLockOrder(asked); // t1 t2 t3
    expect(inRequestOrder(processed, asked, id)).toEqual(asked);
  });
});
