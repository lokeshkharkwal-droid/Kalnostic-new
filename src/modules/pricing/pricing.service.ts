import { Injectable } from '@nestjs/common';
import { isActiveOrderForGates } from '../order/utils/order-gate-scope.util';
import { PrismaService } from '../../prisma/prisma.service';
import { CalculatePriceDto } from './dto/calculate-price.dto';
import {
  effectiveLabTestPrice,
  roundToTwoDecimalPlaces,
} from '../../common/utils';

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
 * the sum of the selected branch lab tests' + panels' list prices (`listPrice`,
 * resolved from the order's chosen pricing list; a lab test uses its
 * `emergencyPrice` instead when `emergencyPricing` is set and that price is > 0),
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
    let testIds = dto.labTestIds ?? [];
    let panelIds = dto.labPanelIds ?? [];

    // Update Order on an active (billed) order: kept lines are priced at what
    // they were sold for, so only the remaining (new) ids go through the live list.
    const frozen = await this.loadFrozenKeptPrices(tenantId, dto);
    const frozenTotal = frozen.reduce((acc, f) => acc + f.unitPrice, 0);
    if (frozen.length) {
      const frozenTests = new Set(frozen.map((f) => f.branchLabTestId));
      const frozenPanels = new Set(frozen.map((f) => f.branchLabPanelId));
      testIds = testIds.filter((id) => !frozenTests.has(id));
      panelIds = panelIds.filter((id) => !frozenPanels.has(id));
    }

    const [tests, panels] = await Promise.all([
      testIds.length
        ? this.prisma.branchLabTest.findMany({
            where: {
              id: { in: testIds },
              tenantId,
              branchId,
              deletedAt: null,
            },
            select: { listPrice: true, emergencyPrice: true },
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
            select: { listPrice: true },
          })
        : Promise.resolve([]),
    ]);

    const sum = (rows: Array<{ listPrice: number }>): number =>
      rows.reduce((acc, r) => acc + r.listPrice, 0);

    const emergency = dto.emergencyPricing === true;
    const testsTotal = tests.reduce(
      (acc, t) =>
        acc + effectiveLabTestPrice(t.listPrice, t.emergencyPrice, emergency),
      0,
    );
    const totalAmount = testsTotal + sum(panels) + frozenTotal;
    // The form sends the summed per-line diagnostic discounts; never let it
    // exceed the items total (which would make the payable negative).
    const orderDiscount = roundToTwoDecimalPlaces(
      Math.min(dto.orderDiscount ?? 0, totalAmount),
    );
    const sampleCollectionCharges = dto.sampleCollectionCharges ?? 0;
    const visitingCharges = dto.visitingCharges ?? 0;
    const payableAmount = roundToTwoDecimalPlaces(
      Math.max(
        totalAmount - orderDiscount + sampleCollectionCharges + visitingCharges,
        0,
      ),
    );

    return {
      totalAmount,
      orderDiscount,
      sampleCollectionCharges,
      visitingCharges,
      payableAmount,
    };
  }

  /**
   * Stored prices of the order's kept catalogue lines, when (and only when) the
   * order is active so its prices are frozen. Empty for any other request.
   */
  private async loadFrozenKeptPrices(
    tenantId: string,
    dto: CalculatePriceDto,
  ): Promise<
    Array<{
      unitPrice: number;
      branchLabTestId: string | null;
      branchLabPanelId: string | null;
    }>
  > {
    if (!dto.orderId || !dto.keptItemIds?.length) return [];
    const order = await this.prisma.order.findFirst({
      where: { id: dto.orderId, tenantId, deletedAt: null },
      select: {
        status: true,
        appointment: { select: { status: true } },
      },
    });
    if (
      !order ||
      !isActiveOrderForGates({
        effectiveStatus: order.status,
        appointmentStatus: order.appointment?.status ?? null,
        checkIn: false,
      })
    ) {
      return [];
    }
    const rows = await this.prisma.orderItem.findMany({
      where: {
        id: { in: dto.keptItemIds },
        orderId: dto.orderId,
        tenantId,
        deletedAt: null,
        direct: null,
      },
      select: {
        unitPrice: true,
        branchLabTestId: true,
        branchLabPanelId: true,
      },
    });
    // Only lines the form still lists are frozen (a kept id whose test was
    // dropped from the id arrays must not be added to the total).
    const tests = new Set(dto.labTestIds ?? []);
    const panels = new Set(dto.labPanelIds ?? []);
    return rows.filter(
      (r) =>
        (r.branchLabTestId && tests.has(r.branchLabTestId)) ||
        (r.branchLabPanelId && panels.has(r.branchLabPanelId)),
    );
  }
}
