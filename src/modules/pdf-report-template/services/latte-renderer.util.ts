// ─────────────────────────────────────────────────────────────────────────────
// Minimal Latte-subset template renderer (ported from the legacy kishan app and
// extended for the "Lab All Reports" print templates).
// ─────────────────────────────────────────────────────────────────────────────
//
// The lab-report print templates authored for the legacy Yii/PHP app use a
// small subset of Latte syntax. This renderer handles *only* that subset; it is
// intentionally forgiving — malformed sub-expressions and unknown tags are
// emitted as literal text rather than throwing, so a single bad token cannot
// break a whole report render.
//
// Grammar supported (informal):
//
//   template   := (text | tag)*
//   tag        := "{" (plain-token | latte-tag | comment) "}"
//
//   comment       := "* … *"                       (stripped, renders empty)
//   plain-token   := bare identifier               → data[name]; PAGENO/nb →
//                                                    Puppeteer page-number spans
//   latte-tag     :=
//       "$" expr ("|" filter)*                      (variable output; HTML-escaped
//                                                    unless |noescape is set;
//                                                    |upper/|lower transform)
//     | "if" <cond> | "elseif" <cond> | "else" | "/if"   (conditional block)
//     | "foreach" $arr "as" [$k "=>"] $v | "/foreach"
//     | "for" init ";" cond ";" incr | "/for"       (C-style counted loop)
//     | "var" $name "=" expr                        (assign to current scope)
//     | "define" name ("," $param)* … "/define"     (named block w/ params)
//     | "include" name ("," argExpr)*               (render a named block)
//
// Expression surface (see `ExprParser`):
//
//   atom     := string | number | true|false|null | "$"path (with .prop / ->prop
//               / [index]) | identifier | func"(" args ")" | "[" arrayLiteral "]"
//               | "(" expr ")"
//   unary    := ("!" | "-") unary | atom
//   mul      := unary (("*"|"/"|"%") unary)*
//   add      := mul (("+"|"-"|".") mul)*     ("+","-" numeric; "." string concat)
//   cmp      := add (("=="|"!="|"<="|">="|"<"|">") add)?
//   and      := cmp ("&&" cmp)*
//   or       := and ("||" and)*
//   coalesce := or ("??" or)*                 (null-coalescing)
//   ternary  := coalesce ("?" ternary ":" ternary)?
//   expr     := ternary
//
// Beyond the legacy renderer this supports: `elseif`, `{for}`, `* / %`, ternary
// `?:`, null-coalescing `??`, array literals `[…]`/`['k' => v]` + index access
// `$a[k]`, and a curated set of safe function calls (see `FUNCTIONS`). Function
// calls are deliberately whitelisted — arbitrary calls are NOT possible, since
// templates are tenant-authored data.
//
// Scope rules:
//   A stack of frames. `{foreach}` and `{var}` mutate the top frame; reads walk
//   the stack top→bottom and fall back to the root `data` object. Object reads
//   use `->` (Latte) but also tolerate `.`. A `{define}` block renders against
//   `[rootData, paramFrame]` so it sees globals plus its bound parameters.

import { toText } from './pdf-document.util';

type Scope = Record<string, unknown>;

/** A named `{define}` block: its declared parameter names and parsed body. */
interface DefineBlock {
  params: string[];
  body: Node[];
}

/** Render context threaded through the tree: the collected `{define}` blocks. */
interface RenderCtx {
  defines: Map<string, DefineBlock>;
}

// {PAGENO} / {nb} are mPDF page-number tokens. Puppeteer computes page numbers
// itself and only fills them into elements carrying its special classes rendered
// inside the header/footer margin templates, so we map these tokens to those
// spans (mirroring the advance/block renderer). In the body they stay empty —
// Chromium substitutes the counts only within the header/footer bands.
const PAGE_NUMBER_TOKENS: Record<string, string> = {
  PAGENO: '<span class="pageNumber"></span>',
  nb: '<span class="totalPages"></span>',
};

// ─── Public entry point ──────────────────────────────────────────────────────

/**
 * Render a Latte-subset template against `data`. Variable output is HTML-escaped
 * unless `|noescape` is applied; plain `{token}` placeholders are substituted
 * without extra escaping. Never throws — on any unexpected error the raw source
 * is returned so the caller still sees *something* rather than an empty PDF.
 */
export function renderLatte(
  source: string,
  data: Record<string, unknown>,
): string {
  try {
    const { nodes, defines } = parse(source);
    return render(nodes, [data], { defines });
  } catch {
    return source;
  }
}

