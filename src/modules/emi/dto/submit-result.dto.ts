/**
 * Wire shapes for the machine (EMI) `/emi/submitResult` payload.
 *
 * These are **plain interfaces, not class-validator DTOs, by design**: the EMI
 * layer reproduces the legacy EzHealthTrack contract verbatim so existing
 * analyzers integrate without reconfiguration. The machine sends a GET request
 * whose body is JSON under `Content-Type: text/plain`, carrying many extra
 * fields (`alarm_conditions`, `rack_no`, histograms, …). The legacy endpoint is
 * deliberately permissive, so the controller reads the raw parsed body and the
 * service normalises it — the global `ValidationPipe`
 * (`whitelist`/`forbidNonWhitelisted`) is intentionally bypassed here (it would
 * reject the machine's extra fields with our `{success,error}` envelope, which a
 * machine can't understand). Compatibility with the fixed machine contract wins
 * over our internal DTO convention for this one integration surface.
 */

/** One test result line as sent by the analyzer. */
export interface EmiTestResult {
  /** Analyzer's own result id (opaque; retained for tracing). */
  test_result_id?: string;
  /** The observed value (e.g. "10.24"). */
  test_result?: string;
  /** How it came off the instrument, before any adapter-app edit. */
  original_test_result?: string;
  /** Display name of the test/analyte. */
  test_name?: string;
  display_name?: string;
  /** Shared LIS identifier for the analyte — matched to our testCode/param. */
  universal_test_id?: string;
  /** Reporting unit (e.g. "mg/dL"). */
  unit?: string;
  result_type?: string;
  [extra: string]: unknown;
}

/**
 * One supplementary artifact sent alongside the results — typically an analyzer
 * histogram/scattergram image (WBC/RBC/PLT/Diff) as a base64 data-URI. `type` is
 * the histogram label; `data` is a `data:image/…;base64,…` string.
 */
export interface EmiTestResultSupplement {
  type?: string;
  format?: string;
  data?: string;
  [extra: string]: unknown;
}

/** The full submit payload (only the fields we consume are typed). */
export interface SubmitResultBody {
  specimen_type?: string;
  tube_information_id?: string;
  equipment_id?: string;
  /** Specimen/tube id — in our system this is the order's `orderCode`. */
  tube_no?: string;
  original_tube_no?: string;
  result_date?: string;
  sent?: string;
  sent_date?: string;
  status?: string;
  local_db_status?: string;
  test_results?: EmiTestResult[];
  /** Histogram/scattergram images (base64 data-URIs). Legacy misspelling kept. */
  test_result_suplement?: EmiTestResultSupplement[];
  comment?: string;
  token_id?: string;
  adapter_id?: string;
  adapter_code?: string;
  [extra: string]: unknown;
}
