/**
 * Block-by-block HTML emitter for the Advance PDF Template engine.
 *
 * One renderer function per `Block.type`. Each emits a self-contained
 * HTML fragment with inline styles derived from the block's `style`
 * overrides + theme defaults. We deliberately avoid framework-specific
 * abstractions here — the output is plain HTML so it's easy to debug
 * and the editor can show identical previews.
 */

/*
 * This renderer's whole job is to stringify token-resolved values (typed
 * `unknown`, but resolved to primitives at runtime) into HTML fragments; where
 * a value is unexpectedly an object it intentionally falls back to the legacy
 * substitution behaviour. `no-base-to-string` therefore fires on nearly every
 * emit site — disabled file-wide (cf. the same pragmatic pattern in
 * `prisma.service.ts`).
 */
/* eslint-disable @typescript-eslint/no-base-to-string */
import type { Block, BlockStyle, Theme } from './types';
import {
  resolveToken,
  resolveValue,
  resolveArray,
  evalCondition,
  type ResolverCtx,
} from './token-resolver';

export interface RenderEnv {
  ctx: ResolverCtx;
  theme: Theme;
}

/** Escape user-supplied text for HTML output (XSS / template safety). */
function esc(s: unknown): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert a BlockStyle to inline CSS. */
export function styleToCss(s: BlockStyle | undefined): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.font_family) parts.push(`font-family:${s.font_family}`);
  if (s.font_size) parts.push(`font-size:${s.font_size}pt`);
  if (s.font_weight) parts.push(`font-weight:${s.font_weight}`);
  if (s.font_style) parts.push(`font-style:${s.font_style}`);
  if (s.color) parts.push(`color:${s.color}`);
  if (s.background) parts.push(`background:${s.background}`);
  if (s.align) parts.push(`text-align:${s.align}`);
  if (s.width) parts.push(`width:${s.width}`);
  if (s.border) parts.push(`border:${s.border}`);
  if (s.border_radius) parts.push(`border-radius:${s.border_radius}`);
  if (s.text_transform) parts.push(`text-transform:${s.text_transform}`);
  if (s.line_height) parts.push(`line-height:${s.line_height}`);
  if (s.letter_spacing) parts.push(`letter-spacing:${s.letter_spacing}`);
  if (s.padding) {
    if (typeof s.padding === 'string') parts.push(`padding:${s.padding}`);
    else {
      if (s.padding.top) parts.push(`padding-top:${s.padding.top}`);
      if (s.padding.right) parts.push(`padding-right:${s.padding.right}`);
      if (s.padding.bottom) parts.push(`padding-bottom:${s.padding.bottom}`);
      if (s.padding.left) parts.push(`padding-left:${s.padding.left}`);
    }
  }
  if (s.margin) {
    if (typeof s.margin === 'string') parts.push(`margin:${s.margin}`);
    else {
      if (s.margin.top) parts.push(`margin-top:${s.margin.top}`);
      if (s.margin.right) parts.push(`margin-right:${s.margin.right}`);
      if (s.margin.bottom) parts.push(`margin-bottom:${s.margin.bottom}`);
      if (s.margin.left) parts.push(`margin-left:${s.margin.left}`);
    }
  }
  return parts.join(';');
}

/** Render any block (dispatches on `type`). */
export function renderBlock(block: Block, env: RenderEnv): string {
  switch (block.type) {
    case 'section':
      return renderSection(block, env);
    case 'columns':
      return renderColumns(block, env);
    case 'divider':
      return renderDivider(block);
    case 'spacer':
      return renderSpacer(block);
    case 'page-break':
      return renderPageBreak();
    case 'page-number':
      return renderPageNumber(block);
    case 'heading':
      return renderHeading(block, env);
    case 'paragraph':
      return renderParagraph(block, env);
    case 'kv':
      return renderKv(block, env);
    case 'image':
      return renderImage(block, env);
    case 'logo':
      return renderLogo(block, env);
    case 'qr':
      return renderQr(block, env);
    case 'signature':
      return renderSignature(block, env);
    case 'table':
      return renderTable(block, env);
    case 'parameters-table':
      return renderParametersTable(block, env);
    case 'range-bar':
      return renderRangeBar(block, env);
    case 'score-circle':
      return renderScoreCircle(block, env);
    case 'status-pill':
      return renderStatusPill(block, env);
    case 'result-card':
      return renderResultCard(block, env);
    case 'note-card':
      return renderNoteCard(block, env);
    case 'organ-diagram':
      return renderOrganDiagram(block, env);
    case 'donut-chart':
      return renderDonutChart(block, env);
    case 'bar-chart':
      return renderBarChart(block, env);
    case 'line-chart':
      return renderLineChart(block, env);
    case 'repeat':
      return renderRepeat(block, env);
    case 'conditional':
      return renderConditional(block, env);
  }
}

export function renderBlocks(blocks: Block[], env: RenderEnv): string {
  return blocks.map((b) => renderBlock(b, env)).join('');
}

