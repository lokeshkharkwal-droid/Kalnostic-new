import { IsIn } from 'class-validator';
import { ListOrdersDto } from './list-orders.dto';

/** Dimension a Billing summary can be grouped by (beyond user-wise). */
export type BillingGroupBy =
  | 'b2b'
  | 'ref-by'
  | 'internal-referral'
  | 'external-referral'
  | 'int-ref-user'
  | 'ext-ref-user'
  | 'outsource'
  | 'lab-test'
  | 'lab-panel'
  | 'department'
  | 'category'
  | 'subcategory';

export const BILLING_GROUP_BYS: BillingGroupBy[] = [
  'b2b',
  'ref-by',
  'internal-referral',
  'external-referral',
  'int-ref-user',
  'ext-ref-user',
  'outsource',
  'lab-test',
  'lab-panel',
  'department',
  'category',
  'subcategory',
];

/**
 * Query for the grouped Billing summary (`GET /orders/billing-summary/grouped`).
 * Extends the shared {@link ListOrdersDto} filter set with a required `groupBy`
 * dimension. `b2b` / `ref-by` / `internal-referral` / `external-referral` group
 * whole orders; `lab-test` / `lab-panel` / `department` / `category` /
 * `subcategory` group the order **items** with allocated money.
 */
export class BillingGroupedQueryDto extends ListOrdersDto {
  @IsIn(BILLING_GROUP_BYS)
  groupBy!: BillingGroupBy;
}
