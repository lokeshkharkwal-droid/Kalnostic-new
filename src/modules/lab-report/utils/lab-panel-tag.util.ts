/**
 * The "does this test belong to a lab panel" print tags.
 *
 * A report belongs to a panel when its order line was ordered AS a panel
 * (`OrderItem.branchLabPanelId` set): the per-member reports of a panel and an old
 * combined panel report both sit on such a line, a single test and a free-text line
 * do not. The panel's name and code come from that same line's `BranchLabPanel`.
 *
 * `is_lab_panel` is the text `Yes` or empty (never `No`): the flat template engine
 * treats any text as "true", so an empty value is what makes `{{#if is_lab_panel}}`
 * hide its block. The Latte contexts turn it into a real boolean.
 */
export const LAB_PANEL_FLAG_TEXT = 'Yes';

export interface LabPanelTags {
  is_lab_panel: string;
  lab_panel_name: string;
  lab_panel_code: string;
}

export function labPanelTags(item: {
  branchLabPanelId: string | null;
  branchLabPanel?: { panelName: string; panelCode: string } | null;
}): LabPanelTags {
  if (!item.branchLabPanelId) {
    return { is_lab_panel: '', lab_panel_name: '', lab_panel_code: '' };
  }
  return {
    is_lab_panel: LAB_PANEL_FLAG_TEXT,
    lab_panel_name: item.branchLabPanel?.panelName ?? '',
    lab_panel_code: item.branchLabPanel?.panelCode ?? '',
  };
}