// ─── Layout ─────────────────────────────────────────────────────────────

function renderSection(
  b: Extract<Block, { type: 'section' }>,
  env: RenderEnv,
): string {
  return `<div class="pdfv2-section" style="${styleToCss(b.style)}">${renderBlocks(b.props.blocks, env)}</div>`;
}

function renderColumns(
  b: Extract<Block, { type: 'columns' }>,
  env: RenderEnv,
): string {
  const gap = b.props.gap ?? '12px';
  const cols = b.props.columns
    .map((c) => {
      const w = c.width
        ? `flex:0 0 ${c.width}; width:${c.width}`
        : 'flex:1 1 0';
      return `<div style="${w}">${renderBlocks(c.blocks, env)}</div>`;
    })
    .join('');
  return `<div style="display:flex; gap:${gap}; ${styleToCss(b.style)}">${cols}</div>`;
}

function renderDivider(b: Extract<Block, { type: 'divider' }>): string {
  const t = b.props.thickness ?? '1px';
  const c = b.props.color ?? '#e2e8f0';
  return `<hr style="border:none;border-top:${t} solid ${c};margin:8px 0;${styleToCss(b.style)}" />`;
}

function renderSpacer(b: Extract<Block, { type: 'spacer' }>): string {
  return `<div style="height:${b.props.height};${styleToCss(b.style)}"></div>`;
}

function renderPageBreak(): string {
  return `<div style="page-break-after:always; break-after:page;"></div>`;
}

/**
 * Render a Puppeteer-recognised page counter. The `pageNumber` /
 * `totalPages` spans get filled in only inside Puppeteer's
 * headerTemplate / footerTemplate — drop the block in the body and
 * you'll just see the literal format string.
 */
function renderPageNumber(b: Extract<Block, { type: 'page-number' }>): string {
  const fmt = b.props.format ?? 'Page {n} of {total}';
  // Each placeholder maps to the magic Puppeteer span. Anything else
  // is escaped so format can include literal copy ("Pg {n}/{total}",
  // "{n} / {total}", etc.) without injecting markup.
  const html = esc(fmt)
    .replace(/\{n\}/g, '<span class="pageNumber"></span>')
    .replace(/\{total\}/g, '<span class="totalPages"></span>');
  // Block-level wrapper so style.align (→ text-align) actually takes
  // effect — text-align on an inline span does nothing.
  return `<div style="${styleToCss(b.style)}">${html}</div>`;
}

// ─── Text ───────────────────────────────────────────────────────────────

function renderHeading(
  b: Extract<Block, { type: 'heading' }>,
  env: RenderEnv,
): string {
  const tag = `h${b.props.level}`;
  const text = esc(resolveToken(b.props.text, env.ctx));
  const defaults = `font-family:${env.theme.fonts.heading};color:${env.theme.colors.text};margin:0 0 4px 0;`;
  return `<${tag} style="${defaults}${styleToCss(b.style)}">${text}</${tag}>`;
}

function renderParagraph(
  b: Extract<Block, { type: 'paragraph' }>,
  env: RenderEnv,
): string {
  const text = resolveToken(b.props.text, env.ctx);
  return `<p style="margin:0 0 4px 0;${styleToCss(b.style)}">${esc(text)}</p>`;
}

function renderKv(b: Extract<Block, { type: 'kv' }>, env: RenderEnv): string {
  const label = esc(resolveToken(b.props.label, env.ctx));
  const value = esc(resolveToken(b.props.value, env.ctx));
  return `
    <div class="pdfv2-kv" style="display:flex;flex-direction:column;gap:2px;${styleToCss(b.style)}">
      <span style="font-size:9pt;color:${env.theme.colors.muted};">${label}</span>
      <span style="font-size:11pt;color:${env.theme.colors.text};font-weight:600;">${value}</span>
    </div>
  `;
}

// ─── Media ──────────────────────────────────────────────────────────────

function renderImage(
  b: Extract<Block, { type: 'image' }>,
  env: RenderEnv,
): string {
  const src = esc(resolveToken(b.props.src, env.ctx));
  const alt = esc(b.props.alt ?? '');
  const width = b.props.width ? `width:${b.props.width};` : '';
  const height = b.props.height ? `height:${b.props.height};` : '';
  const fit = b.props.fit ? `object-fit:${b.props.fit};` : '';
  return `<img src="${src}" alt="${alt}" style="${width}${height}${fit}${styleToCss(b.style)}" />`;
}

function renderLogo(
  b: Extract<Block, { type: 'logo' }>,
  env: RenderEnv,
): string {
  // {branch.logo} resolved against the context.
  const src = esc(resolveToken('{branch.logo}', env.ctx));
  const w = b.props.width ?? '120px';
  return `<img src="${src}" alt="Logo" style="width:${w};${styleToCss(b.style)}" />`;
}

