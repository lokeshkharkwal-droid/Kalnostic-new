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
//   plain-token   := bare identifier               → data[name]; PAGENO/nb empty
//   latte-tag     :=
//       "$" expr ("|" filter)*                      (variable output; HTML-escaped
//                                                    unless |noescape is set)
//     | "if" <cond> | "else" | "/if"                (conditional block)
//     | "foreach" $arr "as" [$k "=>"] $v | "/foreach"
//     | "var" $name "=" expr                        (assign to current scope)
//     | "define" name ("," $param)* … "/define"     (named block w/ params)
//     | "include" name ("," argExpr)*               (render a named block)
//
// Expression surface (see `ExprParser`):
//
//   atom  := string | number | true|false|null | "$"path | identifier | "(" expr ")"
//   unary := "!" unary | atom
//   add   := unary (("+"|"-"|".") unary)*    ("+","-" numeric; "." string concat)
//   cmp   := add (("=="|"!="|"<="|">="|"<"|">") add)?
//   and   := cmp ("&&" cmp)*
//   or    := and ("||" and)*
//   expr  := or
//
// `+`/`-`/`.` and `{define}`/`{include}` are additions over the legacy renderer
// (which the Lab-All-Reports counting template — `{var $n = $n + 1}`,
// `'page_header_' . $i`, `{include block-page-header, …}` — depends on).
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

// {PAGENO} / {nb} are mPDF page-number tokens; Puppeteer computes page numbers
// separately, so we emit empty strings.
const EMPTY_TOKENS = new Set(['PAGENO', 'nb']);

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
  | { type: 'var'; name: string; expr: string }
  | { type: 'include'; name: string; args: string[] };

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
        const cond = trimmed.slice(2).trim();
        const thenBlock = parseBlock(['else', '/if']);
        let elseBlock: Node[] = [];
        if (thenBlock.stopped === 'else') {
          i++; // consume {else}
          const elseParsed = parseBlock(['/if']);
          elseBlock = elseParsed.nodes;
          if (elseParsed.stopped === '/if') i++; // consume {/if}
        } else if (thenBlock.stopped === '/if') {
          i++; // consume {/if}
        }
        nodes.push({
          type: 'if',
          cond,
          then: thenBlock.nodes,
          else: elseBlock,
        });
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
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) {
        nodes.push({ type: 'token', name: trimmed });
        continue;
      }
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

function splitFilters(s: string): { expr: string; filters: string[] } {
  const parts = s.split('|');
  return {
    expr: (parts[0] ?? '').trim(),
    filters: parts.slice(1).map((p) => p.trim()),
  };
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
      if (EMPTY_TOKENS.has(n.name)) return '';
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
      const str = toText(v);
      return n.filters.includes('noescape') ? str : escapeHtml(str);
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
    case 'var': {
      let v: unknown;
      try {
        v = evalExpr(n.expr, scopes);
      } catch {
        v = undefined;
      }
      if (scopes.length === 0) scopes.push({});
      let written = false;
      for (let i = scopes.length - 1; i >= 0; i--) {
        const frame = scopes[i];
        if (frame && Object.prototype.hasOwnProperty.call(frame, n.name)) {
          frame[n.name] = v;
          written = true;
          break;
        }
      }
      if (!written) {
        const top = scopes[scopes.length - 1];
        if (top) top[n.name] = v;
      }
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

function isTruthy(v: unknown): boolean {
  if (v == null || v === false) return false;
  if (v === '' || v === 0) return false;
  if (Array.isArray(v) && v.length === 0) return false;
  return true;
}

// ─── Expression evaluator ────────────────────────────────────────────────────

function evalExpr(src: string, scopes: Scope[]): unknown {
  const parser = new ExprParser(src, scopes);
  const v = parser.parseOr();
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
    let left = this.parseUnary();
    for (;;) {
      this.skipWs();
      // A `.` immediately followed by a digit could be a decimal — but numbers
      // are parsed whole in parseNumber, so a bare `.` here is concatenation.
      if (this.match('+')) {
        left = num(left) + num(this.parseUnary());
      } else if (this.match('-')) {
        left = num(left) - num(this.parseUnary());
      } else if (this.match('.')) {
        left = `${toText(left)}${toText(this.parseUnary())}`;
      } else {
        break;
      }
    }
    return left;
  }

  parseUnary(): unknown {
    this.skipWs();
    if (this.match('!')) {
      const v = this.parseUnary();
      return !isTruthy(v);
    }
    return this.parseAtom();
  }

  parseAtom(): unknown {
    this.skipWs();
    const ch = this.peek();
    if (ch === '(') {
      this.i++;
      const v = this.parseOr();
      this.skipWs();
      if (this.peek() === ')') this.i++;
      return v;
    }
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
    return lookupScope(id, this.scopes);
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
    while (!this.eof()) {
      if (this.src.startsWith('->', this.i)) {
        this.i += 2;
      } else if (this.src[this.i] === '.') {
        this.i++;
      } else break;
      const prop = this.readIdent();
      if (!prop) break;
      cur = propGet(cur, prop);
    }
    return cur;
  }
}

function propGet(obj: unknown, key: string): unknown {
  if (obj == null) return undefined;
  if (typeof obj !== 'object') return undefined;
  return (obj as Record<string, unknown>)[key];
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