// ─── Tokeniser ───────────────────────────────────────────────────────────────

type RawToken =
  | { kind: 'text'; value: string }
  | { kind: 'tag'; value: string };

function tokenise(source: string): RawToken[] {
  const out: RawToken[] = [];
  let buf = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '{') {
      const end = source.indexOf('}', i + 1);
      if (end < 0) {
        buf += source.slice(i);
        break;
      }
      const inner = source.slice(i + 1, end);
      if (buf) {
        out.push({ kind: 'text', value: buf });
        buf = '';
      }
      out.push({ kind: 'tag', value: inner });
      i = end + 1;
    } else {
      buf += ch;
      i++;
    }
  }
  if (buf) out.push({ kind: 'text', value: buf });
  return out;
}

// ─── Parser ──────────────────────────────────────────────────────────────────

type Node =
  | { type: 'text'; value: string }
  | { type: 'out'; expr: string; filters: string[] }
  | { type: 'token'; name: string }
  | { type: 'if'; cond: string; then: Node[]; else: Node[] }
  | {
      type: 'foreach';
      arrExpr: string;
      keyVar: string | null;
      valVar: string;
      body: Node[];
    }
  | {
      type: 'for';
      init: { name: string; expr: string } | null;
      cond: string;
      incr: { name: string; expr: string } | null;
      body: Node[];
    }
  | { type: 'var'; name: string; expr: string }
  | { type: 'include'; name: string; args: string[] };

/** The `if` node variant — built as a chain (each `elseif` nests in `else`). */
type IfNode = Extract<Node, { type: 'if' }>;

function parse(source: string): {
  nodes: Node[];
  defines: Map<string, DefineBlock>;
} {
  const tokens = tokenise(source);
  const defines = new Map<string, DefineBlock>();
  let i = 0;

  function parseBlock(stopTags: string[]): {
    nodes: Node[];
    stopped: string | null;
  } {
    const nodes: Node[] = [];
    while (i < tokens.length) {
      const tok = tokens[i];
      if (!tok) break;
      if (tok.kind === 'text') {
        nodes.push({ type: 'text', value: tok.value });
        i++;
        continue;
      }
      const trimmed = tok.value.trim();
      const head = firstWord(trimmed);
      if (stopTags.includes(trimmed) || stopTags.includes(head)) {
        return { nodes, stopped: trimmed };
      }
      i++;

      // Latte comment `{* … *}` — stripped.
      if (trimmed.startsWith('*')) continue;

      if (trimmed.startsWith('$')) {
        const { expr, filters } = splitFilters(trimmed);
        nodes.push({ type: 'out', expr, filters });
        continue;
      }
      if (head === 'if') {
        // Build an if / elseif* / else chain. Each `{elseif}` becomes a nested
        // `if` in the previous branch's `else`, so the renderer's plain if-node
        // handles the whole chain with no extra node type.
        const rootThen = parseBlock(['elseif', 'else', '/if']);
        const rootNode: IfNode = {
          type: 'if',
          cond: trimmed.slice(2).trim(),
          then: rootThen.nodes,
          else: [],
        };
        let current = rootNode;
        let stopped = rootThen.stopped;
        while (stopped !== null && firstWord(stopped) === 'elseif') {
          i++; // consume the {elseif …} token
          const branch = parseBlock(['elseif', 'else', '/if']);
          const elifNode: IfNode = {
            type: 'if',
            cond: stopped.slice(6).trim(),
            then: branch.nodes,
            else: [],
          };
          current.else = [elifNode];
          current = elifNode;
          stopped = branch.stopped;
        }
        if (stopped !== null && firstWord(stopped) === 'else') {
          i++; // consume {else}
          const elseParsed = parseBlock(['/if']);
          current.else = elseParsed.nodes;
          if (elseParsed.stopped === '/if') i++; // consume {/if}
        } else if (stopped === '/if') {
          i++; // consume {/if}
        }
        nodes.push(rootNode);
        continue;
      }
      if (head === 'foreach') {
        const parsed = parseForeachHeader(trimmed.slice(7).trim());
        if (!parsed) {
          nodes.push({ type: 'text', value: `{${tok.value}}` });
          continue;
        }
        const body = parseBlock(['/foreach']);
        if (body.stopped === '/foreach') i++; // consume {/foreach}
        nodes.push({
          type: 'foreach',
          arrExpr: parsed.arrExpr,
          keyVar: parsed.keyVar,
          valVar: parsed.valVar,
          body: body.nodes,
        });
        continue;
      }
      if (head === 'for') {
        const parsed = parseForHeader(trimmed.slice(3).trim());
        if (!parsed) {
          nodes.push({ type: 'text', value: `{${tok.value}}` });
          continue;
        }
        const body = parseBlock(['/for']);
        if (body.stopped !== null && firstWord(body.stopped) === '/for') i++;
        nodes.push({
          type: 'for',
          init: parsed.init,
          cond: parsed.cond,
          incr: parsed.incr,
          body: body.nodes,
        });
        continue;
      }
      if (head === 'var') {
        const rest = trimmed.slice(3).trim();
        const m = /^\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(rest);
        if (m && m[1] && m[2]) {
          nodes.push({ type: 'var', name: m[1], expr: m[2].trim() });
        } else {
          nodes.push({ type: 'text', value: `{${tok.value}}` });
        }
        continue;
      }
      if (head === 'define') {
        // `define <name>, $p1, $p2, …` — parse the header, collect the body up
        // to {/define}, register it, and emit nothing where it was declared.
        const parts = splitTopLevelCommas(trimmed.slice(6).trim());
        const name = (parts.shift() ?? '').trim();
        const params = parts
          .map((p) => p.trim().replace(/^\$/, ''))
          .filter((p) => p.length > 0);
        const body = parseBlock(['/define']);
        if (body.stopped === '/define') i++; // consume {/define}
        if (name) defines.set(name, { params, body: body.nodes });
        continue;
      }
      if (head === 'include') {
        const parts = splitTopLevelCommas(trimmed.slice(7).trim());
        const name = (parts.shift() ?? '').trim();
        const args = parts.map((p) => p.trim());
        nodes.push({ type: 'include', name, args });
        continue;
      }
      // A lone identifier is a legacy bare token (unescaped data lookup).
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        nodes.push({ type: 'token', name: trimmed });
        continue;
      }
      // Otherwise, if it reads as an expression, output it (escaped unless
      // |noescape). Covers {2 + 3}, {count($x)}, {$a ? b : c}, {[1,2]}, etc.
      const { expr, filters } = splitFilters(trimmed);
      if (looksLikeExpression(expr)) {
        nodes.push({ type: 'out', expr, filters });
        continue;
      }
      // Opaque tag (e.g. stray CSS braces) — keep it literal.
      nodes.push({ type: 'text', value: `{${tok.value}}` });
    }
    return { nodes, stopped: null };
  }

  const nodes = parseBlock([]).nodes;
  return { nodes, defines };
}

