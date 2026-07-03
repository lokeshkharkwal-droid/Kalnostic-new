/**
 * Token resolver for the Advance PDF Template engine.
 *
 * Tokens look like `{patient.full_name}` or `{tests[0].name}` — a path
 * into the data context. Inside a `repeat` block the iteration variable
 * shadows the outer scope (e.g. `as: 'item'` makes `{item.name}`
 * resolve against the current array element).
 *
 * Kept deliberately narrow: dot-paths, array-index segments, and the
 * literal value when no braces are present. We don't ship a full
 * expression language until a template needs one.
 */
/* Token comparison stringifies resolved values (typed `unknown`, primitive at
 * runtime) — `no-base-to-string` fires on those `String(...)` calls; disabled
 * file-wide as it's the intended behaviour. */
/* eslint-disable @typescript-eslint/no-base-to-string */

export type Scope = Record<string, unknown>;

export interface ResolverCtx {
  /** Root data bag (the AdvanceContext). */
  root: Scope;
  /** Stack of loop scopes — innermost wins. */
  loops: Scope[];
}

/**
 * Resolve a token expression to a string.
 *
 *   - `'literal'`            → returned as-is
 *   - `'{patient.full_name}'` → ctx.root.patient.full_name
 *   - `'{tests[0].name}'`     → ctx.root.tests[0].name
 *   - `'{item.value}'` (in a repeat with `as: 'item'`) → ctx.loops[-1].item.value
 *
 * Falsy / undefined values resolve to ''. Unknown paths log nothing
 * (matches legacy `strtr` silent-substitution behaviour).
 */
export function resolveToken(expr: string, ctx: ResolverCtx): string {
  if (expr == null) return '';
  // Plain non-{} string — return as-is so block props can hold mixed
  // literal text (e.g. "Order #{order.display_id}").
  if (!expr.includes('{')) return String(expr);

  return expr.replace(/\{([^}]+)\}/g, (_match, path: string) => {
    const v = readPath(path.trim(), ctx);
    if (v == null) return '';
    if (
      typeof v === 'string' ||
      typeof v === 'number' ||
      typeof v === 'boolean'
    )
      return String(v);
    try {
      return JSON.stringify(v);
    } catch {
      return '';
    }
  });
}

/** Resolve a token whose value should stay typed (used by range-bar etc). */
export function resolveValue(
  expr: string | number | undefined,
  ctx: ResolverCtx,
): unknown {
  if (expr == null) return undefined;
  if (typeof expr === 'number') return expr;
  if (typeof expr !== 'string') return expr;
  if (!expr.includes('{')) return expr;
  // Whole-string token — return the raw value (e.g. number stays number).
  const m = /^\{([^}]+)\}$/.exec(expr.trim());
  if (m) return readPath((m[1] ?? '').trim(), ctx);
  // Mixed — resolve as string.
  return resolveToken(expr, ctx);
}

/** Resolve a token expected to point at an array (for `repeat` / `parameters-table`). */
export function resolveArray(expr: string, ctx: ResolverCtx): unknown[] {
  const v = resolveValue(expr, ctx);
  if (Array.isArray(v)) return v;
  return [];
}

/**
 * Evaluate the narrow expression DSL used by `conditional` blocks.
 *
 * Grammar (left-associative, no parens — keep it simple):
 *
 *   expression  ::= or
 *   or          ::= and ('||' and)*
 *   and         ::= atom ('&&' atom)*
 *   atom        ::= '!' atom | comparison
 *   comparison  ::= operand (binop operand)?
 *   binop       ::= '==' | '!=' | '<=' | '>=' | '<' | '>'
 *   operand     ::= '{' path '}' | quoted-literal | bare-literal
 *
 * Truthy fallback: a bare operand with no comparator resolves to its
 * value; the result is `false` for empty / `'0'` / `'false'` / null /
 * undefined / 0 / `false`, and `true` otherwise.
 *
 * Numeric vs lexical: when both sides parse to a finite number they
 * compare numerically; otherwise the comparison is on stringified
 * values. Mixed cases (e.g. `{count} > 0` where `{count} = "10"`)
 * therefore behave as expected without callers having to coerce.
 */
export function evalCondition(expr: string, ctx: ResolverCtx): boolean {
  return evalOr((expr ?? '').trim(), ctx);
}

function evalOr(s: string, ctx: ResolverCtx): boolean {
  const parts = splitTopLevel(s, '||');
  if (parts.length > 1) return parts.some((p) => evalAnd(p.trim(), ctx));
  return evalAnd(s, ctx);
}

function evalAnd(s: string, ctx: ResolverCtx): boolean {
  const parts = splitTopLevel(s, '&&');
  if (parts.length > 1) return parts.every((p) => evalAtom(p.trim(), ctx));
  return evalAtom(s, ctx);
}

