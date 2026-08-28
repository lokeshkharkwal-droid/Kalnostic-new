/**
 * Response shapes for the machine (EMI) endpoints — the legacy EzHealthTrack
 * envelope, reproduced verbatim. Every EMI response is a flat object keyed by
 * `s` (a string status code: "200" ok, "400" bad request, "403" invalid auth,
 * "500" internal error) — NOT our standard `{ success, data, meta }` envelope.
 * The controller writes these with `@Res()` so the global `ResponseInterceptor`
 * is bypassed.
 */

/** Status codes the machine understands (legacy `EmiController` constants). */
export const EMI = {
  OK: '200',
  EMPTY: '199',
  BAD_REQUEST: '400',
  INVALID_AUTH: '403',
  INTERNAL_ERROR: '500',
} as const;

/** `emi_status` label the adapter app displays. */
export const EMI_STATUS = {
  COMPLETE: 'Complete',
  INCOMPLETE: 'In-complete',
} as const;

/**
 * `update_test_status` codes stored on the `AdapterResult` audit row (legacy
 * `AdapterResult::UPDATE_TEST_STATUS_*`).
 */
export const UPDATE_TEST_STATUS = {
  ORDER_NOT_FOUND: '0',
  MISSING_VALUES: '1',
  ALREADY_COMPLETE: '2',
  TOKEN_MISMATCH: '3',
} as const;

/** One order row returned by `GET /emi/orders`. */
export interface EmiOrderRow {
  specimen_id: string;
  order_date: number;
  patient_id: string;
  patient_name: string;
  patient_surname: string;
  birth_date: number;
  patient_gender: string;
  admission_number: string;
  sender_organization: string;
  sender_doctor: string;
  ut_ids: string[];
}

/** `GET /emi/orders` response envelope. */
export interface EmiOrdersResponse {
  s: string;
  m?: string;
  orders?: EmiOrderRow[];
}

/** One per-report line inside `report_log.log[]` of a submit response. */
export interface EmiReportLog {
  report_id: string;
  report_name: string;
  status: string;
  before_report_status: string;
  fill_status: string;
  available_branches?: string[];
  branch_id?: string | null;
}

/** The `report_log` block of a submit response. */
export interface EmiReportLogBlock {
  order_id: string;
  datetime: string;
  log: EmiReportLog[];
}

/** `GET /emi/submitResult` response envelope. */
export interface EmiSubmitResponse {
  s: string;
  m?: string;
  emi_status?: string;
  test_status?: string;
  report_log?: EmiReportLogBlock;
  prefered_test?: Record<string, string>;
  unique_test_ids?: Record<string, string>;
}
