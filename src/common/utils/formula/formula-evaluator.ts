import { FormulaEvalResult, MAX_FORMULA_LENGTH } from './formula.types';

/**
 * Tokenizer + recursive-descent parser + evaluator for calculated-parameter
 * formulas. Grammar (standard arithmetic precedence, left-associative):
 *
 *   expr    := term   (('+' | '-') term)*
 *   term    := factor (('*' | '/') factor)*
 *   factor  := ('-' | '+') factor | primary
 *   primary := number | ident | '(' expr ')'
 *
 * Identifiers are parameter codes (`[A-Za-z0-9_]+` containing at least one
 * non-digit); a run that is all digits (optionally with a decimal part) is a
 * numeric literal. Everything is pure — no `eval`/`Function`.
 */

type TokenType = 'number' | 'ident' | 'op' | 'lparen' | 'rparen';
interface Token {
  type: TokenType;
  value: string;
}

const IDENT_OR_DIGIT = /[A-Za-z0-9_]/;
const ALL_DIGITS = /^[0-9]+$/;

/**
 * Split a formula string into tokens.
 * @param input the raw formula text.
 * @returns the token list, or `null` if an illegal character is encountered.
 */
export function tokenize(input: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  const n = input.length;
  while (i < n) {
    const ch = input[i]!;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch });
      i++;
      continue;
    }
    if (IDENT_OR_DIGIT.test(ch)) {
      let j = i;
      while (j < n && IDENT_OR_DIGIT.test(input[j]!)) j++;
      let run = input.slice(i, j);
      if (ALL_DIGITS.test(run)) {
        // Numeric literal — extend into a decimal part when present.
        if (
          j < n &&
          input[j] === '.' &&
          j + 1 < n &&
          ALL_DIGITS.test(input[j + 1]!)
        ) {
          let k = j + 1;
          while (k < n && ALL_DIGITS.test(input[k]!)) k++;
          run = input.slice(i, k);
          j = k;
        }
        tokens.push({ type: 'number', value: run });
      } else {
        tokens.push({ type: 'ident', value: run });
      }
      i = j;
      continue;
    }
    // Any other character (including a bare '.') is illegal.
    return null;
  }
  return tokens;
}

// ── AST ──────────────────────────────────────────────────────────────────────
type Node =
  | { kind: 'num'; value: number }
  | { kind: 'ref'; name: string }
  | { kind: 'unary'; op: '+' | '-'; operand: Node }
  | { kind: 'binary'; op: '+' | '-' | '*' | '/'; left: Node; right: Node };

/**
 * Parse a token list into an AST.
 * @param tokens the token list from {@link tokenize}.
 * @returns the root node, or `null` on a syntax error (unexpected/leftover tokens).
 */