function renderQr(b: Extract<Block, { type: 'qr' }>, env: RenderEnv): string {
  const value = esc(resolveToken(b.props.value, env.ctx));
  const size = b.props.size ?? '120px';
  // Render via Google Charts API for v1 — replace with a server-side
  // QR generator (qrcode npm) once we add the dependency.
  const url = `https://chart.googleapis.com/chart?cht=qr&chs=240x240&chl=${encodeURIComponent(value)}`;
  return `<img src="${url}" alt="QR" style="width:${size};height:${size};${styleToCss(b.style)}" />`;
}

function renderSignature(
  b: Extract<Block, { type: 'signature' }>,
  env: RenderEnv,
): string {
  const name = esc(resolveToken(b.props.name, env.ctx));
  const title = esc(resolveToken(b.props.title ?? '', env.ctx));
  const sigImg = b.props.src
    ? `<img src="${esc(resolveToken(b.props.src, env.ctx))}" style="height:32px; max-width:120px;" />`
    : `<div style="border-bottom:1px solid #94a3b8;width:120px;height:32px;"></div>`;
  return `
    <div style="display:flex;flex-direction:column;align-items:flex-start;gap:2px;${styleToCss(b.style)}">
      ${sigImg}
      <span style="font-weight:600;font-size:11pt;">${name}</span>
      ${title ? `<span style="font-size:9pt;color:${env.theme.colors.muted};">${title}</span>` : ''}
    </div>
  `;
}

// ─── Tabular ────────────────────────────────────────────────────────────