function firstWord(s: string): string {
  const m = /^[/A-Za-z_][A-Za-z0-9_]*/.exec(s);
  return m ? m[0] : '';
}

/**
 * Split `expr|filter|filter` into the expression and its filters. Splits only on
 * a top-level single `|` — the logical-or operator `||`, and any `|` inside
 * string literals or `(...)`/`[...]`, are preserved as part of the expression.
 */
function splitFilters(s: string): { expr: string; filters: string[] } {
  const parts: string[] = [];
  let buf = '';
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] ?? '';
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === '(' || ch === '[') {
      depth++;
      buf += ch;
    } else if (ch === ')' || ch === ']') {
      depth--;
      buf += ch;
    } else if (ch === '|' && depth === 0) {
      if (s[i + 1] === '|') {
        buf += '||'; // logical-or operator, not a filter boundary
        i++;
      } else {
        parts.push(buf);
        buf = '';
      }
    } else {
      buf += ch;
    }
  }
  parts.push(buf);
  return {
    expr: (parts[0] ?? '').trim(),
    filters: parts
      .slice(1)
      .map((p) => p.trim())
      .filter((p) => p.length > 0),
  };
}

/**
 * Heuristic: does this tag body (its expression part, filters already stripped)
 * look like an expression to output — vs an opaque tag we should leave literal
 * (e.g. stray CSS braces)? Covers `$…`, numbers, `(`/`[`/quote/`!` leads, unary
 * minus, `name(` function calls, and the `true`/`false`/`null` literals. A lone
 * identifier is handled earlier as a legacy bare token, so it never reaches here.
 */