function parse(tokens: Token[]): Node | null {
  let pos = 0;
  const peek = (): Token | undefined => tokens[pos];

  function parseExpr(): Node | null {
    let left = parseTerm();
    if (!left) return null;
    while (
      peek() &&
      peek()!.type === 'op' &&
      (peek()!.value === '+' || peek()!.value === '-')
    ) {
      const op = tokens[pos++]!.value as '+' | '-';
      const right = parseTerm();
      if (!right) return null;
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseTerm(): Node | null {
    let left = parseFactor();
    if (!left) return null;
    while (
      peek() &&
      peek()!.type === 'op' &&
      (peek()!.value === '*' || peek()!.value === '/')
    ) {
      const op = tokens[pos++]!.value as '*' | '/';
      const right = parseFactor();
      if (!right) return null;
      left = { kind: 'binary', op, left, right };
    }
    return left;
  }

  function parseFactor(): Node | null {
    const t = peek();
    if (t && t.type === 'op' && (t.value === '-' || t.value === '+')) {
      pos++;
      const operand = parseFactor();
      if (!operand) return null;
      return { kind: 'unary', op: t.value, operand };
    }
    return parsePrimary();
  }

  function parsePrimary(): Node | null {
    const t = peek();
    if (!t) return null;
    if (t.type === 'number') {
      pos++;
      return { kind: 'num', value: Number(t.value) };
    }
    if (t.type === 'ident') {
      pos++;
      return { kind: 'ref', name: t.value };
    }
    if (t.type === 'lparen') {
      pos++;
      const inner = parseExpr();
      if (!inner) return null;
      if (!peek() || peek()!.type !== 'rparen') return null;
      pos++;
      return inner;
    }
    return null;
  }

  const root = parseExpr();
  if (!root) return null;
  if (pos !== tokens.length) return null; // leftover tokens → syntax error
  return root;
}

/** Parse a formula string into an AST, or `null` if it is syntactically invalid. */
function parseFormula(input: string): Node | null {
  if (typeof input !== 'string') return null;
  if (input.length > MAX_FORMULA_LENGTH) return null;
  const tokens = tokenize(input);
  if (!tokens || tokens.length === 0) return null;
  return parse(tokens);
}

/**
 * Whether a formula string is syntactically valid (tokenizes and parses).
 * @param input the formula text.
 * @returns true when the expression is well-formed.
 */
export function isValidFormulaSyntax(input: string): boolean {
  return parseFormula(input) !== null;
}

/**
 * Collect the distinct parameter-code identifiers referenced by a formula, in
 * first-seen order. Returns `[]` when the formula is empty or does not tokenize.
 * @param input the formula text.
 * @returns the referenced codes (deduped).
 */
export function extractRefs(input: string): string[] {
  if (typeof input !== 'string' || input.length > MAX_FORMULA_LENGTH) return [];
  const tokens = tokenize(input);
  if (!tokens) return [];
  const seen = new Set<string>();
  for (const t of tokens) if (t.type === 'ident') seen.add(t.value);
  return [...seen];
}

/**
 * Format a computed numeric value for storage/display using the parameter's
 * configured decimal places. Kept here (shared by backend and frontend) so an
 * auto-computed value is formatted identically wherever it is shown.
 * @param value the computed number.
 * @param decimalPlaces decimals to render (clamped to 0–6; defaults to 2).
 * @returns the fixed-decimal string (e.g. `80` → "80.00" at 2 places).
 */
export function formatCalculatedValue(
  value: number,
  decimalPlaces?: number | null,
): string {
  const dp = Math.min(6, Math.max(0, decimalPlaces ?? 2));
  return value.toFixed(dp);
}

/** Recursively evaluate an AST against a value map, short-circuiting on error. */
function evalNode(
  node: Node,
  values: Record<string, number | null | undefined>,
): FormulaEvalResult {
  switch (node.kind) {
    case 'num':
      return { ok: true, value: node.value };
    case 'ref': {
      if (!(node.name in values))
        return { ok: false, error: 'UNKNOWN_REF', ref: node.name };
      const v = values[node.name];
      if (v === null || v === undefined)
        return { ok: false, error: 'MISSING_INPUT', ref: node.name };
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return { ok: false, error: 'NON_NUMERIC', ref: node.name };
      }
      return { ok: true, value: v };
    }
    case 'unary': {
      const inner = evalNode(node.operand, values);
      if (!inner.ok) return inner;
      return { ok: true, value: node.op === '-' ? -inner.value : inner.value };
    }
    case 'binary': {
      const left = evalNode(node.left, values);
      if (!left.ok) return left;
      const right = evalNode(node.right, values);
      if (!right.ok) return right;
      let out: number;
      switch (node.op) {
        case '+':
          out = left.value + right.value;
          break;
        case '-':
          out = left.value - right.value;
          break;
        case '*':
          out = left.value * right.value;
          break;
        case '/':
          if (right.value === 0) return { ok: false, error: 'DIV_ZERO' };
          out = left.value / right.value;
          break;
      }
      if (!Number.isFinite(out)) return { ok: false, error: 'DIV_ZERO' };
      return { ok: true, value: out };
    }
  }
}

/**
 * Evaluate a calculated-parameter formula against a map of the test's current
 * parameter values (code → number, or null/undefined when a value is not yet
 * entered).
 *
 * @param input the formula text (e.g. `(P1 - P2) / P3`).
 * @param values map of parameter code → numeric value (or null when blank).
 * @returns `{ ok: true, value }`, or `{ ok: false, error }` describing why the
 *   value cannot be computed (invalid syntax, unknown/missing/non-numeric
 *   reference, or division by zero). Never throws.
 */
export function evaluateFormula(
  input: string,
  values: Record<string, number | null | undefined>,
): FormulaEvalResult {
  const ast = parseFormula(input);
  if (!ast) return { ok: false, error: 'INVALID_SYNTAX' };
  return evalNode(ast, values);
}
