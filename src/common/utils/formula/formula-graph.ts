import { extractRefs, isValidFormulaSyntax } from './formula-evaluator';
import { FormulaParam, FormulaSetValidation } from './formula.types';

/**
 * Dependency-graph helpers for a test's calculated parameters. Edges point from
 * a calculated parameter to the *calculated* parameters it references (measured
 * references are leaves and never appear in the ordering). A topological sort
 * gives a safe evaluation order (dependencies first) and detects cycles.
 */

/**
 * Compute the order in which a test's calculated parameters must be evaluated so
 * that every dependency is computed before the parameter that uses it. Only
 * codes of calculated parameters appear in the result.
 *
 * @param params every result parameter of the test.
 * @returns `{ ok: true, order }` with calculated codes in dependency order, or
 *   `{ ok: false, cycle }` naming the codes that form a dependency cycle.
 */
export function buildEvaluationOrder(
  params: FormulaParam[],
): { ok: true; order: string[] } | { ok: false; cycle: string[] } {
  const calc = new Map<string, string[]>(); // code → calculated refs it depends on
  for (const p of params) {
    if (!p.isCalculated || !p.formula) continue;
    calc.set(p.code, []);
  }
  for (const p of params) {
    if (!p.isCalculated || !p.formula) continue;
    const refs = extractRefs(p.formula).filter(
      (r) => calc.has(r) && r !== p.code,
    );
    calc.set(p.code, refs);
  }

  const order: string[] = [];
  const state = new Map<string, 0 | 1 | 2>(); // 0=unvisited 1=visiting 2=done
  const stack: string[] = [];

  const visit = (code: string): string[] | null => {
    const s = state.get(code) ?? 0;
    if (s === 2) return null;
    if (s === 1) {
      // Back-edge → cycle. Slice the current stack from the first occurrence.
      const start = stack.indexOf(code);
      return stack.slice(start).concat(code);
    }
    state.set(code, 1);
    stack.push(code);
    for (const dep of calc.get(code) ?? []) {
      const cycle = visit(dep);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(code, 2);
    order.push(code);
    return null;
  };

  for (const code of calc.keys()) {
    const cycle = visit(code);
    if (cycle) return { ok: false, cycle };
  }
  return { ok: true, order };
}

/**
 * Validate every calculated formula in a test's parameter set: syntax, that each
 * referenced code exists and is not the parameter itself, and that there is no
 * dependency cycle. On success returns the evaluation order.
 *
 * @param params every result parameter of the test.
 * @returns a discriminated result the caller maps to a typed exception.
 */
export function validateFormulaSet(
  params: FormulaParam[],
): FormulaSetValidation {
  const knownCodes = new Set(params.map((p) => p.code));
  for (const p of params) {
    if (!p.isCalculated || !p.formula || !p.formula.trim()) continue;
    if (!isValidFormulaSyntax(p.formula)) {
      return { ok: false, kind: 'SYNTAX', code: p.code };
    }
    for (const ref of extractRefs(p.formula)) {
      if (ref === p.code) return { ok: false, kind: 'SELF_REF', code: p.code };
      if (!knownCodes.has(ref))
        return { ok: false, kind: 'UNKNOWN_REF', code: p.code, ref };
    }
  }
  const built = buildEvaluationOrder(params);
  if (!built.ok) return { ok: false, kind: 'CYCLE', cycle: built.cycle };
  return { ok: true, order: built.order };
}