function looksLikeExpression(expr: string): boolean {
  if (expr === '') return false;
  const c = expr[0] ?? '';
  if ('$([\'"!'.includes(c)) return true;
  if (/[0-9]/.test(c)) return true;
  if (c === '-' && /[0-9$(]/.test(expr[1] ?? '')) return true;
  if (/^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(expr)) return true; // function call
  if (/^(true|false|null)\b/.test(expr)) return true;
  return false;
}

/**
 * Split a `define`/`include` argument list on top-level commas only — commas
 * inside quoted string literals are preserved (e.g. `name, $a, ', '`).
 */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ',') {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0 || out.length > 0) out.push(buf);
  return out;
}

function parseForeachHeader(
  s: string,
): { arrExpr: string; keyVar: string | null; valVar: string } | null {
  const m =
    /^(.+?)\s+as\s+\$([A-Za-z_][A-Za-z0-9_]*)(?:\s*=>\s*\$([A-Za-z_][A-Za-z0-9_]*))?\s*$/.exec(
      s,
    );
  if (!m || !m[1] || !m[2]) return null;
  const arrExpr = m[1].trim();
  if (m[3]) return { arrExpr, keyVar: m[2], valVar: m[3] };
  return { arrExpr, keyVar: null, valVar: m[2] };
}

/** Split on top-level `;` only (respecting quoted string literals). */
function splitTopLevelSemis(s: string): string[] {
  const out: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      buf += ch;
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === ';') {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  out.push(buf);
  return out;
}

/**
 * Parse one `{for}` clause into an assignment. Handles `$i = expr`, `$i++`, and
 * `$i--`; an empty clause returns `null` (no-op init/increment).
 */