function renderTable(
  b: Extract<Block, { type: 'table' }>,
  env: RenderEnv,
): string {
  const cols = b.props.columns ?? [];
  const rows =
    typeof b.props.rows === 'string'
      ? (resolveArray(b.props.rows, env.ctx) as Array<Record<string, unknown>>)
      : (b.props.rows ?? []);
  const head = cols
    .map(
      (c) =>
        `<th style="text-align:left;padding:6px 8px;font-size:10pt;color:${env.theme.colors.muted};border-bottom:1px solid #e2e8f0;${c.width ? `width:${c.width};` : ''}">${esc(c.label)}</th>`,
    )
    .join('');
  const body = rows
    .map((row, i) => {
      const bg =
        b.props.striped && i % 2 === 1
          ? `background:${env.theme.colors.bg};`
          : '';
      const cells = cols
        .map((c) => {
          // Each cell value can itself be a token, resolved against an
          // ad-hoc loop scope that exposes the row.
          const ctxWithRow: ResolverCtx = {
            ...env.ctx,
            loops: [...env.ctx.loops, { _row: row }],
          };
          const raw = row[c.key];
          const v =
            typeof raw === 'string'
              ? resolveToken(raw, ctxWithRow)
              : raw == null
                ? ''
                : String(raw);
          return `<td style="padding:6px 8px;font-size:10pt;border-bottom:1px solid #f1f5f9;">${esc(v)}</td>`;
        })
        .join('');
      return `<tr style="${bg}">${cells}</tr>`;
    })
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

function renderParametersTable(
  b: Extract<Block, { type: 'parameters-table' }>,
  env: RenderEnv,
): string {
  const items = resolveArray(b.props.items, env.ctx) as Array<{
    name?: string;
    value?: string | number;
    unit?: string;
    range?: string;
    status?: string;
  }>;
  const cols = b.props.columns ?? ['name', 'value', 'unit', 'range'];
  const colorFor = (s: string | undefined) =>
    s === 'normal'
      ? env.theme.colors.success
      : s === 'borderline'
        ? env.theme.colors.warning
        : s === 'abnormal'
          ? env.theme.colors.danger
          : env.theme.colors.muted;
  const head = cols
    .map(
      (c) =>
        `<th style="text-align:left;padding:8px 10px;font-size:10pt;color:${env.theme.colors.muted};border-bottom:1px solid #e2e8f0;text-transform:capitalize;">${c}</th>`,
    )
    .join('');
  const body = items
    .map((it) => {
      const cells = cols
        .map((c) => {
          if (c === 'status') {
            return `<td style="padding:8px 10px;"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colorFor(it.status)};"></span></td>`;
          }
          const v = (it as Record<string, unknown>)[c];
          const text = v == null ? '' : String(v);
          const colour =
            c === 'value' ? colorFor(it.status) : env.theme.colors.text;
          return `<td style="padding:8px 10px;font-size:10pt;color:${colour};">${esc(text)}</td>`;
        })
        .join('');
      return `<tr>${cells}</tr>`;
    })
    .join('');
  return `
    <table style="width:100%;border-collapse:collapse;${styleToCss(b.style)}">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>
  `;
}

// ─── Visualizations ─────────────────────────────────────────────────────

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function renderRangeBar(
  b: Extract<Block, { type: 'range-bar' }>,
  env: RenderEnv,
): string {
  const value = num(resolveValue(b.props.value, env.ctx));
  const lowEnd = num(
    resolveValue(b.props.normal_low, env.ctx),
    num(resolveValue(b.props.low, env.ctx), 0),
  );
  const highStart = num(
    resolveValue(b.props.normal_high, env.ctx),
    num(resolveValue(b.props.high, env.ctx), 100),
  );
  const min = num(
    resolveValue(b.props.low, env.ctx),
    Math.min(lowEnd - (highStart - lowEnd), value, lowEnd),
  );
  const max = num(
    resolveValue(b.props.high, env.ctx),
    Math.max(highStart + (highStart - lowEnd), value, highStart),
  );
  const span = Math.max(0.0001, max - min);
  const pct = (n: number) =>
    Math.max(0, Math.min(100, ((n - min) / span) * 100));
  const lowPct = pct(lowEnd);
  const highPct = pct(highStart);
  const valPct = pct(value);
  const inLow = value < lowEnd;
  const inHigh = value > highStart;
  const status = inLow || inHigh ? 'abnormal' : 'normal';
  const valColor =
    status === 'abnormal' ? env.theme.colors.danger : env.theme.colors.success;
  const title = b.props.title ? esc(resolveToken(b.props.title, env.ctx)) : '';
  const desc = b.props.description
    ? esc(resolveToken(b.props.description, env.ctx))
    : '';
  const unit = b.props.unit ? ` ${esc(b.props.unit)}` : '';
  return `
    <div style="margin:6px 0;${styleToCss(b.style)}">
      ${
        title
          ? `<div style="font-size:11pt;font-weight:600;margin-bottom:6px;color:${env.theme.colors.text};">
        ${title} <span style="color:${valColor};font-weight:500;">(${esc(value)}${unit})</span>
      </div>`
          : ''
      }
      ${desc ? `<div style="font-size:9pt;color:${env.theme.colors.muted};margin-bottom:8px;">${desc}</div>` : ''}
      <div style="position:relative;height:6px;border-radius:3px;background:linear-gradient(to right,
        ${env.theme.colors.danger} 0%, ${env.theme.colors.danger} ${lowPct}%,
        ${env.theme.colors.success} ${lowPct}%, ${env.theme.colors.success} ${highPct}%,
        ${env.theme.colors.danger} ${highPct}%, ${env.theme.colors.danger} 100%);">
        <div style="position:absolute;left:${valPct}%;top:-14px;transform:translateX(-50%);
                    background:${valColor};color:#fff;font-size:9pt;padding:1px 6px;border-radius:4px;font-weight:600;">
          ${esc(value)}
        </div>
        <div style="position:absolute;left:${valPct}%;top:-2px;transform:translateX(-50%);
                    width:10px;height:10px;border-radius:50%;background:${valColor};border:2px solid #fff;"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:8pt;color:${env.theme.colors.muted};margin-top:4px;">
        <span>Low</span><span>${esc(lowEnd)}</span><span>Normal</span><span>${esc(highStart)}</span><span>High</span>
      </div>
    </div>
  `;
}

function renderScoreCircle(
  b: Extract<Block, { type: 'score-circle' }>,
  env: RenderEnv,
): string {
  const value = num(resolveValue(b.props.value, env.ctx));
  const max = num(resolveValue(b.props.max ?? 100, env.ctx), 100);
  const pct = Math.max(0, Math.min(100, (value / Math.max(max, 0.0001)) * 100));
  const r = 36,
    c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;
  const label = b.props.label ? esc(resolveToken(b.props.label, env.ctx)) : '';
  return `
    <div style="display:flex;flex-direction:column;align-items:center;gap:4px;${styleToCss(b.style)}">
      <svg width="92" height="92" viewBox="0 0 92 92">
        <circle cx="46" cy="46" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="6" />
        <circle cx="46" cy="46" r="${r}" fill="none" stroke="${env.theme.colors.brand}" stroke-width="6"
                stroke-dasharray="${dash} ${c}" stroke-linecap="round" transform="rotate(-90 46 46)" />
        <text x="46" y="44" text-anchor="middle" font-size="20" font-weight="700" fill="${env.theme.colors.text}">${esc(value)}</text>
        <text x="46" y="60" text-anchor="middle" font-size="9" fill="${env.theme.colors.muted}">Out of ${esc(max)}</text>
      </svg>
      ${label ? `<span style="font-size:10pt;color:${env.theme.colors.muted};">${label}</span>` : ''}
    </div>
  `;
}

function renderStatusPill(
  b: Extract<Block, { type: 'status-pill' }>,
  env: RenderEnv,
): string {
  const status = String(
    resolveValue(b.props.status, env.ctx) ?? '',
  ).toLowerCase();
  const label = b.props.label ? resolveToken(b.props.label, env.ctx) : status;
  const color =
    status === 'normal'
      ? env.theme.colors.success
      : status === 'borderline'
        ? env.theme.colors.warning
        : status === 'abnormal'
          ? env.theme.colors.danger
          : env.theme.colors.muted;
  return `
    <span style="display:inline-flex;align-items:center;gap:6px;font-size:10pt;color:${color};${styleToCss(b.style)}">
      <span style="width:8px;height:8px;border-radius:50%;background:${color};"></span>
      ${esc(label)}
    </span>
  `;
}

// ─── Result card ───────────────────────────────────────────────────────

function renderResultCard(
  b: Extract<Block, { type: 'result-card' }>,
  env: RenderEnv,
): string {
  const raw = resolveValue(b.props.item, env.ctx);
  if (!raw || typeof raw !== 'object') return '';
  const r = raw as {
    name?: unknown;
    value?: unknown;
    unit?: unknown;
    status?: unknown;
    ref_low?: unknown;
    ref_normal_low?: unknown;
    ref_normal_high?: unknown;
    ref_high?: unknown;
    range?: unknown;
    abnormal_reason?: unknown;
  };

  const name = String(r.name ?? '');
  const valueS = String(r.value ?? '');
  const unit = String(r.unit ?? '');
  const status = String(r.status ?? '').toLowerCase();
  const numericValue = Number(valueS);
  const isNumeric = valueS !== '' && Number.isFinite(numericValue);

  const nLow = toNum(r.ref_normal_low);
  const nHigh = toNum(r.ref_normal_high);
  const fLow = toNum(r.ref_low) ?? nLow;
  const fHigh = toNum(r.ref_high) ?? nHigh;
  const hasRange = nLow != null && nHigh != null;

  const statusColor =
    status === 'borderline'
      ? env.theme.colors.warning
      : status === 'abnormal'
        ? env.theme.colors.danger
        : status === 'normal'
          ? env.theme.colors.success
          : env.theme.colors.muted;
  const valueColor = status === 'normal' ? env.theme.colors.text : statusColor;

  const description = b.props.description
    ? resolveToken(b.props.description, env.ctx)
    : '';
  const reason = String(r.abnormal_reason ?? '');
  // Match the label the value-entry screen uses for this field
  // (`_ReportFillForm.tsx`: "Test Comment"). Templates can still pin a
  // custom title via the block's `reason_title` prop.
  const reasonTitle = b.props.reason_title ?? 'Test Comment';

  // Header row.
  const valueText = unit ? `${valueS} ${unit}` : valueS;
  const header = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${statusColor};"></span>
      <span style="font-weight:700;font-size:13pt;color:${env.theme.colors.text};">${esc(name)}</span>
      <span style="font-weight:500;color:${valueColor};">(${esc(valueText)})</span>
    </div>
  `;

  const desc = description
    ? `<p style="color:${env.theme.colors.muted};margin:0 0 12px 0;line-height:1.45;">${esc(description)}</p>`
    : '';

  let bar = '';
  if (isNumeric && hasRange) {
    bar = renderResultRangeBar({
      value: numericValue,
      low: fLow ?? nLow,
      normalLow: nLow,
      normalHigh: nHigh,
      high: fHigh ?? nHigh,
      themeDanger: env.theme.colors.danger,
      themeSuccess: env.theme.colors.success,
      themeMuted: env.theme.colors.muted,
    });
  }

  let reasonBox = '';
  if (reason) {
    // The reason is HTML coming from the legacy WYSIWYG `notes` field
    // — render it as markup, not text, so authoring formatting (bold,
    // line breaks, lists) survives. We allow-list safe tags and strip
    // event handlers + javascript: URLs to keep XSS off the table.
    const reasonHtml = sanitizeRichText(reason);
    reasonBox = `
      <div style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-top:10px;background:#ffffff;">
        <div style="font-weight:700;margin-bottom:8px;color:${env.theme.colors.text};">${esc(reasonTitle)}</div>
        <div style="display:flex;gap:10px;align-items:flex-start;">
          <span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:14pt;font-weight:700;text-align:center;line-height:28px;flex-shrink:0;">i</span>
          <span style="line-height:1.5;">${reasonHtml}</span>
        </div>
      </div>
    `;
  }

  return `
    <div class="pdfv2-result-card" style="background:${env.theme.colors.bg};border-radius:8px;padding:16px;margin:8px 0;${styleToCss(b.style)}">
      ${header}
      ${desc}
      ${bar}
      ${reasonBox}
    </div>
  `;
}

/**
 * Render the three-segment Low / Normal / High bar with a marker at
 * the patient's value — used inside `renderResultCard`.
 *
 * Visual layout uses **fixed** zone widths (25% / 50% / 25%) instead of
 * sizing each zone by the data range. Reason: the lab-report context
 * leaves `ref_low` / `ref_high` null for most parameters (only the
 * normal band is set), so a data-proportional layout would collapse
 * the red Low and High segments to zero width and the bar would be
 * pure green. With fixed widths, you always see three coloured zones,
 * and the marker is positioned by interpolating within whichever zone
 * the value falls in.
 */
function renderResultRangeBar(args: {
  value: number;
  low: number;
  normalLow: number;
  normalHigh: number;
  high: number;
  themeDanger: string;
  themeSuccess: string;
  themeMuted: string;
}): string {
  const {
    value,
    low,
    normalLow,
    normalHigh,
    high,
    themeDanger,
    themeSuccess,
    themeMuted,
  } = args;

  // Fixed zone layout — matches the labels (Low | nL | Normal | nH | High)
  // distributed by `justify-content:space-between` over the full width.
  const LOW_END = 25;
  const NORMAL_END = 75;

  let pct: number;
  if (value < normalLow) {
    const span = Math.max(0, normalLow - low);
    const t = span > 0 ? (value - low) / span : 0;
    pct = clamp01(t) * LOW_END;
  } else if (value > normalHigh) {
    const span = Math.max(0, high - normalHigh);
    const t = span > 0 ? (value - normalHigh) / span : 1;
    pct = NORMAL_END + clamp01(t) * (100 - NORMAL_END);
  } else {
    const span = Math.max(0, normalHigh - normalLow);
    const t = span > 0 ? (value - normalLow) / span : 0.5;
    pct = LOW_END + clamp01(t) * (NORMAL_END - LOW_END);
  }
  pct = Math.max(0, Math.min(100, pct));

  const inNormal = value >= normalLow && value <= normalHigh;
  const markerColor = inNormal ? themeSuccess : themeDanger;
  const face = inNormal
    ? `<span style="font-size:10pt;color:#fff;">☺</span>`
    : `<span style="font-size:10pt;color:#fff;">☹</span>`;
  const baseTrack = '6px';
  return `
    <div style="position:relative;padding:24px 0 22px 0;">
      <div style="position:relative;height:${baseTrack};display:flex;border-radius:3px;overflow:hidden;">
        <div style="width:${LOW_END}%;background:${themeDanger};"></div>
        <div style="width:${NORMAL_END - LOW_END}%;background:${themeSuccess};"></div>
        <div style="width:${100 - NORMAL_END}%;background:${themeDanger};"></div>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9pt;color:${themeMuted};margin-top:6px;">
        <span>Low</span>
        <span>${esc(String(normalLow))}</span>
        <span>Normal</span>
        <span>${esc(String(normalHigh))}</span>
        <span>High</span>
      </div>
      <div style="position:absolute;left:calc(${pct}% - 14px);top:6px;display:flex;flex-direction:column;align-items:center;width:28px;">
        <span style="background:#fff;border:1px solid ${markerColor};color:${markerColor};font-size:9pt;font-weight:700;padding:2px 6px;border-radius:6px;margin-bottom:2px;">${esc(String(value))}</span>
        <span style="background:${markerColor};color:#fff;border-radius:50%;width:20px;height:20px;display:flex;align-items:center;justify-content:center;">${face}</span>
        <span style="font-size:9pt;color:${markerColor};font-weight:600;margin-top:2px;">You</span>
      </div>
    </div>
  `;
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.min(1, t));
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Render-time sanitiser for the `notes` / abnormal-reason field, which
 * comes from a legacy WYSIWYG editor and is stored as HTML. Strips
 * <script> / <style> / <iframe> / <object> / <embed> blocks (with
 * content), inline event handlers (`onclick=…`), and `javascript:` URLs
 * in href/src. Everything else passes through so basic typography
 * (bold, italic, lists, line breaks) keeps working.
 */
function sanitizeRichText(html: string): string {
  let s = html;
  s = s.replace(
    /<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi,
    '',
  );
  s = s.replace(
    /<\s*(script|iframe|object|embed|link|meta)\b[^>]*\/?\s*>/gi,
    '',
  );
  s = s.replace(/\s+on[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(
    /((?:\s|^)(?:href|src|action|formaction)\s*=\s*)("|')\s*javascript:[^"']*\2/gi,
    '$1$2#$2',
  );
  return s;
}

/**
 * Generic note-callout block. Visually identical to the reason callout
 * inside `result-card` so a stack of these renders consistently. Hides
 * itself when the content resolves to an empty / whitespace string
 * unless the template explicitly opts out via `hide_when_empty: false`.
 */
function renderNoteCard(
  b: Extract<Block, { type: 'note-card' }>,
  env: RenderEnv,
): string {
  const title = resolveToken(b.props.title, env.ctx);
  const content = resolveToken(b.props.content, env.ctx);
  const hideEmpty = b.props.hide_when_empty !== false;
  if (hideEmpty && !content.replace(/<[^>]+>/g, '').trim()) return '';
  const html = sanitizeRichText(content);
  return `
    <div class="pdfv2-note-card" style="border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin:8px 0;background:#ffffff;${styleToCss(b.style)}">
      <div style="font-weight:700;margin-bottom:8px;color:${env.theme.colors.text};">${esc(title)}</div>
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <span style="display:inline-block;width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-size:14pt;font-weight:700;text-align:center;line-height:28px;flex-shrink:0;">i</span>
        <span style="line-height:1.5;">${html}</span>
      </div>
    </div>
  `;
}

// ─── Organ diagram + charts ────────────────────────────────────────────

function renderOrganDiagram(
  b: Extract<Block, { type: 'organ-diagram' }>,
  env: RenderEnv,
): string {
  const items = (
    resolveArray(b.props.items, env.ctx) as Array<{
      name?: string;
      status?: string;
    }>
  )
    .filter((it) => it && it.name)
    .slice(0, 8); // visual budget — clamp for safety
  const colorFor = (s: string | undefined) =>
    s === 'normal'
      ? env.theme.colors.success
      : s === 'borderline'
        ? env.theme.colors.warning
        : s === 'abnormal'
          ? env.theme.colors.danger
          : env.theme.colors.muted;

  // Split into left + right gutters around the silhouette so labels
  // never overlap. Odd-index items go right.
  const left = items.filter((_, i) => i % 2 === 0);
  const right = items.filter((_, i) => i % 2 === 1);
  const pill = (it: { name?: string; status?: string }) => `
    <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;">
      <span style="width:8px;height:8px;border-radius:50%;background:${colorFor(it.status)};"></span>
      <span style="font-size:10pt;color:${env.theme.colors.text};">${esc(it.name ?? '')}</span>
      <span style="font-size:9pt;color:${colorFor(it.status)};margin-left:auto;text-transform:capitalize;">${esc(it.status ?? '')}</span>
    </div>`;
  // Inline SVG of a stylised body — kept small (no anatomical detail).
  const silhouette = `
    <svg width="100" height="220" viewBox="0 0 100 220" fill="${env.theme.colors.bg}" stroke="${env.theme.colors.muted}" stroke-width="1.2">
      <circle cx="50" cy="22" r="14" />
      <path d="M30 38 L70 38 L78 90 L72 150 L68 210 L56 210 L52 160 L48 160 L44 210 L32 210 L28 150 L22 90 Z" stroke-linejoin="round" />
      <path d="M30 60 L18 90 L20 120 L26 122" />
      <path d="M70 60 L82 90 L80 120 L74 122" />
    </svg>`;
  const title = b.props.title
    ? `<h4 style="font-size:13pt;margin:0 0 8px 0;color:${env.theme.colors.text};">${esc(resolveToken(b.props.title, env.ctx))}</h4>`
    : '';
  return `
    <div style="${styleToCss(b.style)}">
      ${title}
      <div style="display:flex;gap:12px;align-items:flex-start;">
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;">${left.map(pill).join('')}</div>
        <div style="flex:0 0 100px;display:flex;justify-content:center;">${silhouette}</div>
        <div style="flex:1;display:flex;flex-direction:column;gap:6px;">${right.map(pill).join('')}</div>
      </div>
    </div>
  `;
}

function renderDonutChart(
  b: Extract<Block, { type: 'donut-chart' }>,
  env: RenderEnv,
): string {
  const slices = (
    resolveArray(b.props.slices, env.ctx) as Array<{
      label?: string;
      value?: number;
      color?: string;
    }>
  ).filter((s) => s && Number.isFinite(Number(s.value)));
  const total = slices.reduce((acc, s) => acc + num(s.value), 0);
  const sizePx = parseSize(b.props.size, 140);
  const r = sizePx / 2 - 12,
    c = 2 * Math.PI * r;
  let cumulative = 0;
  const palette = [
    env.theme.colors.brand,
    env.theme.colors.success,
    env.theme.colors.warning,
    env.theme.colors.danger,
    env.theme.colors.muted,
  ];
  const arcs = slices
    .map((s, i) => {
      const v = num(s.value);
      const dash = total > 0 ? (v / total) * c : 0;
      const offset = total > 0 ? (cumulative / total) * c : 0;
      cumulative += v;
      const fill = s.color || palette[i % palette.length];
      return `<circle cx="${sizePx / 2}" cy="${sizePx / 2}" r="${r}" fill="none" stroke="${fill}" stroke-width="14"
      stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${sizePx / 2} ${sizePx / 2})" />`;
    })
    .join('');
  const legend = slices
    .map(
      (s, i) => `
    <div style="display:flex;align-items:center;gap:6px;font-size:10pt;color:${env.theme.colors.text};">
      <span style="width:10px;height:10px;border-radius:2px;background:${s.color || palette[i % palette.length]};"></span>
      <span style="flex:1;">${esc(s.label ?? '')}</span>
      <span style="color:${env.theme.colors.muted};">${esc(s.value ?? 0)}</span>
    </div>`,
    )
    .join('');
  const title = b.props.title
    ? `<h4 style="font-size:13pt;margin:0 0 8px 0;color:${env.theme.colors.text};">${esc(resolveToken(b.props.title, env.ctx))}</h4>`
    : '';
  return `
    <div style="${styleToCss(b.style)}">
      ${title}
      <div style="display:flex;gap:16px;align-items:center;">
        <svg width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}" style="flex-shrink:0;">
          ${arcs}
          <text x="${sizePx / 2}" y="${sizePx / 2 - 2}" text-anchor="middle" font-size="20" font-weight="700" fill="${env.theme.colors.text}">${esc(total)}</text>
          <text x="${sizePx / 2}" y="${sizePx / 2 + 14}" text-anchor="middle" font-size="9" fill="${env.theme.colors.muted}">total</text>
        </svg>
        <div style="flex:1;display:flex;flex-direction:column;gap:4px;">${legend}</div>
      </div>
    </div>
  `;
}

