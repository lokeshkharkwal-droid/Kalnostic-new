import { escapeHtmlKeepLines } from '../../pdf-report-template/services/pdf-document.util';

/**
 * The Note of ONE result parameter on a printed report (`{result_note}`).
 *
 * Two sources, one result:
 *  - the technician's own text for this report (`LabReportParameterNote.content`) — rich-text HTML from the Notes
 *    editor, used as is. An empty string is a real choice ("no note on this report") and wins over the default;
 *  - otherwise the parameter's configured Note (`LabTestResultParam.notes`) — PLAIN text typed in Master Data, so it is
 *    escaped here (and keeps the line breaks it was typed with). A single-line note comes out exactly as it always did.
 *
 * `{result_note}` is a rich-text tag (see `RICH_TEXT_KEYS` in `template-render.service`), so the value returned here
 * must already be safe HTML — which is why the plain default is escaped and only the technician's HTML is passed through.
 *
 * @param override the technician's text for this report, `undefined` when none was saved
 * @param catalogNote the parameter's configured Note from Master Data
 * @returns the HTML to print; `''` when there is no note
 */
export function effectiveParameterNoteHtml(
  override: string | undefined,
  catalogNote: string | null | undefined,
): string {
  if (override !== undefined) return override;
  const plain = (catalogNote ?? '').trim();
  return plain ? escapeHtmlKeepLines(plain) : '';
}