function evalAtom(s: string, ctx: ResolverCtx): boolean {
  if (!s) return false;
  // `!` is unary negation — but `!=` is a comparison operator. Only
  // strip the leading `!` when it isn't immediately followed by `=`.
  if (s.startsWith('!') && s[1] !== '=')
    return !evalAtom(s.slice(1).trim(), ctx);

  // Try comparison operators in length-descending order so we match
  // `<=` before `<`, `>=` before `>`, etc.
  for (const op of ['==', '!=', '<=', '>=', '<', '>'] as const) {
    const idx = findTopLevel(s, op);
    if (idx > 0) {
      const left = s.slice(0, idx).trim();
      const right = s.slice(idx + op.length).trim();
      const lv = resolveOperand(left, ctx);
      const rv = resolveOperand(right, ctx);
      return compare(lv, rv, op);
    }
  }

  // No comparator → truthy check on the resolved value.
  const v = resolveValue(s, ctx);
  if (v == null || v === false || v === 0) return false;
  if (typeof v === 'string') return v !== '' && v !== '0' && v !== 'false';
  if (Array.isArray(v)) return v.length > 0;
  return !!v;
}

/** Resolve a comparison operand. `{token}` resolves; quoted literals
 *  unquote; bare literals stay strings. */
function resolveOperand(raw: string, ctx: ResolverCtx): unknown {
  const s = raw.trim();
  if (!s) return '';
  if (/^\{[^}]+\}$/.test(s)) return resolveValue(s, ctx);
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}

function compare(
  l: unknown,
  r: unknown,
  op: '==' | '!=' | '<=' | '>=' | '<' | '>',
): boolean {
  // Numeric path when both sides have a finite numeric reading. Empty
  // string isn't a number — `Number('')` is 0, so guard against it.
  const ls = l == null ? '' : String(l);
  const rs = r == null ? '' : String(r);
  const ln = ls === '' ? NaN : Number(ls);
  const rn = rs === '' ? NaN : Number(rs);
  const numeric = Number.isFinite(ln) && Number.isFinite(rn);
  switch (op) {
    case '==':
      return numeric ? ln === rn : ls === rs;
    case '!=':
      return numeric ? ln !== rn : ls !== rs;
    case '<':
      return numeric ? ln < rn : ls < rs;
    case '<=':
      return numeric ? ln <= rn : ls <= rs;
    case '>':
      return numeric ? ln > rn : ls > rs;
    case '>=':
      return numeric ? ln >= rn : ls >= rs;
  }
}

/** Split `s` on `sep` only at the top level (outside `{...}` / quotes). */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let buf = '',
    depth = 0,
    q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      buf += c;
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      buf += c;
      continue;
    }
    if (c === '{') {
      depth++;
      buf += c;
      continue;
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1);
      buf += c;
      continue;
    }
    if (depth === 0 && s.startsWith(sep, i)) {
      out.push(buf);
      buf = '';
      i += sep.length - 1;
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

/** Find the first top-level occurrence of `op` in `s`, with operator
 *  boundary checks so `<` doesn't match the `<` inside `<=`. */
function findTopLevel(s: string, op: string): number {
  let depth = 0,
    q: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") {
      q = c;
      continue;
    }
    if (c === '{') {
      depth++;
      continue;
    }
    if (c === '}') {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    if (!s.startsWith(op, i)) continue;
    // Boundary checks — reject when the candidate is a prefix/suffix of
    // a longer operator we should match elsewhere.
    if (op === '<' && (s[i + 1] === '=' || s[i + 1] === '<')) continue;
    if (op === '>' && (s[i + 1] === '=' || s[i + 1] === '>')) continue;
    if ((op === '==' || op === '!=') && s[i + 2] === '=') continue;
    return i;
  }
  return -1;
}

// ─── Internals ──────────────────────────────────────────────────────────

function readPath(path: string, ctx: ResolverCtx): unknown {
  // Try innermost loop scope first, then root.
  for (let i = ctx.loops.length - 1; i >= 0; i--) {
    const scope = ctx.loops[i];
    if (scope === undefined) continue;
    const v = readFromScope(path, scope);
    if (v !== undefined) return v;
  }
  return readFromScope(path, ctx.root);
}

function readFromScope(path: string, scope: Scope): unknown {
  // Tokenise dotted path with array index support: `tests[0].results[1].name`.
  const parts: Array<string | number> = [];
  let cur = '';
  for (let i = 0; i < path.length; i++) {
    const ch = path[i];
    if (ch === '.') {
      if (cur) {
        parts.push(cur);
        cur = '';
      }
    } else if (ch === '[') {
      if (cur) {
        parts.push(cur);
        cur = '';
      }
      const close = path.indexOf(']', i);
      if (close === -1) return undefined;
      const idx = Number(path.slice(i + 1, close));
      parts.push(Number.isFinite(idx) ? idx : path.slice(i + 1, close));
      i = close;
    } else {
      cur += ch;
    }
  }
  if (cur) parts.push(cur);

  let node: unknown = scope;
  for (const p of parts) {
    if (node == null) return undefined;
    if (typeof p === 'number') {
      if (!Array.isArray(node)) return undefined;
      node = node[p];
    } else {
      node = (node as Record<string, unknown>)[p];
    }
  }
  return node;
}