function parseAssignPart(s: string): { name: string; expr: string } | null {
  const t = s.trim();
  if (t === '') return null;
  const inc = /^\$([A-Za-z_][A-Za-z0-9_]*)\s*(\+\+|--)$/.exec(t);
  if (inc && inc[1]) {
    return {
      name: inc[1],
      expr: `$${inc[1]} ${inc[2] === '++' ? '+' : '-'} 1`,
    };
  }
  const m = /^\$([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(t);
  if (m && m[1] && m[2]) return { name: m[1], expr: m[2].trim() };
  return null;
}

/**
 * Parse a C-style `for` header `init ; cond ; incr` into its three parts. Returns
 * `null` (→ the tag renders literally) when it doesn't have exactly three
 * `;`-separated clauses. Empty init/incr are allowed; an empty cond means "always
 * true" (bounded by the renderer's iteration safety cap).
 */
function parseForHeader(s: string): {
  init: { name: string; expr: string } | null;
  cond: string;
  incr: { name: string; expr: string } | null;
} | null {
  const parts = splitTopLevelSemis(s);
  if (parts.length !== 3) return null;
  return {
    init: parseAssignPart(parts[0] ?? ''),
    cond: (parts[1] ?? '').trim(),
    incr: parseAssignPart(parts[2] ?? ''),
  };
}

// ─── Renderer ────────────────────────────────────────────────────────────────

function render(nodes: Node[], scopes: Scope[], ctx: RenderCtx): string {
  let out = '';
  for (const n of nodes) out += renderNode(n, scopes, ctx);
  return out;
}

function renderNode(n: Node, scopes: Scope[], ctx: RenderCtx): string {
  switch (n.type) {
    case 'text':
      return n.value;
    case 'token': {
      const pageToken = PAGE_NUMBER_TOKENS[n.name];
      if (pageToken !== undefined) return pageToken;
      return toText(lookupScope(n.name, scopes));
    }
    case 'out': {
      let v: unknown;
      try {
        v = evalExpr(n.expr, scopes);
      } catch {
        return '';
      }
      if (v == null) return '';
      // Apply filters left-to-right. `noescape` is special — it toggles auto-
      // escaping off rather than transforming the value; every other filter
      // transforms the string (unknown ones pass through unchanged).
      let str = toText(v);
      let escape = true;
      for (const filter of n.filters) {
        if (filter === 'noescape') {
          escape = false;
        } else {
          str = applyFilter(filter, str);
        }
      }
      return escape ? escapeHtml(str) : str;
    }
    case 'if': {
      let cond: unknown;
      try {
        cond = evalExpr(n.cond, scopes);
      } catch {
        cond = false;
      }
      return isTruthy(cond)
        ? render(n.then, scopes, ctx)
        : render(n.else, scopes, ctx);
    }
    case 'foreach': {
      let arr: unknown;
      try {
        arr = evalExpr(n.arrExpr, scopes);
      } catch {
        arr = null;
      }
      if (arr == null) return '';
      const frame: Scope = {};
      const newStack = [...scopes, frame];
      let result = '';
      const iterable: Array<[unknown, unknown]> = Array.isArray(arr)
        ? arr.map((v, k) => [k, v])
        : typeof arr === 'object'
          ? Object.entries(arr as Record<string, unknown>)
          : [];
      for (const [k, v] of iterable) {
        if (n.keyVar) frame[n.keyVar] = k;
        frame[n.valVar] = v;
        result += render(n.body, newStack, ctx);
      }
      return result;
    }
    case 'for': {
      // Own frame at the top of the stack holds the loop counter; the init and
      // increment assignments walk the stack (via assignVar) so a counter reused
      // from an outer scope updates in place.
      const frame: Scope = {};
      const stack = [...scopes, frame];
      if (n.init) {
        try {
          frame[n.init.name] = evalExpr(n.init.expr, stack);
        } catch {
          frame[n.init.name] = undefined;
        }
      }
      let result = '';
      let guard = 0;
      const MAX_ITERATIONS = 100_000; // safety net against a non-terminating cond
      for (;;) {
        let keepGoing: boolean;
        if (n.cond === '') {
          keepGoing = true;
        } else {
          try {
            keepGoing = isTruthy(evalExpr(n.cond, stack));
          } catch {
            keepGoing = false;
          }
        }
        if (!keepGoing) break;
        result += render(n.body, stack, ctx);
        if (n.incr) {
          let v: unknown;
          try {
            v = evalExpr(n.incr.expr, stack);
          } catch {
            v = undefined;
          }
          assignVar(stack, n.incr.name, v);
        }
        if (++guard >= MAX_ITERATIONS) break;
      }
      return result;
    }
    case 'var': {
      let v: unknown;
      try {
        v = evalExpr(n.expr, scopes);
      } catch {
        v = undefined;
      }
      assignVar(scopes, n.name, v);
      return '';
    }
    case 'include': {
      const block = ctx.defines.get(n.name);
      if (!block) return '';
      const frame: Scope = {};
      block.params.forEach((param, idx) => {
        const argExpr = n.args[idx];
        let value: unknown = undefined;
        if (argExpr !== undefined && argExpr !== '') {
          try {
            value = evalExpr(argExpr, scopes);
          } catch {
            value = undefined;
          }
        }
        frame[param] = value;
      });
      // Blocks see the global data scope plus their bound parameters.
      const rootData = scopes[0] ?? {};
      return render(block.body, [rootData, frame], ctx);
    }
  }
}

// ─── Scope lookup + HTML escape ──────────────────────────────────────────────

function lookupScope(name: string, scopes: Scope[]): unknown {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const frame = scopes[i];
    if (frame && Object.prototype.hasOwnProperty.call(frame, name))
      return frame[name];
  }
  return undefined;
}

/**
 * Assign `value` to `name`, updating the nearest existing frame that already
 * declares it (so a counter mutates in place) and otherwise declaring it in the
 * top frame. Shared by `{var}` and `{for}` increments.
 */
function assignVar(scopes: Scope[], name: string, value: unknown): void {
  if (scopes.length === 0) scopes.push({});
  for (let i = scopes.length - 1; i >= 0; i--) {
    const frame = scopes[i];
    if (frame && Object.prototype.hasOwnProperty.call(frame, name)) {
      frame[name] = value;
      return;
    }
  }
  const top = scopes[scopes.length - 1];
  if (top) top[name] = value;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&'
      ? '&amp;'
      : c === '<'
        ? '&lt;'
        : c === '>'
          ? '&gt;'
          : c === '"'
            ? '&quot;'
            : '&#39;',
  );
}

/**
 * Apply a value-transforming Latte filter by name. Only the filters the ported
 * lab-report templates actually use are implemented; an unknown filter passes the
 * value through unchanged (preserving the previous silent-passthrough behaviour).
 * `noescape` is NOT handled here — it toggles escaping in the caller, not the
 * value. Add new filters to this switch as templates need them.
 */
function applyFilter(name: string, value: string): string {
  switch (name) {
    case 'upper':
      return value.toUpperCase();
    case 'lower':
      return value.toLowerCase();
    default:
      return value;
  }
}

