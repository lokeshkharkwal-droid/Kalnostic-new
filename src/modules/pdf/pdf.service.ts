import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';
import {
  ImageFetcher,
  guessImageMime,
  inlineRemoteImages,
} from './pdf-image-inline.util';

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
  /** Max distinct image URLs kept as inlined data URIs (immutable upload keys). */
  private static readonly IMAGE_CACHE_MAX = 200;
  /**
   * URL → base64 data URI cache. Uploaded images live at content-addressed keys
   * (a URL's bytes never change), so caching across requests is safe and avoids
   * re-fetching a shared logo on every print. Bounded by `IMAGE_CACHE_MAX`.
   */
  private readonly imageDataUriCache = new Map<string, string>();

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
      const pdfOptions = await this.inlineHeaderFooterImages(options);
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true, // render CSS background-color / background-image
        margin: { top: '10mm', bottom: '12mm', left: '12mm', right: '12mm' },
        ...pdfOptions,
      });
      return Buffer.from(pdf);
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
