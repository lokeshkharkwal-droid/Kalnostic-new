import sanitizeHtml from 'sanitize-html';

/**
 * Cleaning of the rich-text notes (the Notes editor's HTML) before they are stored.
 *
 * The notes are inserted UNESCAPED into the printed report (`RICH_TEXT_KEYS` in `template-render.service`) and the
 * report is opened in a headless browser, so stored markup must never carry anything active: scripts, event handlers
 * (`onerror=…`), `javascript:` links, iframes, `<style>` blocks, or CSS that fetches a URL. The editor itself only ever
 * produces formatting, so an allowlist of that formatting loses nothing a person can type.
 *
 * The tag and attribute lists MIRROR the frontend's `sanitizeRichTextHTML` (`src/utils/security.ts`), which cleans the
 * same markup when it is shown on screen — keep the two in step. Two things are stricter than the screen: links may
 * only be http(s), mailto or tel, and a `style` attribute keeps only plain presentation properties (never `url(…)`).
 *
 * Plain text, a value with no markup and an empty string come back unchanged.
 */

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'u',
  's',
  'a',
  'img',
  'ul',
  'ol',
  'li',
  'blockquote',
  'code',
  'pre',
  'span',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'div',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'sub',
  'sup',
  'mark',
  'b',
  'i',
  'del',
  'ins',
  'strike',
  'caption',
  'tfoot',
  'colgroup',
  'col',
];

/**
 * A CSS value is accepted when it holds no `;`, braces, angle brackets or backslash (CSS escapes), and calls no function
 * that can load or compute something (`url()`, `expression()`, `image-set()`, `attr()`, `var()`). Colours such as
 * `rgb(0, 0, 0)` and lengths such as `calc(…)`-free sizes still pass.
 */
const SAFE_STYLE_VALUE =
  /^(?!.*(?:url|expression|image-set|attr|var)\s*\()[^;{}<>\\]*$/i;

/** Presentation properties the editor's toolbar and table dialogs write into `style`. */
const STYLE_PROPERTIES = [
  'color',
  'background-color',
  'font-family',
  'font-size',
  'font-style',
  'font-weight',
  'line-height',
  'text-align',
  'text-decoration',
  'text-indent',
  'vertical-align',
  'white-space',
  'width',
  'height',
  'float',
  'border',
  'border-top',
  'border-right',
  'border-bottom',
  'border-left',
  'border-color',
  'border-style',
  'border-width',
  'border-collapse',
  'border-spacing',
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'list-style-type',
];

const ALLOWED_STYLES = {
  '*': Object.fromEntries(STYLE_PROPERTIES.map((p) => [p, [SAFE_STYLE_VALUE]])),
};

/**
 * Remove everything active from a rich-text note and keep its formatting.
 *
 * @param html the HTML as sent by the client
 * @returns the cleaned HTML; a disallowed tag is dropped (its text stays, except `script`/`style`, whose content goes too)
 */
export function sanitizeRichText(html: string): string {
  if (html === '') return html;
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: {
      '*': ['class', 'style', 'title', 'data-type'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      table: ['width', 'height'],
      td: ['colspan', 'rowspan', 'width', 'height'],
      th: ['colspan', 'rowspan', 'width', 'height'],
      col: ['span', 'width'],
      colgroup: ['span', 'width'],
      ol: ['start'],
    },
    allowedStyles: ALLOWED_STYLES,
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    // The screen's sanitiser also lets an image carry a data: URI (an older note may have one); an image cannot run code.
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
  });
}
