/**
 * Helpers for inlining remote `<img>` sources in Puppeteer header/footer
 * templates as base64 data URIs.
 *
 * ## Why this exists
 * Chromium renders a `page.pdf({ headerTemplate, footerTemplate })` template in
 * an ISOLATED document painted into the page margins. That context does not
 * inherit the body's stylesheet (already handled elsewhere) and — critically —
 * does NOT issue or await network requests: a remote `<img src="https://…">`
 * there is never fetched and shows as a broken image. The body, by contrast, is
 * loaded via `setContent(..., { waitUntil: 'load' })`, which DOES wait for
 * referenced resources — which is exactly why the same image renders in the body
 * but breaks in the header/footer.
 *
 * The reliable fix is to embed the bytes directly as a `data:` URI so no network
 * fetch is needed at print time. This module does the pure string rewriting; the
 * actual byte fetching is injected so it stays trivially unit-testable.
 */

/**
 * Fetches an image URL and returns its raw bytes + MIME type, or `null` if it
 * could not be fetched (network error, non-2xx, empty body). Injected into
 * {@link inlineRemoteImages} so the rewrite logic is testable without real IO.
 */
export type ImageFetcher = (
  url: string,
) => Promise<{ data: Buffer; contentType: string } | null>;

/**
 * Matches an `<img …src="…">` and captures the pre-src markup, the src value,
 * and the closing quote so a replacement can swap ONLY the URL. Global +
 * case-insensitive; `[^>]*?` keeps the match within a single tag.
 */
const IMG_SRC_RE = /(<img\b[^>]*?\bsrc\s*=\s*")([^"]+)(")/gi;

/**
 * Decode the HTML entities that `escapeAttr` introduces when the renderer writes
 * a URL into an attribute (`&amp;`, `&quot;`, `&lt;`, `&gt;`), so the URL can be
 * fetched as-is. `&amp;` is decoded last to avoid double-decoding.
 * @param value the escaped attribute value
 * @returns the raw URL
 */
export function decodeHtmlAttr(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** True for an absolute `http(s)://` URL (the only case we need to inline). */
export function isRemoteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/**
 * Replace every remote `<img src="http(s)://…">` in a Puppeteer header/footer
 * template with a base64 `data:` URI, fetching the bytes via `fetcher`. Each
 * distinct URL is fetched once (deduped). Sources that are already `data:` URIs,
 * relative/other-scheme URLs, or that fail to fetch are left untouched — so a
 * broken URL degrades to the current behaviour rather than throwing.
 * @param template the header/footer template HTML
 * @param fetcher resolves a URL to its bytes + MIME (or null on failure)
 * @returns the template with remote image sources inlined
 */
export async function inlineRemoteImages(
  template: string,
  fetcher: ImageFetcher,
): Promise<string> {
  if (!template || !template.includes('<img')) {
    return template;
  }
  // Collect the distinct escaped src attribute values that point at a remote URL.
  const attrUrls = new Set<string>();
  for (const match of template.matchAll(IMG_SRC_RE)) {
    const attr = match[2];
    if (attr && isRemoteUrl(decodeHtmlAttr(attr))) {
      attrUrls.add(attr);
    }
  }
  if (attrUrls.size === 0) {
    return template;
  }
  // Fetch each unique URL once, keyed by its original (escaped) attribute value.
  const dataUris = new Map<string, string>();
  await Promise.all(
    [...attrUrls].map(async (attr) => {
      const fetched = await fetcher(decodeHtmlAttr(attr));
      if (fetched && fetched.data.length > 0) {
        dataUris.set(
          attr,
          `data:${fetched.contentType};base64,${fetched.data.toString('base64')}`,
        );
      }
    }),
  );
  if (dataUris.size === 0) {
    return template;
  }
  // Swap only the src value; base64 has no `$`, so string replacement is safe.
  return template.replace(
    IMG_SRC_RE,
    (whole, pre: string, attr: string, post: string) => {
      const dataUri = dataUris.get(attr);
      return dataUri ? `${pre}${dataUri}${post}` : whole;
    },
  );
}

/** Best-effort MIME from a URL's file extension when the response omits one. */
export function guessImageMime(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'gif':
      return 'image/gif';
    case 'svg':
      return 'image/svg+xml';
    case 'webp':
      return 'image/webp';
    case 'bmp':
      return 'image/bmp';
    case 'png':
    default:
      return 'image/png';
  }
}
