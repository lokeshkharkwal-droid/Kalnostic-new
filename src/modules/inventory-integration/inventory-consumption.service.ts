import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  InventoryConsumeResult,
  InventoryConsumptionClient,
  InventoryProformaInfo,
  InventoryValidateResult,
} from './inventory-consumption.client';

/** The minimum of an order item we need to resolve its master lab test. */
interface ItemWithBranchLabTest {
  branchLabTestId?: string | null;
}

/** The minimum of a created order we need to drive consumption. */
interface OrderForConsumption {
  id: string;
  orderCode: string | null;
  patientId: string;
  orderDate: Date | null;
  items: ItemWithBranchLabTest[];
}

/**
 * Orchestrates inventory consumption for kalnostics orders. Bridges order data
 * (branch lab tests) to the inventory service (which keys proforma mappings on
 * the **master** `LabTest.id`): it resolves each order item's branch lab test to
 * its `sourceLabTestId`, then validates / consumes / looks up proforma info via
 * {@link InventoryConsumptionClient}. Every method degrades to a safe no-op when
 * the inventory integration is not configured, so order flows never break.
 */
@Injectable()
export class InventoryConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: InventoryConsumptionClient,
  ) {}

  /** Whether the inventory integration is configured. */
  get isEnabled(): boolean {
    return this.client.isEnabled;
  }

  /** Distinct master `LabTest.id`s behind a set of branch lab test ids. */
  private async resolveSourceLabTestIds(
    tenantId: string,
    branchLabTestIds: string[],
  ): Promise<string[]> {
    if (branchLabTestIds.length === 0) return [];
    const rows = await this.prisma.branchLabTest.findMany({
      where: { id: { in: branchLabTestIds }, tenantId, deletedAt: null },
      select: { sourceLabTestId: true },
    });
    return [
      ...new Set(
        rows
          .map((r) => r.sourceLabTestId)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
  }

  /** Distinct branch lab test ids present on a list of order items. */
  private collectBranchLabTestIds(items: ItemWithBranchLabTest[]): string[] {
    return [
      ...new Set(
        (items ?? [])
          .map((i) => i.branchLabTestId)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
  }

  /**
   * Validate stock for an order's lab tests BEFORE it is finalized. Returns
   * `null` when nothing applies (integration off, no branch, or no lab tests) so
   * the caller can skip the check entirely.
   */
  async validateForOrder(
    tenantId: string,
    branchId: string | null,
    items: ItemWithBranchLabTest[],
  ): Promise<InventoryValidateResult | null> {
    if (!this.isEnabled || !branchId) return null;
    const sourceIds = await this.resolveSourceLabTestIds(
      tenantId,
      this.collectBranchLabTestIds(items),
    );
    if (sourceIds.length === 0) return null;
    return this.client.validate({ branchId, labTestSourceIds: sourceIds });
  }

  /**
   * Deduct mapped products + record the linked sale for a confirmed order.
   * Idempotent per order. Returns `null` when nothing applies.
   */
  async consumeForOrder(
    tenantId: string,
    branchId: string | null,
    order: OrderForConsumption,
  ): Promise<InventoryConsumeResult | null> {
    if (!this.isEnabled || !branchId) return null;
    const sourceIds = await this.resolveSourceLabTestIds(
      tenantId,
      this.collectBranchLabTestIds(order.items),
    );
    if (sourceIds.length === 0) return null;
    const patientName = await this.resolvePatientName(tenantId, order.patientId);
    return this.client.consume({
      kalnosticsOrderId: order.id,
      orderCode: order.orderCode ?? undefined,
      branchId,
      labTestSourceIds: sourceIds,
      patientId: order.patientId,
      patientName,
      date: order.orderDate?.toISOString(),
    });
  }

  /**
   * Proforma + product/stock info for one selected branch lab test, for the
   * registration tooltip. Returns `{ mapped:false }` (not an error) when the
   * integration is off, there's no branch, or nothing is mapped.
   */
  async proformaInfo(
    tenantId: string,
    branchId: string | null,
    branchLabTestId: string,
  ): Promise<InventoryProformaInfo> {
    const empty: InventoryProformaInfo = { mapped: false, proformas: [] };
    if (!this.isEnabled || !branchId) return empty;
    const [sourceId] = await this.resolveSourceLabTestIds(tenantId, [
      branchLabTestId,
    ]);
    if (!sourceId) return empty;
    const info = await this.client.info(branchId, sourceId);
    return info ?? empty;
  }

  /** Space-joined patient name for the consumption sale's customer. */
  private async resolvePatientName(
    tenantId: string,
    patientId: string,
  ): Promise<string | undefined> {
    const p = await this.prisma.patient.findFirst({
      where: { id: patientId, tenantId },
      select: { firstName: true, middleName: true, lastName: true },
    });
    if (!p) return undefined;
    return [p.firstName, p.middleName, p.lastName]
      .filter((x): x is string => Boolean(x))
      .join(' ');
  }
}
