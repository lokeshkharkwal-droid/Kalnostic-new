import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { InventorySettingsService } from '../inventory-settings/inventory-settings.service';
import {
  InventoryAdjustmentSaveResult,
  InventoryAdjustmentView,
  InventoryConsumeResult,
  InventoryConsumptionClient,
  InventoryProformaInfo,
  InventoryValidateResult,
} from './inventory-consumption.client';

/** An empty adjustment view (integration off, no branch, or order not found). */
const EMPTY_ADJUSTMENT = (
  kalnosticsOrderId: string,
  scope: 'ORDER' | 'TEST',
  labTestSourceId: string | null,
): InventoryAdjustmentView => ({
  scope,
  kalnosticsOrderId,
  labTestSourceId,
  isAutoDeducted: false,
  status: 'PENDING_MANUAL',
  totalPlannedQty: 0,
  products: [],
});

/** A lab-test line a manual adjustment may act on. */
interface AdjustmentLineInput {
  productId: string;
  finalQty: number;
}

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
 * the **canonical master** `LabTest.id`): it resolves each order item's branch
 * lab test to that canonical id, then validates / consumes / looks up proforma
 * info via {@link InventoryConsumptionClient}. Every method degrades to a safe
 * no-op when the inventory integration is not configured, so order flows never
 * break.
 */
