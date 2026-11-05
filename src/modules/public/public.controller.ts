import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PublicService } from './public.service';
import { PublicOrderView } from './dto/public-order.dto';

/**
 * Public, unauthenticated patient-order access
 * (`/public/:tenantId/:branchId/:orderId`). Every route is `@Public()` (the
 * global `JwtAuthGuard` lets it through) and per-IP rate-limited (the global
 * guard is not registered, so authenticated routes are unaffected). The service
 * re-validates the tenant → branch → order ownership chain on every call and
 * returns only a minimal, safe projection.
 */
@Public()
@UseGuards(ThrottlerGuard)
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller('public/orders')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  /**
   * The public order page payload (patient identity, order header, billing,
   * report availability). Returns the usual `meta` envelope.
   */
  @Get(':tenantId/:branchId/:orderId')
  getOrder(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<PublicOrderView> {
    return this.publicService.getOrder(tenantId, branchId, orderId);
  }

  /**
   * Stream the patient bill PDF. A library-specific response is used so the
   * `ResponseInterceptor` does not wrap the binary in the JSON envelope.
   *
   * Served **inline** (not `attachment`): the `{qr_download_bill}` QR is scanned
   * on a phone, and mobile browsers / in-app QR webviews frequently do NOTHING
   * with an `attachment` binary (no download handler → blank screen). Inline
   * opens the PDF in the device's built-in viewer, from which the patient can
   * Save/Share (Android typically still routes it to Downloads). The legacy
   * `?download=1` query the printed QRs carry is accepted but ignored.
   */
  @Get(':tenantId/:branchId/:orderId/bill.pdf')
  async getBillPdf(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.publicService.getBillPdf(
      tenantId,
      branchId,
      orderId,
    );
    this.streamPdf(res, pdf, `bill-${orderId}.pdf`);
  }

  /**
   * Stream the order's PUBLISHED lab reports as one merged PDF. Served inline so
   * the `{qr_download_all_report}` QR opens it reliably on a phone (see
   * {@link getBillPdf} for why `attachment` is avoided).
   */
  @Get(':tenantId/:branchId/:orderId/report.pdf')
  async getReportPdf(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.publicService.getReportPdf(
      tenantId,
      branchId,
      orderId,
    );
    this.streamPdf(res, pdf, `report-${orderId}.pdf`);
  }

  /**
   * Write a PDF buffer to the response, unwrapped by the interceptor. Always
   * `inline` with a filename so the browser's viewer opens it (and a Save keeps
   * the given name) — the mobile-reliable behavior for a QR-scanned PDF.
   */
  private streamPdf(res: Response, pdf: Buffer, filename: string): void {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
