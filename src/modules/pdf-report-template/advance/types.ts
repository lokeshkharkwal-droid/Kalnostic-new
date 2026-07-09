/**
 * Document model for the Advance PDF Template engine.
 *
 * Each pdf_template row with engine='advance' stores one of these as its
 * `meta` LongText (CJSON-encoded). The renderer reads it, walks the
 * blocks, resolves tokens against a context-specific data bag, and
 * pipes the resulting HTML through Puppeteer.
 *
 * Compared to the legacy `pdf_template.meta` (HTML body + token list),
 * the advance document is fully structured: every block is a typed
 * unit with explicit style overrides, and headers/footers/background
 * are first-class. New block types can be added without a DB migration
 * because the schema is JSON inside `meta`.
 */

// ─── Document root ──────────────────────────────────────────────────────

export interface AdvanceDocument {
  /** Schema version — bump when a breaking change lands in this file. */
  version: 1;
  page: PageSettings;
  theme: Theme;
  /** Repeats on every page. Empty array = no header. */
  header: RepeatRegion;
  /** Repeats on every page. */
  footer: RepeatRegion;
  /** Flows across pages. Page breaks happen automatically; insert a
   *  `page-break` block to force one. */
  body: { blocks: Block[] };
}

export interface PageSettings {
  size: 'A4' | 'A5' | 'Letter' | 'Legal';
  orientation: 'portrait' | 'landscape';
  margins: { top: string; right: string; bottom: string; left: string };
  /** Optional cover-style background — image URL OR a flat color. */
  background?: { image?: string; color?: string; fit?: 'cover' | 'contain' };
  /** Defaults inherited by every block unless overridden in `style`. */
  default_font: { family: string; size: number; color: string };
}

export interface Theme {
  colors: {
    brand: string;
    muted: string;
    danger: string;
    warning: string;
    success: string;
    bg: string;
    text: string;
  };
  fonts: { heading: string; body: string };
}

export interface RepeatRegion {
  /** Reserved vertical space (CSS unit, e.g. '22mm'). */
  height: string;
  blocks: Block[];
}

// ─── Block style overrides ──────────────────────────────────────────────

export interface BlockStyle {
  font_family?: string;
  font_size?: number; // pt
  font_weight?: number | 'normal' | 'bold';
  font_style?: 'normal' | 'italic';
  color?: string;
  background?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  padding?:
    | string
    | { top?: string; right?: string; bottom?: string; left?: string };
  margin?:
    | string
    | { top?: string; right?: string; bottom?: string; left?: string };
  width?: string; // '100%', '50%', '120mm'
  border?: string; // CSS border shorthand
  border_radius?: string;
  text_transform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  line_height?: number | string;
  letter_spacing?: string;
}

// ─── Block taxonomy ─────────────────────────────────────────────────────

export type Block =
  | HeadingBlock
  | ParagraphBlock
  | KvBlock
  | DividerBlock
  | SpacerBlock
  | PageBreakBlock
  | ImageBlock
  | LogoBlock
  | QrBlock
  | SignatureBlock
  | ColumnsBlock
  | SectionBlock
  | TableBlock
  | ParametersTableBlock
  | RangeBarBlock
  | ScoreCircleBlock
  | StatusPillBlock
  | ResultCardBlock
  | NoteCardBlock
  | OrganDiagramBlock
  | DonutChartBlock
  | BarChartBlock
  | LineChartBlock
  | RepeatBlock
  | ConditionalBlock
  | PageNumberBlock;

interface BaseBlock {
  /** Unique within the document — used by the editor to track selection. */
  id: string;
  style?: BlockStyle;
}

// Layout
export interface SectionBlock extends BaseBlock {
  type: 'section';
  props: { blocks: Block[] };
}
export interface ColumnsBlock extends BaseBlock {
  type: 'columns';
  props: {
    /** One entry per column. Width supports CSS values; flex defaults to 1. */
    columns: Array<{ width?: string; blocks: Block[] }>;
    /** Gap between columns. */
    gap?: string;
  };
}
export interface DividerBlock extends BaseBlock {
  type: 'divider';
  props: { thickness?: string; color?: string };
}
export interface SpacerBlock extends BaseBlock {
  type: 'spacer';
  props: { height: string };
}
export interface PageBreakBlock extends BaseBlock {
  type: 'page-break';
  props: Record<string, never>;
}

