/**
 * The branch's report-printing settings: whether the technician may choose, per
 * report, which Notes sections print. One switch for a single lab test, one for a
 * test that belongs to a lab panel. Both ON until a Branch Admin turns one off; OFF
 * means every Notes section prints.
 */
export interface ReportPrintingSettings {
  isLabTestNotesSelectable: boolean;
  isLabPanelNotesSelectable: boolean;
}