function isTruthy(v: unknown): boolean {
  if (v == null || v === false) return false;
  if (v === '' || v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

// ─── Expression evaluator ────────────────────────────────────────────────────

function evalExpr(src: string, scopes: Scope[]): unknown {
  const parser = new ExprParser(src, scopes);
  const v = parser.parseExpr();
  parser.skipWs();
  return v;
}

/** Coerce to a finite number for arithmetic (`+`/`-`); non-numeric → 0. */
function num(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

class ExprParser {
  private i = 0;
  constructor(
    private readonly src: string,
    private readonly scopes: Scope[],
  ) {}

  skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i] ?? ''))
      this.i++;
  }
  peek(): string {
    return this.src[this.i] ?? '';
  }
  eof(): boolean {
    return this.i >= this.src.length;
  }
  match(s: string): boolean {
    this.skipWs();
    if (this.src.startsWith(s, this.i)) {
      this.i += s.length;
      return true;
    }
    return false;
  }

  /** Lowest-precedence entry: a full expression. */
  parseExpr(): unknown {
    return this.parseTernary();
  }

  /**
   * `cond ? a : b`. Right-associative. NOTE: both branches are evaluated (this is
   * a combined parse+eval), which is safe here because no expression operation
   * throws or has side effects — `??`/guards still short-circuit their VALUE.
   */
  parseTernary(): unknown {
    const cond = this.parseCoalesce();
    if (this.match('?')) {
      const thenV = this.parseTernary();
      this.match(':');
      const elseV = this.parseTernary();
      return isTruthy(cond) ? thenV : elseV;
    }
    return cond;
  }

  /** `a ?? b` — yields `a` unless it is null/undefined, else `b`. */
  parseCoalesce(): unknown {
    let left = this.parseOr();
    while (this.match('??')) {
      const right = this.parseOr();
      if (left === null || left === undefined) left = right;
    }
    return left;
  }

  parseOr(): unknown {
    let left = this.parseAnd();
    while (this.match('||')) {
      const right = this.parseAnd();
      left = isTruthy(left) || isTruthy(right);
    }
    return left;
  }

  parseAnd(): unknown {
    let left = this.parseCmp();
    while (this.match('&&')) {
      const right = this.parseCmp();
      left = isTruthy(left) && isTruthy(right);
    }
    return left;
  }

  parseCmp(): unknown {
    const left = this.parseAdd();
    this.skipWs();
    for (const op of ['==', '!=', '<=', '>=', '<', '>']) {
      if (this.match(op)) {
        const right = this.parseAdd();
        return cmp(op, left, right);
      }
    }
    return left;
  }

  /** `+`/`-` numeric addition, `.` string concatenation. Left-associative. */
  parseAdd(): unknown {
    let left = this.parseMul();
    for (;;) {
      this.skipWs();
      // A `.` immediately followed by a digit could be a decimal — but numbers
      // are parsed whole in parseNumber, so a bare `.` here is concatenation.
      if (this.match('+')) {
        left = num(left) + num(this.parseMul());
      } else if (this.match('-')) {
        left = num(left) - num(this.parseMul());
      } else if (this.match('.')) {
        left = `${toText(left)}${toText(this.parseMul())}`;
      } else {
        break;
      }
    }
    return left;
  }

  /** `*`/`/`/`%`. Division/modulo by zero yields 0 (avoids Infinity/NaN). */
  parseMul(): unknown {
    let left = this.parseUnary();
    for (;;) {
      this.skipWs();
      if (this.match('*')) {
        left = num(left) * num(this.parseUnary());
      } else if (this.match('/')) {
        const r = num(this.parseUnary());
        left = r === 0 ? 0 : num(left) / r;
      } else if (this.match('%')) {
        const r = num(this.parseUnary());
        left = r === 0 ? 0 : num(left) % r;
      } else {
        break;
      }
    }
    return left;
  }

  parseUnary(): unknown {
    this.skipWs();
    if (this.match('!')) {
      return !isTruthy(this.parseUnary());
    }
    // Unary minus for non-literals (`-$x`, `-(…)`); a `-` before a digit is left
    // to parseNumber so negative literals keep parsing as before.
    if (this.peek() === '-' && !/[0-9]/.test(this.src[this.i + 1] ?? '')) {
      this.i++;
      return -num(this.parseUnary());
    }
    return this.parseAtom();
  }

  parseAtom(): unknown {
    this.skipWs();
    const ch = this.peek();
    if (ch === '(') {
      this.i++;
      const v = this.parseExpr();
      this.skipWs();
      if (this.peek() === ')') this.i++;
      return v;
    }
    if (ch === '[') return this.parseArrayLiteral();
    if (ch === '"' || ch === "'") return this.parseString();
    if (
      /[0-9]/.test(ch) ||
      (ch === '-' && /[0-9]/.test(this.src[this.i + 1] ?? ''))
    ) {
      return this.parseNumber();
    }
    if (ch === '$') {
      this.i++;
      return this.parseVarPath();
    }
    const id = this.readIdent();
    if (!id) return undefined;
    if (id === 'true') return true;
    if (id === 'false') return false;
    if (id === 'null') return null;
    // `name(args…)` → whitelisted function call; otherwise a bare identifier read.
    this.skipWs();
    if (this.peek() === '(') {
      return callFunction(id, this.parseCallArgs());
    }
    return lookupScope(id, this.scopes);
  }

  /** Parse `( arg, arg, … )` into evaluated argument values. */
  parseCallArgs(): unknown[] {
    this.i++; // consume '('
    const args: unknown[] = [];
    this.skipWs();
    if (this.peek() === ')') {
      this.i++;
      return args;
    }
    for (;;) {
      args.push(this.parseExpr());
      this.skipWs();
      if (this.peek() === ',') {
        this.i++;
        continue;
      }
      break;
    }
    this.skipWs();
    if (this.peek() === ')') this.i++;
    return args;
  }

  /**
   * Parse `[a, b]` (indexed) or `['k' => v, …]` (associative) literals. A `=>`
   * anywhere makes it associative; any bare items already collected fold in under
   * their numeric index. A trailing comma is tolerated.
   */
  parseArrayLiteral(): unknown {
    this.i++; // consume '['
    const arr: unknown[] = [];
    const obj: Record<string, unknown> = {};
    let isAssoc = false;
    this.skipWs();
    if (this.peek() === ']') {
      this.i++;
      return arr;
    }
    for (;;) {
      const first = this.parseExpr();
      this.skipWs();
      if (this.match('=>')) {
        isAssoc = true;
        obj[toText(first)] = this.parseExpr();
      } else {
        arr.push(first);
      }
      this.skipWs();
      if (this.peek() === ',') {
        this.i++;
        this.skipWs();
        if (this.peek() === ']') break; // trailing comma
        continue;
      }
      break;
    }
    this.skipWs();
    if (this.peek() === ']') this.i++;
    if (isAssoc) {
      arr.forEach((v, idx) => {
        if (!(String(idx) in obj)) obj[String(idx)] = v;
      });
      return obj;
    }
    return arr;
  }

  parseString(): string {
    const quote = this.src[this.i];
    this.i++;
    let out = '';
    while (this.i < this.src.length && this.src[this.i] !== quote) {
      if (this.src[this.i] === '\\' && this.i + 1 < this.src.length) {
        out += this.src[this.i + 1];
        this.i += 2;
      } else {
        out += this.src[this.i];
        this.i++;
      }
    }
    if (this.src[this.i] === quote) this.i++;
    return out;
  }

  parseNumber(): number {
    const start = this.i;
    if (this.src[this.i] === '-') this.i++;
    while (this.i < this.src.length && /[0-9.]/.test(this.src[this.i] ?? ''))
      this.i++;
    return Number(this.src.slice(start, this.i));
  }

  readIdent(): string {
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(this.src.slice(this.i));
    if (!m) return '';
    this.i += m[0].length;
    return m[0];
  }

  parseVarPath(): unknown {
    const head = this.readIdent();
    if (!head) return undefined;
    let cur: unknown = lookupScope(head, this.scopes);
    for (;;) {
      if (this.src.startsWith('->', this.i) || this.src[this.i] === '.') {
        this.i += this.src.startsWith('->', this.i) ? 2 : 1;
        const prop = this.readIdent();
        if (!prop) break;
        cur = propGet(cur, prop);
      } else if (this.src[this.i] === '[') {
        // Dynamic index/key access: `$a[0]`, `$a['key']`, `$a[$i]`.
        this.i++;
        const idx = this.parseExpr();
        this.skipWs();
        if (this.peek() === ']') this.i++;
        cur = indexGet(cur, idx);
      } else break;
    }
    return cur;
  }
}