function renderBarChart(
  b: Extract<Block, { type: 'bar-chart' }>,
  env: RenderEnv,
): string {
  const bars = (
    resolveArray(b.props.bars, env.ctx) as Array<{
      label?: string;
      value?: number;
      color?: string;
    }>
  ).filter((s) => s && Number.isFinite(Number(s.value)));
  const max = Math.max(0.0001, ...bars.map((s) => num(s.value)));
  const heightPx = parseSize(b.props.height, 160);
  const barW =
    bars.length > 0 ? Math.min(48, Math.floor(360 / bars.length)) : 0;
  const palette = [env.theme.colors.brand];
  const items = bars
    .map((s) => {
      const v = num(s.value);
      const h = max > 0 ? Math.round((v / max) * (heightPx - 32)) : 0;
      const fill = s.color || palette[0];
      return `
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;width:${barW}px;">
        <span style="font-size:9pt;color:${env.theme.colors.muted};">${esc(s.value ?? 0)}</span>
        <div style="width:${barW - 8}px;height:${h}px;background:${fill};border-radius:3px 3px 0 0;"></div>
        <span style="font-size:9pt;color:${env.theme.colors.text};max-width:${barW}px;text-align:center;line-height:1.1;word-break:break-word;">${esc(s.label ?? '')}</span>
      </div>`;
    })
    .join('');
  const title = b.props.title
    ? `<h4 style="font-size:13pt;margin:0 0 8px 0;color:${env.theme.colors.text};">${esc(resolveToken(b.props.title, env.ctx))}</h4>`
    : '';
  return `
    <div style="${styleToCss(b.style)}">
      ${title}
      <div style="display:flex;gap:8px;align-items:flex-end;height:${heightPx}px;border-bottom:1px solid ${env.theme.colors.muted};padding-bottom:2px;">
        ${items}
      </div>
    </div>
  `;
}