@Injectable()
export class InventoryConsumptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly client: InventoryConsumptionClient,
    private readonly settings: InventorySettingsService,
  ) {}

  /** Whether the inventory integration is configured. */
  get isEnabled(): boolean {
    return this.client.isEnabled;
  }

  /**
   * Distinct **canonical** master `LabTest.id`s behind a set of branch lab test
   * ids — the id a proforma "Lab Test" mapping is keyed on.
   *
   * Two hops: a branch lab test's `sourceLabTestId` points at the **Branch Master
   * Data** test it was snapshotted from, and that in turn carries
   * `sourceMasterLabTestId` → the **Tenant Master Data** original. We return the
   * Tenant Master Data id (the canonical representative) — or the Branch Master
   * Data id itself for a branch-only test with no tenant parent
   * (`sourceMasterLabTestId` null). This matches the one-row-per-logical-test id
   * the mapping picker stores (`LabTestService.findOptions`, which lists exactly
   * the `sourceMasterLabTestId IS NULL` originals), so a mapping made in the
   * picker matches an ordered test here regardless of which branch it ran at.
   */
  private async resolveSourceLabTestIds(
    tenantId: string,
    branchLabTestIds: string[],
  ): Promise<string[]> {
    if (branchLabTestIds.length === 0) return [];
    const rows = await this.prisma.branchLabTest.findMany({
      where: { id: { in: branchLabTestIds }, tenantId, deletedAt: null },
      select: { sourceLabTestId: true },
    });
    const branchMasterTestIds = [
      ...new Set(
        rows
          .map((r) => r.sourceLabTestId)
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (branchMasterTestIds.length === 0) return [];
    // Collapse each Branch Master Data test onto its Tenant Master Data original.
    // Soft-deleted originals are still followed (the mapping outlives a deletion),
    // so no `deletedAt` filter here.
    const masterTests = await this.prisma.labTest.findMany({
      where: { id: { in: branchMasterTestIds }, tenantId },
      select: { id: true, sourceMasterLabTestId: true },
    });
    const canonicalById = new Map(
      masterTests.map((t) => [t.id, t.sourceMasterLabTestId ?? t.id]),
    );
    return [
      ...new Set(
        branchMasterTestIds.map((id) => canonicalById.get(id) ?? id),
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
    // When automatic reduction is off, order creation deducts nothing, so there is
    // nothing to pre-validate — stock is managed manually from Technician Reporting.
    const { isAutomaticInventoryReductionEnabled } =
      await this.settings.getForTenant(tenantId);
    if (!isAutomaticInventoryReductionEnabled) return null;
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
    // Gate on the tenant's Inventory Settings: when automatic reduction is off we
    // deduct nothing at order creation (stock is adjusted manually later). When on,
    // record the deduction ledger at the tenant's manual-adjustment granularity so
    // per-test / per-order manual adjustment has a clean base to diff against.
    const { isAutomaticInventoryReductionEnabled, manualAdjustmentMode } =
      await this.settings.getForTenant(tenantId);
    if (!isAutomaticInventoryReductionEnabled) return null;
    const sourceIds = await this.resolveSourceLabTestIds(
      tenantId,
      this.collectBranchLabTestIds(order.items),
    );
    if (sourceIds.length === 0) return null;
    const patientName = await this.resolvePatientName(
      tenantId,
      order.patientId,
    );
    return this.client.consume({
      kalnosticsOrderId: order.id,
      orderCode: order.orderCode ?? undefined,
      branchId,
      labTestSourceIds: sourceIds,
      patientId: order.patientId,
      patientName,
      date: order.orderDate?.toISOString(),
      scope: manualAdjustmentMode === 'TEST_TYPE' ? 'TEST' : 'ORDER',
    });
  }

  /**
   * Resolve the order context a manual adjustment needs: the order's branch, code,
   * patient, and the master lab test source ids behind its items. Returns `null`
   * when the order is missing or belongs to another tenant.
   */
  private async resolveOrderContext(tenantId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, tenantId, deletedAt: null },
      select: {
        id: true,
        branchId: true,
        orderCode: true,
        patientId: true,
        items: {
          where: { deletedAt: null },
          select: { branchLabTestId: true },
        },
      },
    });
    if (!order) return null;
    const branchLabTestIds = this.collectBranchLabTestIds(order.items);
    const labTestSourceIds = await this.resolveSourceLabTestIds(
      tenantId,
      branchLabTestIds,
    );
    const patientName = await this.resolvePatientName(
      tenantId,
      order.patientId,
    );
    return { order, labTestSourceIds, patientName };
  }

  /**
   * Load the order-level manual inventory-adjustment view (all products across the
   * order's proformas). Returns an empty view when nothing applies.
   */
  async loadOrderAdjustment(
    tenantId: string,
    orderId: string,
  ): Promise<InventoryAdjustmentView> {
    const empty = EMPTY_ADJUSTMENT(orderId, 'ORDER', null);
    if (!this.isEnabled) return empty;
    const ctx = await this.resolveOrderContext(tenantId, orderId);
    if (!ctx || !ctx.order.branchId) return empty;
    const res = await this.client.loadAdjustment({
      kalnosticsOrderId: orderId,
      branchId: ctx.order.branchId,
      scope: 'ORDER',
      labTestSourceIds: ctx.labTestSourceIds,
    });
    return res ?? empty;
  }

  /** Apply an order-level manual inventory adjustment. */
  async saveOrderAdjustment(
    tenantId: string,
    orderId: string,
    lines: AdjustmentLineInput[],
    reason?: string,
    note?: string,
  ): Promise<InventoryAdjustmentSaveResult | null> {
    if (!this.isEnabled) return null;
    const ctx = await this.resolveOrderContext(tenantId, orderId);
    if (!ctx || !ctx.order.branchId) return null;
    return this.client.saveAdjustment({
      kalnosticsOrderId: orderId,
      branchId: ctx.order.branchId,
      scope: 'ORDER',
      labTestSourceIds: ctx.labTestSourceIds,
      lines,
      reason,
      note,
      patientId: ctx.order.patientId,
      patientName: ctx.patientName,
      orderCode: ctx.order.orderCode ?? undefined,
    });
  }

  /**
   * The master lab test behind a lab report: the panel-member test when the report
   * is a panel member, else the order line's branch lab test. Returns the
   * **canonical** master `LabTest.id` (see {@link resolveSourceLabTestIds}) or null
   * when it can't be resolved.
   */
  private async resolveReportSourceLabTestId(
    tenantId: string,
    labReportId: string,
  ): Promise<string | null> {
    const report = await this.prisma.labReport.findFirst({
      where: { id: labReportId, tenantId, deletedAt: null },
      select: {
        memberBranchLabTestId: true,
        orderItem: { select: { branchLabTestId: true } },
      },
    });
    if (!report) return null;
    const branchLabTestId =
      report.memberBranchLabTestId ?? report.orderItem?.branchLabTestId ?? null;
    if (!branchLabTestId) return null;
    const [sourceId] = await this.resolveSourceLabTestIds(tenantId, [
      branchLabTestId,
    ]);
    return sourceId ?? null;
  }

  /**
   * Load the test-level manual inventory-adjustment view for one of the order's
   * lab tests (identified by its lab report id). Returns an empty view when nothing
   * applies.
   */
  async loadTestAdjustment(
    tenantId: string,
    orderId: string,
    labReportId: string,
  ): Promise<InventoryAdjustmentView> {
    const empty = EMPTY_ADJUSTMENT(orderId, 'TEST', null);
    if (!this.isEnabled) return empty;
    const ctx = await this.resolveOrderContext(tenantId, orderId);
    if (!ctx || !ctx.order.branchId) return empty;
    const labTestSourceId = await this.resolveReportSourceLabTestId(
      tenantId,
      labReportId,
    );
    if (!labTestSourceId) return empty;
    const res = await this.client.loadAdjustment({
      kalnosticsOrderId: orderId,
      branchId: ctx.order.branchId,
      scope: 'TEST',
      labTestSourceId,
      labTestSourceIds: ctx.labTestSourceIds,
    });
    return res ?? empty;
  }

  /** Apply a test-level manual inventory adjustment for one of the order's tests. */
  async saveTestAdjustment(
    tenantId: string,
    orderId: string,
    labReportId: string,
    lines: AdjustmentLineInput[],
    reason?: string,
    note?: string,
  ): Promise<InventoryAdjustmentSaveResult | null> {
    if (!this.isEnabled) return null;
    const ctx = await this.resolveOrderContext(tenantId, orderId);
    if (!ctx || !ctx.order.branchId) return null;
    const labTestSourceId = await this.resolveReportSourceLabTestId(
      tenantId,
      labReportId,
    );
    if (!labTestSourceId) return null;
    return this.client.saveAdjustment({
      kalnosticsOrderId: orderId,
      branchId: ctx.order.branchId,
      scope: 'TEST',
      labTestSourceId,
      labTestSourceIds: ctx.labTestSourceIds,
      lines,
      reason,
      note,
      patientId: ctx.order.patientId,
      patientName: ctx.patientName,
      orderCode: ctx.order.orderCode ?? undefined,
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
