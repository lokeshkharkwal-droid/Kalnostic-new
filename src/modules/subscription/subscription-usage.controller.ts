import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { SubscriptionApiKeyGuard } from './guards/subscription-api-key.guard';
import { SubscriptionUsageService } from './subscription-usage.service';
import { GenerateFeatureReportQueryDto } from './dto/generate-feature-report-query.dto';
import { BusinessFeatureCountDto } from './dto/business-feature-count.dto';

/**
 * Inbound subscription usage-reporting API (ports EzHealthTrack's
 * `subscription/api/*` endpoints). Called by the external **subscription
 * scheduler**, not a browser: the routes are `@Public()` (no business JWT) and
 * authenticated by the shared `key`/`secret` headers via
 * {@link SubscriptionApiKeyGuard}.
 *
 * Responses are written with `@Res()` so they bypass the global
 * `ResponseInterceptor` and return the raw EzHealthTrack `{ s, m, data }`
 * envelope the scheduler already understands (a drop-in replacement for the
 * legacy PHP endpoint). The HTTP status is always 200; success/failure is carried
 * on `s` (`'200'` ok, `'500'` business not found) — matching the legacy contract.
 */
@Controller('subscription/api')
@Public()
@UseGuards(SubscriptionApiKeyGuard)
export class SubscriptionUsageController {
  constructor(private readonly usage: SubscriptionUsageService) {}

  /**
   * Scheduled daily/monthly feature report for one business. The scheduler calls
   * this per business with `report_context` = `yesterday` (default) / `today` /
   * `monthly`.
   */
  @Get('generate-business-feature-report')
  async generateReport(
    @Query() query: GenerateFeatureReportQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.usage.generateBusinessFeatureReport(
      query.business_id,
      query.report_context ?? 'yesterday',
    );
    res.status(200).json(result);
  }

  /** Ad-hoc feature count for an explicit period + feature subset. */
  @Post('business-feature-count')
  async featureCount(
    @Body() dto: BusinessFeatureCountDto,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.usage.businessFeatureCount(dto);
    res.status(200).json(result);
  }
}