function propGet(obj: unknown, key: string): unknown {
  if (obj == null) return undefined;
  if (typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
}

/** Index into an array (numeric key) or object (string key); undefined-safe. */
function indexGet(obj: unknown, key: unknown): unknown {
  if (obj == null) return undefined;
  if (Array.isArray(obj)) {
    const n = typeof key === 'number' ? key : Number(key);
    return Number.isInteger(n) ? obj[n] : undefined;
  }
  if (typeof obj === 'object') {
    return (obj as Record<string, unknown>)[toText(key)];
  }
  return undefined;
}

/** Element/entry count of an array or object; 0 for scalars/null. */
function sizeOf(x: unknown): number {
  if (Array.isArray(x)) return x.length;
  if (x !== null && typeof x === 'object') return Object.keys(x).length;
  return 0;
}

/** PHP-style number_format: fixed decimals + thousands separators. */
function numberFormat(n: number, decimals: number): string {
  const fixed = n.toFixed(decimals >= 0 ? decimals : 0);
  const [intPart, fracPart] = fixed.split('.');
  const withSep = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${withSep}.${fracPart}` : withSep;
}

/**
 * Curated, side-effect-free functions callable from template expressions
 * (`count($x)`, `number_format($n, 2)`, `implode(', ', $list)`, …). This is an
 * ALLOW-LIST: templates are tenant-authored data, so arbitrary function
 * execution must never be possible. Any name absent here returns `undefined`
 * (renders empty). Only add pure helpers — never anything with I/O or side
 * effects.
 */
const FUNCTIONS: Record<string, (...args: unknown[]) => unknown> = {
  count: (x) => sizeOf(x),
  length: (x) => sizeOf(x),
  abs: (x) => Math.abs(num(x)),
  ceil: (x) => Math.ceil(num(x)),
  floor: (x) => Math.floor(num(x)),
  round: (x, p) => {
    const f = 10 ** Math.trunc(num(p));
    return Math.round(num(x) * f) / f;
  },
  min: (...a) => Math.min(...a.map(num)),
  max: (...a) => Math.max(...a.map(num)),
  number_format: (x, d) => numberFormat(num(x), Math.trunc(num(d))),
  upper: (s) => toText(s).toUpperCase(),
  lower: (s) => toText(s).toLowerCase(),
  strtoupper: (s) => toText(s).toUpperCase(),
  strtolower: (s) => toText(s).toLowerCase(),
  ucfirst: (s) => {
    const t = toText(s);
    return t.charAt(0).toUpperCase() + t.slice(1);
  },
  trim: (s) => toText(s).trim(),
  strlen: (s) => toText(s).length,
  nl2br: (s) => toText(s).replace(/\r\n|\r|\n/g, '<br />'),
  substr: (s, start, len) => {
    const str = toText(s);
    const st = Math.trunc(num(start));
    const begin = st < 0 ? Math.max(str.length + st, 0) : st;
    if (len === undefined) return str.slice(begin);
    const l = Math.trunc(num(len));
    return l < 0
      ? str.slice(begin, str.length + l)
      : str.slice(begin, begin + l);
  },
  str_replace: (search, replace, subject) =>
    toText(subject).split(toText(search)).join(toText(replace)),
  implode: (glue, arr) => {
    // PHP allows implode($array) with the glue defaulting to '' — support both.
    if (arr === undefined && Array.isArray(glue)) {
      return glue.map(toText).join('');
    }
    return (Array.isArray(arr) ? arr : []).map(toText).join(toText(glue));
  },
  join: (glue, arr) =>
    (Array.isArray(arr) ? arr : []).map(toText).join(toText(glue)),
};

/** Call a whitelisted function; unknown names or thrown errors → undefined. */
function callFunction(name: string, args: unknown[]): unknown {
  const fn = FUNCTIONS[name];
  if (!fn) return undefined;
  try {
    return fn(...args);
  } catch {
    return undefined;
  }
}

function cmp(op: string, a: unknown, b: unknown): boolean {
  if (op === '==' || op === '!=') {
    const looseEmpty = (x: unknown, y: unknown) =>
      (x === '' || x == null) && (y === '' || y == null);
    const eq = a === b || looseEmpty(a, b) || toText(a) === toText(b);
    return op === '==' ? eq : !eq;
  }
  const na = typeof a === 'number' ? a : Number(a);
  const nb = typeof b === 'number' ? b : Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) {
    if (op === '<') return na < nb;
    if (op === '>') return na > nb;
    if (op === '<=') return na <= nb;
    if (op === '>=') return na >= nb;
  }
  const sa = toText(a);
  const sb = toText(b);
  if (op === '<') return sa < sb;
  if (op === '>') return sa > sb;
  if (op === '<=') return sa <= sb;
  if (op === '>=') return sa >= sb;
  return false;
}
