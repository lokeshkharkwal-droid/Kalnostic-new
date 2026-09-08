import { buildEvaluationOrder, validateFormulaSet } from './formula-graph';
import { FormulaParam } from './formula.types';

const measured = (code: string): FormulaParam => ({
  code,
  isCalculated: false,
});
const calc = (code: string, formula: string): FormulaParam => ({
  code,
  isCalculated: true,
  formula,
});

describe('formula-graph', () => {
  describe('buildEvaluationOrder', () => {
    it('orders a dynamic-on-dynamic chain with dependencies first', () => {
      const params = [
        measured('P1'),
        measured('P2'),
        calc('P3', 'P1 - P2'), // measured refs only
        calc('P4', 'P3 * 2'), // depends on calculated P3
      ];
      const res = buildEvaluationOrder(params);
      expect(res.ok).toBe(true);
      if (res.ok)
        expect(res.order.indexOf('P3')).toBeLessThan(res.order.indexOf('P4'));
    });

    it('detects a dependency cycle', () => {
      const params = [calc('A', 'B + 1'), calc('B', 'A + 1')];
      const res = buildEvaluationOrder(params);
      expect(res.ok).toBe(false);
      if (!res.ok)
        expect(res.cycle).toEqual(expect.arrayContaining(['A', 'B']));
    });
  });

  describe('validateFormulaSet', () => {
    it('accepts a valid set and returns the order', () => {
      const res = validateFormulaSet([
        measured('P1'),
        measured('P3'),
        calc('P4', 'P1 + P3'),
      ]);
      expect(res).toEqual({ ok: true, order: ['P4'] });
    });

    it('rejects a self reference', () => {
      const res = validateFormulaSet([measured('P1'), calc('P4', 'P4 + P1')]);
      expect(res).toEqual({ ok: false, kind: 'SELF_REF', code: 'P4' });
    });

    it('rejects an unknown reference', () => {
      const res = validateFormulaSet([measured('P1'), calc('P4', 'P1 + PX')]);
      expect(res).toEqual({
        ok: false,
        kind: 'UNKNOWN_REF',
        code: 'P4',
        ref: 'PX',
      });
    });

    it('rejects invalid syntax', () => {
      const res = validateFormulaSet([measured('P1'), calc('P4', 'P1 +')]);
      expect(res).toEqual({ ok: false, kind: 'SYNTAX', code: 'P4' });
    });

    it('rejects a cycle', () => {
      const res = validateFormulaSet([calc('A', 'B'), calc('B', 'A')]);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.kind).toBe('CYCLE');
    });
  });
});
