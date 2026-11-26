import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { SubscriptionService } from './subscription.service';
import { SubscriptionUpstreamExceptionFilter } from './filters/subscription-upstream-exception.filter';
import { ChangePlanDto } from './dto/change-plan.dto';

/**
 * Business-admin Subscription Plan screen, proxied to the external subscription
 * microservice (ported from the EzHealthTrack `businessSubscription` flow). The
 * tenant comes from the JWT; the business id the server keys on is resolved
 * server-side — the client never supplies a business/tenant id.
 */
@Controller('subscription')
@UseFilters(SubscriptionUpstreamExceptionFilter)
export class SubscriptionController {
  constructor(private readonly service: SubscriptionService) {}

  /** The business's current subscription record, or `null` when not registered. */
  @Get()
  getSubscription(@CurrentTenant() tenantId: string) {
    return this.service.getSubscription(tenantId);
  }

  /** The active plans the business can switch to (Change Plan modal). */
  @Get('plans')
  getPlans(@CurrentTenant() tenantId: string) {
    return this.service.getPlans(tenantId);
  }

  /** Register the business on the subscription server ("Register Subscription"). */
  @Post('register')
  register(@CurrentTenant() tenantId: string) {
    return this.service.register(tenantId);
  }

  /** Change the business's subscription plan. */
  @Post('change-plan')
  changePlan(@CurrentTenant() tenantId: string, @Body() dto: ChangePlanDto) {
    return this.service.changePlan(tenantId, dto);
  }

  /** The business's subscription bills. */
  @Get('bills')
  getBills(@CurrentTenant() tenantId: string) {
    return this.service.getBills(tenantId);
  }

  /** One subscription bill as JSON. */
  @Get('bills/:billId')
  getBill(@CurrentTenant() tenantId: string, @Param('billId') billId: string) {
    return this.service.getBill(tenantId, billId);
  }

  /**
   * Stream one subscription bill as a PDF. A library-specific response is used so
   * the `ResponseInterceptor` does not wrap the binary in the JSON envelope.
   */
  @Get('bills/:billId/pdf')
  async downloadBill(
    @CurrentTenant() tenantId: string,
    @Param('billId') billId: string,
    @Res() res: Response,
  ): Promise<void> {
    const pdf = await this.service.downloadBill(tenantId, billId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="subscription-bill-${billId}.pdf"`,
    );
    res.setHeader('Content-Length', pdf.length);
    res.end(pdf);
  }
}
