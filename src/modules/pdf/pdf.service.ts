import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import puppeteer, { Browser, PDFOptions } from 'puppeteer';

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
      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true, // render CSS background-color / background-image
        margin: { top: '10mm', bottom: '12mm', left: '12mm', right: '12mm' },
        ...options,
      });
      return Buffer.from(pdf);
    } finally {
      await page.close().catch((e) => {
        this.logger.warn('Failed to close Puppeteer page cleanly', e);
      });
    }
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
