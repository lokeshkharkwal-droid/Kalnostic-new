/**
 * Domain shapes surfaced to the frontend by the subscription proxy. They mirror
 * the fields the legacy EzHealthTrack `businessSubscription` view read off the
 * subscription server's `data.original`. The upstream is loosely typed, so known
 * fields are optional; unknown extras pass through via the index signature.
 */

/** One plan feature, as returned in a plan's `features_json`. */
export interface SubscriptionFeature {
  feature: string;
  [key: string]: unknown;
}

/** The plan currently (or prospectively) attached to a business. */
export interface SubscriptionPlan {
  id?: string | number;
  title?: string;
  slug?: string;
  price?: string | number;
  start_date?: string;
  end_date?: string;
  features_json?: SubscriptionFeature[];
  [key: string]: unknown;
}

/** The business's subscription client record (`GET /clients/show`). */
export interface SubscriptionClientRecord {
  name?: string;
  code?: string;
  address?: string;
  address_2?: string;
  city?: string;
  country?: string;
  postcode?: string;
  pan_number?: string;
  gst_number?: string;
  contact_person?: string;
  contact_email?: string;
  contact_phone?: string;
  plan?: SubscriptionPlan | false;
  [key: string]: unknown;
}

/** One subscription bill row (`GET /bills`). */
export interface SubscriptionBill {
  id?: string | number;
  bill_status?: string;
  payment_status?: string;
  reference_number?: string;
  context_date?: string;
  bill_period?: string;
  paid_date?: string;
  total_charges?: string | number;
  total_tax?: string | number;
  total_tds?: string | number;
  net_payable?: string | number;
  balance_amount?: string | number;
  total_price?: string | number;
  created_at?: string;
  updated_at?: string;
  [key: string]: unknown;
}
