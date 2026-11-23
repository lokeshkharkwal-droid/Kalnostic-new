import { InventoryManualAdjustmentMode } from '@prisma/client';

/**
 * The tenant's Inventory Settings (Business Admin › Business Settings › Inventory
 * Settings). Applies to every branch of the business.
 */
export interface InventorySettings {
  /**
   * When true, inventory is automatically deducted when an order is created (the
   * existing proforma-consumption flow). When false, no automatic deduction
   * happens; stock is managed manually through Technician Reporting.
   */
  isAutomaticInventoryReductionEnabled: boolean;

  /**
   * Where a technician may manually adjust inventory: once per order
   * (`ORDER_TYPE`) or once per individual lab test (`TEST_TYPE`).
   */
  manualAdjustmentMode: InventoryManualAdjustmentMode;
}
