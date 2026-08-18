import { IsIn, IsOptional } from 'class-validator';
import { ListOrdersDto } from './list-orders.dto';

/**
 * A Finance → Billing report dimension. Drives the shared scope + financial
 * allocation so the metric cards, the grouped summary, and the detailed records
 * all describe the **same** dataset for a given tab:
 *
 * - `all` / `userwise` — no extra scope (all billing orders); order-level money.
 * - `b2b` / `ref-by` / `internal-referral` / `external-referral` — only orders with
 *   that referral set; order-level money (same approach as `b2b`).
 * - `lab-test` / `lab-panel` — only orders containing that catalogue line; money is
 *   allocated to those lines (see `allocateOrderLines`).
 * - `department` / `category` / `subcategory` — only orders whose catalogue lines
 *   carry that classification; money is allocated to the matching lines.
 * - `discount` — only orders where a discount (order-level or line-level) was
 *   applied; order-level money (no grouping — a filtered list).
 * - `back-dated` / `advance-dated` — only orders whose `orderDateType` is
 *   BACKTRACKED / ADVANCE_DATED; order-level money (filtered list).
 * - `home-collection` — only home-visit orders (`diagnostics.isHomeVisit`);
 *   order-level money (filtered list).
 * - `int-ref-user` / `ext-ref-user` — only orders with an internal / external
 *   referral user set (from the order's Referral Details); order-level money,
 *   grouped by that referral user.
 * - `outsource` — only orders sent to an external lab via an accession OUTSOURCE
 *   `SampleTransfer`; order-level money, grouped by outsource center.
 */
export type BillingDimension =
  | 'all'
  | 'userwise'
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
  | 'subcategory'
  | 'discount'
  | 'back-dated'
  | 'advance-dated'
  | 'home-collection';

export const BILLING_DIMENSIONS: BillingDimension[] = [
  'all',
  'userwise',
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
  'discount',
  'back-dated',
  'advance-dated',
  'home-collection',
];

/**
 * Query for the dimension-scoped Billing endpoints (`/orders/billing-records`,
 * `/orders/billing-summary`): the shared {@link ListOrdersDto} filter set plus an
 * optional `dimension` (defaults to `all`).
 */
export class BillingQueryDto extends ListOrdersDto {
  @IsOptional()
  @IsIn(BILLING_DIMENSIONS)
  dimension?: BillingDimension;
}