// Text
export interface HeadingBlock {
  id: string;
  type: 'heading';
  props: { level: 1 | 2 | 3 | 4; text: string };
  style?: BlockStyle;
}
export interface ParagraphBlock {
  id: string;
  type: 'paragraph';
  props: { text: string };
  style?: BlockStyle;
}
export interface KvBlock {
  id: string;
  type: 'kv';
  props: { label: string; value: string };
  style?: BlockStyle;
}

// Media
export interface ImageBlock {
  id: string;
  type: 'image';
  props: {
    src: string;
    alt?: string;
    width?: string;
    height?: string;
    fit?: 'cover' | 'contain';
  };
  style?: BlockStyle;
}
export interface LogoBlock {
  id: string;
  type: 'logo';
  props: { width?: string };
  style?: BlockStyle;
}
export interface QrBlock {
  id: string;
  type: 'qr';
  props: { value: string; size?: string };
  style?: BlockStyle;
}
export interface SignatureBlock {
  id: string;
  type: 'signature';
  props: { name: string; title?: string; src?: string };
  style?: BlockStyle;
}

// Tabular
export interface TableBlock {
  id: string;
  type: 'table';
  props: {
    columns: Array<{ key: string; label: string; width?: string }>;
    /** Token reference resolving to an array, or inline rows. */
    rows: string | Array<Record<string, string>>;
    striped?: boolean;
  };
  style?: BlockStyle;
}
export interface ParametersTableBlock {
  id: string;
  type: 'parameters-table';
  props: {
    /** Token reference to the array (e.g. `tests[0].results` or `normal_results`). */
    items: string;
    /** Visible columns. Defaults to ['name','value','range']. */
    columns?: Array<'status' | 'name' | 'value' | 'unit' | 'range'>;
  };
  style?: BlockStyle;
}

// Visualizations
export interface RangeBarBlock {
  id: string;
  type: 'range-bar';
  props: {
    title?: string;
    /** Numeric tokens or literal numbers. */
    value: string | number;
    low?: string | number; // start of "low" range (=== high-end of below-low)
    normal_low?: string | number;
    normal_high?: string | number;
    high?: string | number; // end of "high" range
    unit?: string;
    /** Optional caption under the bar. */
    description?: string;
  };
  style?: BlockStyle;
}
export interface ScoreCircleBlock {
  id: string;
  type: 'score-circle';
  props: { value: string | number; max?: string | number; label?: string };
  style?: BlockStyle;
}
export interface StatusPillBlock {
  id: string;
  type: 'status-pill';
  props: {
    /** Typically 'normal' | 'borderline' | 'abnormal', but any string is allowed. */
    status: string;
    label?: string;
  };
  style?: BlockStyle;
}

/**
 * Rich one-result visualisation card. Drop inside a `repeat` over a
 * `results[]` array and bind `item` to the iteration variable.
 *
 * The renderer auto-decides the layout from the item's fields:
 *   - value parses numeric AND ref_normal_low/ref_normal_high are
 *     defined → renders the low/normal/high range bar with a marker
 *     at the value
 *   - otherwise → renders just the colored value chip
 *   - if `abnormal_reason` is present on the item → renders the
 *     bordered "Common Abnormal Reasons" callout below the bar
 *
 * The item shape it expects (matches LabReportContextData['tests'][n]['results'][m]):
 *   { name, value, unit, status, ref_low, ref_normal_low,
 *     ref_normal_high, ref_high, range, abnormal_reason }
 */
export interface ResultCardBlock {
  id: string;
  type: 'result-card';
  props: {
    /** Token resolving to a single result object (e.g. `{r}` inside a
     *  repeat with `as: 'r'` over `{test.results}`). */
    item: string;
    /** Optional descriptive token rendered as muted text below the
     *  heading. Templates use this to surface a per-parameter blurb. */
    description?: string;
    /** Title above the abnormal-reason callout. Defaults to the
     *  legacy "Common Abnormal Reasons" copy. */
    reason_title?: string;
  };
  style?: BlockStyle;
}

