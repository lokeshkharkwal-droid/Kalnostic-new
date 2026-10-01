import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser, PDFOptions, Page } from 'puppeteer';
import {
  ImageFetcher,
  guessImageMime,
  inlineRemoteImages,
  isRemoteUrl,
} from './pdf-image-inline.util';
import {
  PdfEmbedSource,
  PdfFetcher,
  embedMarkerUrl,
  fileNameFromUrl,
  fitSlotPx,
  isPdfEmbed,
  newEmbedMarkerPrefix,
  overlayEmbeddedPdfs,
  readPdfEmbedSource,
} from './pdf-embed.util';

/** One PDF `<embed>` found in the body, as reported by the page. */
interface FoundPdfEmbed {
  idx: number;
  src: string;
  type: string;
  title: string;
}

/** DOM rewrite for one PDF `<embed>` (see {@link PdfService.expandPdfEmbeds}). */
interface PdfEmbedPlan {
  idx: number;
  /** One slot per source page, in CSS px, with its marker link. */
  slots: Array<{ width: number; height: number; href: string }>;
}

/** An `<embed>` whose PDF couldn't be fetched/parsed: printed as a link instead. */
interface PdfEmbedFallback {
  idx: number;
  src: string;
  label: string;
}

/**
 * Shared PDF generation service backed by Puppeteer (headless Chromium),
 * ported from kaltros-master. Wire it via `PdfModule` and inject it — never
 * instantiate it directly (CLAUDE.md rule #3).
 *
 * A single headless Chromium instance is launched lazily and reused across
 * requests (launching is expensive); it is torn down on module destroy.
 *
 * ## Production / Docker
 * Set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (or equivalent) and
 * `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true` to use a system Chromium. In
 * development, Puppeteer uses its own bundled Chromium.
 */
