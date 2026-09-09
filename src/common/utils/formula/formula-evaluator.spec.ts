import {
  evaluateFormula,
  extractRefs,
  formatCalculatedValue,
  isValidFormulaSyntax,
  tokenize,
} from './formula-evaluator';

describe('formula-evaluator', () => {
  describe('tokenize', () => {
    it('classifies all-digit runs as numbers and mixed runs as identifiers', () => {
      expect(tokenize('P1 + 24HRPROT')).toEqual([
        { type: 'ident', value: 'P1' },
        { type: 'op', value: '+' },
        { type: 'ident', value: '24HRPROT' },
      ]);
    });

    it('reads decimal literals', () => {
      expect(tokenize('1.5 * 2')).toEqual([
        { type: 'number', value: '1.5' },
        { type: 'op', value: '*' },
        { type: 'number', value: '2' },
      ]);
    });

    it('rejects illegal characters', () => {
      expect(tokenize('P1 % P2')).toBeNull();
      expect(tokenize('P1 . P2')).toBeNull();
    });
  });

  describe('evaluateFormula', () => {
    const values = { P1: 100, P2: 20, P3: 5 };

    it('respects operator precedence', () => {
      expect(evaluateFormula('P1 + P2 * P3', values)).toEqual({
        ok: true,
        value: 200,
      });
    });

    it('honours parentheses', () => {
      expect(evaluateFormula('(P1 - P2) / P3', values)).toEqual({
        ok: true,
        value: 16,
      });
    });

    it('supports unary minus', () => {
      expect(evaluateFormula('-P2 + P1', values)).toEqual({
        ok: true,
        value: 80,
      });
      expect(evaluateFormula('P1 * -1', values)).toEqual({
        ok: true,
        value: -100,
      });
    });

    it('computes the requirement example P1 - P2 = 80', () => {
      expect(evaluateFormula('P1 - P2', { P1: 100, P2: 20 })).toEqual({
        ok: true,
        value: 80,
      });
    });

    it('flags division by zero', () => {
      expect(evaluateFormula('P1 / P0', { P1: 100, P0: 0 })).toEqual({
        ok: false,
        error: 'DIV_ZERO',
      });
    });

    it('flags a missing (blank) input', () => {
      expect(evaluateFormula('P1 + P2', { P1: 100, P2: null })).toEqual({
        ok: false,
        error: 'MISSING_INPUT',
        ref: 'P2',
      });
    });

    it('flags an unknown reference', () => {
      expect(evaluateFormula('P1 + PX', values)).toEqual({
        ok: false,
        error: 'UNKNOWN_REF',
        ref: 'PX',
      });
    });

    it('flags a non-numeric value', () => {
      expect(evaluateFormula('P1 + P2', { P1: 100, P2: NaN })).toEqual({
        ok: false,
        error: 'NON_NUMERIC',
        ref: 'P2',
      });
    });

    it('rejects invalid syntax', () => {
      expect(evaluateFormula('P1 +', values)).toEqual({
        ok: false,
        error: 'INVALID_SYNTAX',
      });
      expect(evaluateFormula('P1 P2', values)).toEqual({
        ok: false,
        error: 'INVALID_SYNTAX',
      });
      expect(evaluateFormula('(P1 + P2', values)).toEqual({
        ok: false,
        error: 'INVALID_SYNTAX',
      });
      expect(evaluateFormula('', values)).toEqual({
        ok: false,
        error: 'INVALID_SYNTAX',
      });
    });
  });

  describe('extractRefs', () => {
    it('collects distinct identifiers, ignoring numbers', () => {
      expect(extractRefs('(P1 + P3) * 2 - P1').sort()).toEqual(['P1', 'P3']);
    });

    it('returns [] for invalid input', () => {
      expect(extractRefs('P1 % P2')).toEqual([]);
    });
  });

  describe('isValidFormulaSyntax', () => {
    it('accepts well-formed and rejects malformed expressions', () => {
      expect(isValidFormulaSyntax('(P1 - P2) / P3')).toBe(true);
      expect(isValidFormulaSyntax('P1 ** P2')).toBe(false);
    });
  });

  describe('formatCalculatedValue', () => {
    it('formats using the configured decimal places (default 2)', () => {
      expect(formatCalculatedValue(80)).toBe('80.00');
      expect(formatCalculatedValue(16.6666, 1)).toBe('16.7');
      expect(formatCalculatedValue(5, 0)).toBe('5');
    });

    it('clamps decimal places to 0–6', () => {
      expect(formatCalculatedValue(1.23456789, 10)).toBe('1.234568');
      expect(formatCalculatedValue(1.5, -3)).toBe('2');
    });
  });
});
