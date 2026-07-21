import { Body, Controller, Post } from '@nestjs/common';
import { PricingService } from './pricing.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import { CurrentTenant } from '../auth/decorators/current-tenant.decorator';
import { CurrentProfile } from '../auth/decorators/current-profile.decorator';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';

/**
 * Pricing endpoints for the Create-Order form. Business-authenticated; tenant
 * from the JWT (`@CurrentTenant`) and the active branch from the JWT profile
 * (`@CurrentProfile`) — never the body (CLAUDE.md §4.7). Responses use the
 * global `meta` envelope.
 */
@Controller('pricing')
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  /**
   * Compute the payable total for the current selection of tests/panels + charges.
   * Returns `{ totalAmount, orderDiscount, sampleCollectionCharges, visitingCharges,
   * payableAmount }` in integer minor units.
   */
  @Post('calculate')
  calculate(
    @CurrentTenant() tenantId: string,
    @CurrentProfile() profile: ActiveProfile,
    @Body() dto: CalculatePriceDto,
  ) {
    if (!profile.branchId) {
      throw new ActiveBranchRequiredException();
    }
    return this.pricingService.calculate(tenantId, profile.branchId, dto);
  }
}