@Injectable()
export class PdfService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: Browser | null = null;

  /** How long to wait for a single header/footer image fetch before giving up. */
  private static readonly IMAGE_FETCH_TIMEOUT_MS = 10_000;
  /** Extra clearance (mm) kept between header/footer content and the body. */
  private static readonly EDGE_BODY_GAP_MM = 4;
  /** Cap the auto-grown header/footer band at this fraction of the page height. */
  private static readonly MAX_EDGE_FRACTION = 0.45;
  /** Max distinct image URLs kept as inlined data URIs (immutable upload keys). */
  private static readonly IMAGE_CACHE_MAX = 200;
  /**
   * URL → base64 data URI cache. Uploaded images live at content-addressed keys
   * (a URL's bytes never change), so caching across requests is safe and avoids
   * re-fetching a shared logo on every print. Bounded by `IMAGE_CACHE_MAX`.
   */
  private readonly imageDataUriCache = new Map<string, string>();
  /** How long to wait for one embedded-PDF fetch before giving up. */
  private static readonly EMBED_FETCH_TIMEOUT_MS = 20_000;
  /** Largest embedded PDF fetched (uploads are capped at 10 MB; headroom for other sources). */
  private static readonly EMBED_MAX_BYTES = 15 * 1024 * 1024;

  /**
   * Render a complete HTML document to a PDF buffer. The caller is responsible
   * for producing a full document (`<html><head><style>…</head><body>…`);
   * Puppeteer loads it, waits for network idle, then prints to PDF.
   * @param html complete HTML document string
   * @param options Puppeteer PDF options (format, landscape, margins, …) merged
   *   over the defaults
   * @returns the PDF bytes as a Buffer
   */
  async htmlToPdf(html: string, options?: PDFOptions): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      // Load HTML directly — no external URLs needed (images are inline/base64).
      // `setContent` doesn't accept `networkidle*`; `load` waits for referenced
      // resources (inline images/fonts) to finish.
      await page.setContent(html, { waitUntil: 'load' });
      // Chromium renders the header/footer templates in an isolated context that
      // never fetches remote resources, so a remote `<img>` there would print as
      // a broken image (the body works only because `setContent`+`load` fetches
      // its images). Inline those images as base64 data URIs first.
      const inlined = await this.inlineHeaderFooterImages(options);
      // Then grow the top/bottom page margins to fit the (now fully rendered)
      // header/footer so their content is never crushed into — or overlapped by —
      // the body, regardless of template size (mPDF `setAutoTopMargin` analogue).
      const pdfOptions = await this.fitHeaderFooterMargins(browser, inlined);
      const finalOptions: PDFOptions = {
        format: 'A4',
        printBackground: true, // render CSS background-color / background-image
        margin: { top: '10mm', bottom: '12mm', left: '12mm', right: '12mm' },
        ...pdfOptions,
      };
      // Chromium prints a PDF `<embed>` as an empty grey box; lay each one out
      // as page-sized slots now (needs the final margins, hence after the
      // auto-fit) and draw the real pages into them after printing.
      const embeds = await this.expandPdfEmbeds(page, finalOptions);
      const pdf = await page.pdf(finalOptions);
      if (!embeds) {
        return Buffer.from(pdf);
      }
      try {
        return Buffer.from(
          await overlayEmbeddedPdfs(pdf, embeds.sources, embeds.prefix),
        );
      } catch (e) {
        this.logger.warn(
          `Drawing embedded PDFs failed; returning the report without them: ${
            (e as Error).message
          }`,
        );
        return Buffer.from(pdf);
      }
    } finally {
      await page.close().catch((e) => {
        this.logger.warn('Failed to close Puppeteer page cleanly', e);
      });
    }
  }

  /**
   * Return `options` with every remote `<img>` in the header/footer templates
   * rewritten to a base64 data URI (see {@link inlineRemoteImages}). Only runs
   * when `displayHeaderFooter` is set — a body-only PDF has no margin templates
   * to fix — so ordinary documents pay nothing. Failures to fetch a given image
   * are logged and left as the original URL (no worse than before this fix).
   */
  private async inlineHeaderFooterImages(
    options?: PDFOptions,
  ): Promise<PDFOptions | undefined> {
    if (!options?.displayHeaderFooter) {
      return options;
    }
    const [headerTemplate, footerTemplate] = await Promise.all([
      inlineRemoteImages(options.headerTemplate ?? '', this.imageFetcher),
      inlineRemoteImages(options.footerTemplate ?? '', this.imageFetcher),
    ]);
    return { ...options, headerTemplate, footerTemplate };
  }

  /**
   * Grow the top/bottom page margins so the (natural-height) header/footer
   * templates always fit — the Puppeteer analogue of mPDF's
   * `setAutoTopMargin = 'stretch'`. Chromium reserves exactly `margin.top` /
   * `margin.bottom` for the header/footer and clips anything taller, so a real
   * letterhead in a template built with the small default margins would be
   * crushed and appear to collide with the body. Here we measure each template's
   * rendered height and set the margin to at least that height plus a small body
   * gap, keeping the template's configured margin as a floor and clamping the
   * result to {@link MAX_EDGE_FRACTION} of the page height.
   *
   * Only runs when `displayHeaderFooter` is set; any failure degrades to the
   * incoming margins (no worse than before). Must run AFTER
   * {@link inlineHeaderFooterImages} so measured heights include the images.
   */
  private async fitHeaderFooterMargins(
    browser: Browser,
    options?: PDFOptions,
  ): Promise<PDFOptions | undefined> {
    if (!options?.displayHeaderFooter) {
      return options;
    }
    try {
      const pageWidthMm = this.parseMm(options.width, 210);
      const pageHeightMm = this.parseMm(options.height, 297);
      const maxEdgeMm = pageHeightMm * PdfService.MAX_EDGE_FRACTION;
      const [headerMm, footerMm] = await Promise.all([
        this.measureTemplateHeightMm(
          browser,
          options.headerTemplate,
          pageWidthMm,
        ),
        this.measureTemplateHeightMm(
          browser,
          options.footerTemplate,
          pageWidthMm,
        ),
      ]);
      const margin = { ...(options.margin ?? {}) };
      if (headerMm > 0) {
        margin.top = this.fitEdge(margin.top, headerMm, maxEdgeMm);
      }
      if (footerMm > 0) {
        margin.bottom = this.fitEdge(margin.bottom, footerMm, maxEdgeMm);
      }
      return { ...options, margin };
    } catch (e) {
      this.logger.warn(
        `Header/footer margin auto-fit failed; using configured margins: ${
          (e as Error).message
        }`,
      );
      return options;
    }
  }

  /**
   * Resolve one edge margin (mm string) to fit measured content: at least the
   * configured margin, at least `contentMm` + a body gap, never above `maxMm`.
   */
  private fitEdge(
    current: string | number | undefined,
    contentMm: number,
    maxMm: number,
  ): string {
    const floor = this.parseMm(current, 10);
    const needed = contentMm + PdfService.EDGE_BODY_GAP_MM;
    const resolved = Math.min(maxMm, Math.max(floor, needed));
    return `${Math.ceil(resolved * 100) / 100}mm`;
  }

  /**
   * Measure the rendered height (mm) of a header/footer template at the page's
   * width, by laying it out in a throwaway page. Returns 0 for an empty template.
   */
  private async measureTemplateHeightMm(
    browser: Browser,
    template: string | undefined,
    pageWidthMm: number,
  ): Promise<number> {
    if (!template || !template.includes('<')) {
      return 0;
    }
    const page = await browser.newPage();
    try {
      const widthPx = Math.max(1, Math.round((pageWidthMm * 96) / 25.4));
      await page.setViewport({
        width: widthPx,
        height: 200,
        deviceScaleFactor: 1,
      });
      await page.setContent(template, { waitUntil: 'load' });
      const heightPx = await page.evaluate(() => {
        const el = document.querySelector('.pdf-header, .pdf-footer');
        const rect = el ? el.getBoundingClientRect().height : 0;
        return Math.ceil(Math.max(rect, document.body.scrollHeight));
      });
      return (heightPx * 25.4) / 96;
    } finally {
      await page.close().catch((e) => {
        this.logger.warn('Failed to close measurement page cleanly', e);
      });
    }
  }

  /**
   * Lay out every PDF `<embed>` in the loaded body for printing (see
   * `pdf-embed.util.ts` for why Chromium needs this). Each `<embed>` pointing at
   * a remote PDF is fetched and parsed, then replaced by one slot per source
   * page, sized to that page's aspect ratio within the printable area and
   * overlaid with a marker link. The original `<embed>` moves into the first
   * slot; the other slots get none, because every extra `<embed>` would start
   * its own PDF-viewer instance only to print a grey box. An embed whose file
   * can't be fetched or parsed becomes a plain "Attached file" link instead.
   *
   * Returns `null` when nothing needs drawing, so a body without PDF embeds
   * costs one DOM query and nothing else.
   * @returns this render's marker prefix + parsed sources for `overlayEmbeddedPdfs`
   */
  private async expandPdfEmbeds(
    page: Page,
    options: PDFOptions,
  ): Promise<{ prefix: string; sources: Map<number, PdfEmbedSource> } | null> {
    const found: FoundPdfEmbed[] = await page.$$eval('embed', (els) =>
      els.map((el, idx) => {
        el.setAttribute('data-pdf-embed-idx', String(idx));
        return {
          idx,
          src: el.src,
          type: el.getAttribute('type') ?? '',
          title: el.getAttribute('title') ?? '',
        };
      }),
    );
    const pdfEmbeds = found.filter(
      (e) => isRemoteUrl(e.src) && isPdfEmbed(e.src, e.type),
    );
    if (pdfEmbeds.length === 0) {
      return null;
    }

    // Fetch + parse each distinct file once, even if it is embedded twice.
    const bySrc = new Map<string, Promise<PdfEmbedSource | null>>();
    for (const e of pdfEmbeds) {
      if (!bySrc.has(e.src)) {
        bySrc.set(
          e.src,
          this.pdfFetcher(e.src).then((bytes) =>
            bytes ? readPdfEmbedSource(bytes) : null,
          ),
        );
      }
    }
    const box = this.contentBoxPx(options);
    const prefix = newEmbedMarkerPrefix();
    const sources = new Map<number, PdfEmbedSource>();
    const plans: PdfEmbedPlan[] = [];
    const fallbacks: PdfEmbedFallback[] = [];
    for (const e of pdfEmbeds) {
      const source = await bySrc.get(e.src);
      if (!source) {
        this.logger.warn(
          `Embedded PDF could not be rendered; printing a link instead: ${e.src}`,
        );
        fallbacks.push({
          idx: e.idx,
          src: e.src,
          label: e.title || fileNameFromUrl(e.src),
        });
        continue;
      }
      sources.set(e.idx, source);
      plans.push({
        idx: e.idx,
        slots: source.pageSizes.map((size, pageIdx) => ({
          ...fitSlotPx(size, box),
          href: embedMarkerUrl(prefix, e.idx, pageIdx),
        })),
      });
    }

    await page.evaluate(
      (planList: PdfEmbedPlan[], fallbackList: PdfEmbedFallback[]) => {
        const find = (idx: number) =>
          document.querySelector<HTMLElement>(
            `embed[data-pdf-embed-idx="${idx}"]`,
          );
        for (const plan of planList) {
          const embed = find(plan.idx);
          if (!embed) {
            continue;
          }
          const wrapper = document.createElement('div');
          wrapper.className = 'pdf-embed-document';
          embed.replaceWith(wrapper);
          plan.slots.forEach((slot, i) => {
            const box = document.createElement('div');
            box.className = 'pdf-embed-page';
            box.style.cssText = `position:relative;width:${slot.width}px;max-width:100%;height:${slot.height}px;margin:0 auto;break-inside:avoid;page-break-inside:avoid;`;
            if (i === 0) {
              embed.style.cssText =
                'display:block;width:100%;height:100%;border:0;';
              box.append(embed);
            }
            const marker = document.createElement('a');
            marker.href = slot.href;
            marker.style.cssText = 'position:absolute;inset:0;display:block;';
            box.append(marker);
            wrapper.append(box);
          });
        }
        for (const f of fallbackList) {
          const embed = find(f.idx);
          if (!embed) {
            continue;
          }
          const note = document.createElement('div');
          note.className = 'pdf-embed-fallback';
          const link = document.createElement('a');
          link.href = f.src;
          link.textContent = f.label;
          note.append('Attached file: ', link);
          embed.replaceWith(note);
        }
      },
      plans,
      fallbacks,
    );
    return sources.size > 0 ? { prefix, sources } : null;
  }

  /**
   * The printable body area in CSS px for the final print options: the page
   * size (explicit `width`/`height`, else A4, swapped for `landscape`) minus the
   * margins, divided by `scale` (Chromium lays the body out at 1/scale).
   */
  private contentBoxPx(options: PDFOptions): { width: number; height: number } {
    let widthMm = this.parseMm(options.width, 210);
    let heightMm = this.parseMm(options.height, 297);
    if (
      options.landscape &&
      options.width === undefined &&
      options.height === undefined
    ) {
      [widthMm, heightMm] = [heightMm, widthMm];
    }
    const m = options.margin ?? {};
    const toPx = (mm: number) => (mm * 96) / 25.4 / (options.scale ?? 1);
    return {
      width: toPx(widthMm - this.parseMm(m.left, 0) - this.parseMm(m.right, 0)),
      height: toPx(
        heightMm - this.parseMm(m.top, 0) - this.parseMm(m.bottom, 0),
      ),
    };
  }

  /**
   * Parse a Puppeteer margin/size value (`"12mm"`, `"48px"`, a bare number, …) to
   * millimetres, falling back to `fallback` when it can't be read. `px` is
   * converted at 96dpi; unit-less and `mm` values are taken as millimetres.
   */
  private parseMm(
    value: string | number | undefined,
    fallback: number,
  ): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n)) {
        return /px\s*$/i.test(value) ? (n * 25.4) / 96 : n;
      }
    }
    return fallback;
  }

  /**
   * Fetch an image URL to its bytes + MIME for inlining, with a bounded
   * cross-request cache and a hard timeout. Returns `null` on any failure so the
   * caller degrades gracefully (keeps the original URL). Bound as a field so it
   * can be passed as a plain function to the pure inliner.
   */
  private readonly imageFetcher: ImageFetcher = async (url) => {
    const cached = this.imageDataUriCache.get(url);
    if (cached) {
      const comma = cached.indexOf(',');
      return {
        data: Buffer.from(cached.slice(comma + 1), 'base64'),
        contentType: cached.slice(5, cached.indexOf(';')),
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PdfService.IMAGE_FETCH_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(
          `Header/footer image fetch returned ${res.status} for ${url}`,
        );
        return null;
      }
      const contentType =
        res.headers.get('content-type')?.split(';')[0]?.trim() ||
        guessImageMime(url);
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0) {
        return null;
      }
      this.cacheDataUri(
        url,
        `data:${contentType};base64,${data.toString('base64')}`,
      );
      return { data, contentType };
    } catch (e) {
      this.logger.warn(
        `Failed to inline header/footer image ${url}: ${(e as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  /**
   * Fetch an embedded PDF's bytes with a hard timeout and size cap. Returns
   * `null` on any failure (logged) so the embed degrades to a link instead of
   * failing the report. Not cached: an attachment is fetched once per print.
   */
  private readonly pdfFetcher: PdfFetcher = async (url) => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      PdfService.EMBED_FETCH_TIMEOUT_MS,
    );
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        this.logger.warn(
          `Embedded PDF fetch returned ${res.status} for ${url}`,
        );
        return null;
      }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > PdfService.EMBED_MAX_BYTES) {
        this.logger.warn(`Embedded PDF too large (${declared} bytes): ${url}`);
        return null;
      }
      const data = Buffer.from(await res.arrayBuffer());
      if (data.length === 0 || data.length > PdfService.EMBED_MAX_BYTES) {
        return null;
      }
      return data;
    } catch (e) {
      this.logger.warn(
        `Failed to fetch embedded PDF ${url}: ${(e as Error).message}`,
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  /** Store a URL's data URI, evicting the oldest entry past the size cap. */
  private cacheDataUri(url: string, dataUri: string): void {
    if (this.imageDataUriCache.size >= PdfService.IMAGE_CACHE_MAX) {
      const oldest = this.imageDataUriCache.keys().next().value;
      if (oldest !== undefined) {
        this.imageDataUriCache.delete(oldest);
      }
    }
    this.imageDataUriCache.set(url, dataUri);
  }

  /** Close the shared browser on shutdown to avoid zombie Chromium processes. */
  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch((e) => {
        this.logger.warn('Failed to close Puppeteer browser cleanly', e);
      });
      this.browser = null;
    }
  }

  /**
   * Lazily launch (or relaunch, if the previous instance disconnected) the
   * shared headless Chromium instance.
   */
  private async getBrowser(): Promise<Browser> {
    if (this.browser?.connected) {
      return this.browser;
    }
    this.browser = await puppeteer.launch({
      // System Chromium in Docker (set via env); bundled Chromium in dev.
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', // prevents OOM crashes in Docker containers
        '--disable-gpu',
        '--font-render-hinting=none', // consistent font rendering across OS
      ],
    });
    return this.browser;
  }
}