function renderLineChart(
  b: Extract<Block, { type: 'line-chart' }>,
  env: RenderEnv,
): string {
  const points = (
    resolveArray(b.props.points, env.ctx) as Array<{
      x?: string | number;
      y?: number;
    }>
  ).filter((p) => p && Number.isFinite(Number(p.y)));
  const heightPx = parseSize(b.props.height, 160);
  const widthPx = 360;
  const padX = 24,
    padY = 12;
  const innerW = widthPx - padX * 2;
  const innerH = heightPx - padY * 2;
  const ys = points.map((p) => num(p.y));
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(...ys, minY + 1);
  const xStep = points.length > 1 ? innerW / (points.length - 1) : innerW;
  const color = b.props.color || env.theme.colors.brand;
  const coords = points.map((p, i) => {
    const x = padX + i * xStep;
    const y = padY + innerH - ((num(p.y) - minY) / (maxY - minY)) * innerH;
    return { x, y, label: String(p.x ?? '') };
  });
  const path = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const dots = coords
    .map((c) => `<circle cx="${c.x}" cy="${c.y}" r="3" fill="${color}" />`)
    .join('');
  const labels = coords
    .map(
      (c) =>
        `<text x="${c.x}" y="${heightPx - 2}" text-anchor="middle" font-size="9" fill="${env.theme.colors.muted}">${esc(c.label)}</text>`,
    )
    .join('');
  const title = b.props.title
    ? `<h4 style="font-size:13pt;margin:0 0 8px 0;color:${env.theme.colors.text};">${esc(resolveToken(b.props.title, env.ctx))}</h4>`
    : '';
  return `
    <div style="${styleToCss(b.style)}">
      ${title}
      <svg width="${widthPx}" height="${heightPx}" viewBox="0 0 ${widthPx} ${heightPx}">
        <path d="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        ${dots}
        ${labels}
      </svg>
    </div>
  `;
}

function parseSize(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

// ─── Flow control ───────────────────────────────────────────────────────

function renderRepeat(
  b: Extract<Block, { type: 'repeat' }>,
  env: RenderEnv,
): string {
  const items = resolveArray(b.props.items, env.ctx);
  const out: string[] = [];
  for (const item of items) {
    const childCtx: ResolverCtx = {
      root: env.ctx.root,
      loops: [...env.ctx.loops, { [b.props.as]: item }],
    };
    // Each iteration is wrapped so an item never splits across pages —
    // the body of a per-test report stays on one page even when the
    // surrounding repeat overflows.
    out.push(
      `<div class="pdfv2-repeat-item">${renderBlocks(b.props.blocks, { ...env, ctx: childCtx })}</div>`,
    );
  }
  return `<div style="${styleToCss(b.style)}">${out.join('')}</div>`;
}

function renderConditional(
  b: Extract<Block, { type: 'conditional' }>,
  env: RenderEnv,
): string {
  if (!evalCondition(b.props.when, env.ctx)) return '';
  return `<div class="pdfv2-conditional" style="${styleToCss(b.style)}">${renderBlocks(b.props.blocks, env)}</div>`;
}
