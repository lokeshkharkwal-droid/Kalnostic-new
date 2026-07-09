import { Module } from '@nestjs/common';
import { PdfService } from './pdf.service';

/**
 * Infrastructure module exposing the Puppeteer-backed `PdfService`. Feature
 * modules that need PDF output import this and inject `PdfService` via DI
 * (CLAUDE.md rule #3 — never import the service directly).
 */
@Module({
  providers: [PdfService],
  exports: [PdfService],
})
export class PdfModule {}