/**
 * Generic rich-text note callout — title + bordered "i" box. Used for
 * surfacing the sample-group level notes (`{test.test_note}`,
 * `{test.overall_result_note}`, `{test.test_comment}`) and any other
 * HTML content from a WYSIWYG field.
 *
 * `content` is treated as HTML (sanitised before rendering — same
 * allow-list as `result-card`'s reason callout). When the resolved
 * content is empty/whitespace and `hide_when_empty` is true (default),
 * the block emits nothing — handy inside a `repeat` so an empty note
 * doesn't leave a stranded heading on the page.
 */
export interface NoteCardBlock {
  id: string;
  type: 'note-card';
  props: {
    title: string;
    content: string;
    /** Default: true. */
    hide_when_empty?: boolean;
  };
  style?: BlockStyle;
}

/**
 * Body-silhouette diagram with organ status pills around it. `items`
 * accepts an array token (e.g. `{organs}` from the lab-report context)
 * — each entry should expose `name` + `status` ('normal' / 'borderline'
 * / 'abnormal'). Items are split between the left and right gutters
 * automatically; if more than 8 items are present the renderer
 * truncates rather than overflowing.
 */
export interface OrganDiagramBlock {
  id: string;
  type: 'organ-diagram';
  props: { items: string; title?: string };
  style?: BlockStyle;
}

/** Donut chart — `slices` is a JSON token resolving to
 *  `Array<{ label: string; value: number; color?: string }>`. Total
 *  shown in the centre. */
export interface DonutChartBlock {
  id: string;
  type: 'donut-chart';
  props: { slices: string; title?: string; size?: string };
  style?: BlockStyle;
}

/** Vertical bar chart — same shape as donut but rendered as bars.
 *  Per-bar `color` overrides the theme brand colour. */
export interface BarChartBlock {
  id: string;
  type: 'bar-chart';
  props: { bars: string; title?: string; height?: string };
  style?: BlockStyle;
}

/** Line chart — `points` resolves to `Array<{ x: string|number;
 *  y: number }>`. Optional `series` for multi-line — defers, single
 *  line for v1. */
export interface LineChartBlock {
  id: string;
  type: 'line-chart';
  props: { points: string; title?: string; height?: string; color?: string };
  style?: BlockStyle;
}

/**
 * Live page-number block. Only meaningful inside the document's
 * `header` or `footer` regions — Puppeteer fills in `pageNumber` /
 * `totalPages` spans there, not in the body.
 *
 * `format` accepts `{n}` for the current page and `{total}` for the
 * total page count. Default: 'Page {n} of {total}'. Anything else in
 * the format string is treated as literal text.
 */
export interface PageNumberBlock {
  id: string;
  type: 'page-number';
  props: { format?: string };
  style?: BlockStyle;
}

// Flow control
export interface RepeatBlock {
  id: string;
  type: 'repeat';
  props: {
    /** Token resolving to an array. */
    items: string;
    /** Iteration variable name — child blocks reference `{<as>.field}`. */
    as: string;
    blocks: Block[];
  };
  style?: BlockStyle;
}
export interface ConditionalBlock {
  id: string;
  type: 'conditional';
  props: {
    /** Boolean expression. Supports:
     *    - `<token>`                       truthy check
     *    - `!<token>`                      falsy check
     *    - `<token> [==|!=|<|<=|>|>=] X`   comparison (numeric when both sides parse)
     *    - `A && B`, `A || B`              left-to-right, `&&` binds tighter than `||`
     *  No parentheses; no nested function calls. See `evalCondition`. */
    when: string;
    blocks: Block[];
  };
  style?: BlockStyle;
}

// ─── Context types ──────────────────────────────────────────────────────

/** Every advance template targets one of these context types. The
 *  data builder loaded from `contexts/` returns a typed bag. */
export type AdvanceContextType = 'lab_report' | 'order_invoice' | 'order_bill';

/** Generic shape — concrete contexts (e.g. LabReportContext) extend this. */
export interface AdvanceContext {
  branch: {
    name: string;
    address: string;
    phone: string;
    email: string;
    logo: string;
  };
  patient: {
    full_name: string;
    age: string;
    gender: string;
    registration_no: string;
  };
  order: {
    display_id: string;
    date: string;
  };
  /** Free-form bag for context-specific fields (tests[], score, etc.). */
  extra: Record<string, unknown>;
}
