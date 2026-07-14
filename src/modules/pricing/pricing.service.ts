import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';

/**
 * The Create-Order price preview (all integer minor units). `payableAmount` is
 * the single source of truth the form's Payment Details section displays:
 * `totalAmount - orderDiscount + sampleCollectionCharges + visitingCharges`.
 */
export interface PriceCalculation {
  totalAmount: number;
  orderDiscount: number;
  sampleCollectionCharges: number;
  visitingCharges: number;
  payableAmount: number;
}

/**
 * Pricing — computes the payable amount for a Create-Order form as the user
 * changes tests/panels/charges. Deliberately simple and extensible: the total is
 * the sum of the selected branch lab tests' + panels' list prices (`priceMsrp`),
 * and the payable subtracts the order discount (the summed per-line diagnostic
 * discounts) then adds the sample-collection + visiting charges. Tenant-scoped
 * (RLS) + branch-level; the tenant + branch come from the request context (CLAUDE.md §4.7).
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compute the payable total for the selected items + charges.
   * @param tenantId tenant scope (from JWT)
   * @param branchId active branch (from JWT profile)
   * @param dto selected branch lab test/panel ids + charges (minor units)
   * @returns the money values for the Payment Details section (minor units).
   *   Unknown or deleted ids are simply not summed.
   */
  async calculate(
    tenantId: string,
    branchId: string,
    dto: CalculatePriceDto,
  ): Promise<PriceCalculation> {
    const testIds = dto.labTestIds ?? [];
    const panelIds = dto.labPanelIds ?? [];

    const [tests, panels] = await Promise.all([
      testIds.length
        ? this.prisma.branchLabTest.findMany({
            where: {
              id: { in: testIds },
              tenantId,
              branchId,
              deletedAt: null,
            },
            select: { priceMsrp: true },
          })
        : Promise.resolve([]),
      panelIds.length
        ? this.prisma.branchLabPanel.findMany({
            where: {
              id: { in: panelIds },
              tenantId,
              branchId,
              deletedAt: null,
            },
            select: { priceMsrp: true },
          })
        : Promise.resolve([]),
    ]);

    const sum = (rows: Array<{ priceMsrp: number }>): number =>
      rows.reduce((acc, r) => acc + r.priceMsrp, 0);

    const totalAmount = sum(tests) + sum(panels);
    // The form sends the summed per-line diagnostic discounts; never let it
    // exceed the items total (which would make the payable negative).
    const orderDiscount = Math.min(dto.orderDiscount ?? 0, totalAmount);
    const sampleCollectionCharges = dto.sampleCollectionCharges ?? 0;
    const visitingCharges = dto.visitingCharges ?? 0;
    const payableAmount = Math.max(
      totalAmount - orderDiscount + sampleCollectionCharges + visitingCharges,
      0,
    );

    return {
      totalAmount,
      orderDiscount,
      sampleCollectionCharges,
      visitingCharges,
      payableAmount,
    };
  }
}
