/**
 * Subscription "business feature" usage-metric catalogue — a faithful port of the
 * EzHealthTrack `BusinessFeature::FEATURE_TYPE_*` constants and the daily/monthly
 * report feature lists.
 *
 * These string codes are the **billing contract** the external Subscription
 * service keys on, so the values are kept **byte-identical** to the legacy ones
 * (note the deliberate mix of `snake_case` and `kebab-case` — do not "normalise"
 * them). The subscription scheduler calls our inbound endpoint per business and
 * we answer with a `{ code → { count | value } }` map over these codes.
 */
export const BUSINESS_FEATURE = {
  // ── Messaging (daily) ──
  WHATSAPP: 'whatsapp',
  WHATSAPP_MARKETING: 'whatsapp_marketing',
  SMS: 'sms',
  EMAIL: 'email',
  // ── Orders (daily) ──
  ORDER_COUNT: 'order_count',
  ORDER_AMOUNT: 'order_amount',
  DISCOUNT_AMOUNT: 'discount_amount',
  BILLED_AMOUNT: 'billed_amount',
  // ── Transactions (daily) ──
  ADAPTER_FILLED: 'adapter_filled',
  TRANSACTION_SUCCESSFUL: 'transaction_successful',
  TRANSACTION_FAILED: 'transaction_failed',
  TRANSACTION_REFUNDED: 'transaction_refunded',
  TRANSACTION_SUCCESSFUL_AMOUNT: 'transaction_successful_amount',
  TRANSACTION_REFUNDED_AMOUNT: 'transaction_refunded_amount',
  TRANSACTION_COMMISSION_EZ: 'transaction_commission_ez',
  TRANSACTION_COMMISSION_PG: 'transaction_commission_pg',
  // ── Branches (monthly) ──
  BRANCH: 'branch',
  BRANCH_INVENTORY: 'branch-inventory',
  OPD: 'opd',
  IPD: 'ipd',
  DIAGNOSTIC: 'diagnostic',
  RADIOLOGY: 'radiology',
  COLLECTION_CENTER: 'collection_center',
  CMS: 'cms',
  INVENTORY: 'inventory',
  // ── Users (monthly) ──
  USERS: 'users',
  USER_APP_SALES: 'user-app-sales',
  USER_APP_PHLEBO: 'user-app-phlebo',
  USER_SALES: 'user-sales',
  USER_PHLEBO: 'user-phlebo',
  USER_WEB_B2B: 'user-web-b2b',
  USER_WEB: 'user-web',
  USER_DOCTOR: 'user-doctor',
  USER_ASSISTANT: 'user-assistant',
  // ── Machines / adapters (monthly) ──
  MACHINE_INTERFACE: 'machine-interface',
  ADAPTER: 'adapter',
} as const;

/** A single usage-metric code (the union of every value in {@link BUSINESS_FEATURE}). */
export type BusinessFeatureCode =
  (typeof BUSINESS_FEATURE)[keyof typeof BUSINESS_FEATURE];

/**
 * The **daily** feature set (ports `BusinessFeature::$business_feature_daily_report`).
 * These are period-bounded activity counts/sums over a single day.
 */
export const DAILY_BUSINESS_FEATURES: BusinessFeatureCode[] = [
  BUSINESS_FEATURE.WHATSAPP,
  BUSINESS_FEATURE.WHATSAPP_MARKETING,
  BUSINESS_FEATURE.SMS,
  BUSINESS_FEATURE.EMAIL,
  BUSINESS_FEATURE.ORDER_COUNT,
  BUSINESS_FEATURE.ORDER_AMOUNT,
  BUSINESS_FEATURE.DISCOUNT_AMOUNT,
  BUSINESS_FEATURE.BILLED_AMOUNT,
  BUSINESS_FEATURE.ADAPTER_FILLED,
  BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL,
  BUSINESS_FEATURE.TRANSACTION_FAILED,
  BUSINESS_FEATURE.TRANSACTION_REFUNDED,
  BUSINESS_FEATURE.TRANSACTION_SUCCESSFUL_AMOUNT,
  BUSINESS_FEATURE.TRANSACTION_REFUNDED_AMOUNT,
  BUSINESS_FEATURE.TRANSACTION_COMMISSION_EZ,
  BUSINESS_FEATURE.TRANSACTION_COMMISSION_PG,
];

/**
 * The **monthly** feature set (ports `BusinessFeature::$business_feature_monthly_report`).
 * These are point-in-time counts (branches, users, machines) as of the run.
 */
export const MONTHLY_BUSINESS_FEATURES: BusinessFeatureCode[] = [
  BUSINESS_FEATURE.BRANCH,
  BUSINESS_FEATURE.BRANCH_INVENTORY,
  BUSINESS_FEATURE.OPD,
  BUSINESS_FEATURE.IPD,
  BUSINESS_FEATURE.DIAGNOSTIC,
  BUSINESS_FEATURE.RADIOLOGY,
  BUSINESS_FEATURE.COLLECTION_CENTER,
  BUSINESS_FEATURE.CMS,
  BUSINESS_FEATURE.USERS,
  BUSINESS_FEATURE.USER_APP_SALES,
  BUSINESS_FEATURE.USER_APP_PHLEBO,
  BUSINESS_FEATURE.USER_SALES,
  BUSINESS_FEATURE.USER_PHLEBO,
  BUSINESS_FEATURE.USER_WEB_B2B,
  BUSINESS_FEATURE.USER_WEB,
  BUSINESS_FEATURE.USER_DOCTOR,
  BUSINESS_FEATURE.USER_ASSISTANT,
  BUSINESS_FEATURE.MACHINE_INTERFACE,
  BUSINESS_FEATURE.INVENTORY,
  BUSINESS_FEATURE.ADAPTER,
];

/** `report_type` stored/echoed on each report (ports `BusinessSubscriptionReport::REPORT_TYPE_*`). */
export const SUBSCRIPTION_REPORT_TYPE = {
  DAILY: 'daily',
  MONTHLY: 'monthly',
} as const;

export type SubscriptionReportType =
  (typeof SUBSCRIPTION_REPORT_TYPE)[keyof typeof SUBSCRIPTION_REPORT_TYPE];

/** The window selector the scheduler passes as `report_context` (ports the legacy param). */
export const REPORT_CONTEXTS = ['yesterday', 'today', 'monthly'] as const;
export type ReportContext = (typeof REPORT_CONTEXTS)[number];

/**
 * Role-key groupings used to count users per legacy "user type". The EzHealthTrack
 * user types (`USER_TYPE_SALES`, `USER_TYPE_DOCTOR`, …) map onto Kalnostics'
 * `AuthRole.key` catalogue (PROFILE_REGISTRY) as follows.
 */
export const USER_ROLE_GROUPS = {
  /** EZHT USER_TYPE_SALES → the marketing/sales roles. */
  SALES: ['marketing_executive', 'marketing_manager'],
  /** EZHT USER_TYPE_LAB_PHLEBOTOMIST. */
  PHLEBO: ['phlebotomist'],
  /** EZHT USER_TYPE_DOCTOR → every doctor variant. */
  DOCTOR: ['doctor', 'consultant_doctor', 'reporting_doctor'],
  /** EZHT USER_TYPE_RECEPTIONIST (the legacy "assistant" count). */
  ASSISTANT: ['receptionist'],
  /** EZHT USER_TYPE_EXTERNAL_REFERRING_PANEL (B2B web login). */
  B2B: ['b2b_referring_panel'],
} as const;
