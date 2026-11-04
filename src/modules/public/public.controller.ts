import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PublicService } from './public.service';
import { PublicOrderView } from './dto/public-order.dto';

/** Truthy `?download` query (`1`/`true`/present) → force an attachment download. */
function isDownload(value: string | undefined): boolean {
  return value === '1' || value === 'true' || value === '';
}

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
   * `?download=1` (sent by the printed `{qr_download_bill}` QR) switches the
   * disposition to `attachment` so a phone saves the file instead of opening it.
   */
  @Get(':tenantId/:branchId/:orderId/bill.pdf')
  async getBillPdf(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.publicService.getBillPdf(
      tenantId,
      branchId,
      orderId,
    );
    this.streamPdf(res, pdf, `bill-${orderId}.pdf`, isDownload(download));
  }

  /**
   * Stream the order's PUBLISHED lab reports as one merged PDF. `?download=1`
   * (sent by the printed `{qr_download_all_report}` QR) forces a save-to-device.
   */
  @Get(':tenantId/:branchId/:orderId/report.pdf')
  async getReportPdf(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Query('download') download: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.publicService.getReportPdf(
      tenantId,
      branchId,
      orderId,
    );
    this.streamPdf(res, pdf, `report-${orderId}.pdf`, isDownload(download));
  }

  /**
   * Write a PDF buffer to the response, unwrapped by the interceptor. `attachment`
   * (download=true) tells the browser to save the file (used by the QR download
   * links); otherwise `inline` so the public page's view buttons open it.
   */
  private streamPdf(
    res: Response,
    pdf: Buffer,
    filename: string,
    download = false,
  ): void {
    const disposition = download ? 'attachment' : 'inline';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${filename}"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
