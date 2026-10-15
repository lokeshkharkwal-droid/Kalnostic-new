import { escapeHtml } from '../../pdf-report-template/services/pdf-document.util';

/**
 * Multi-line value (a Qualitative result written over several lines): shown as its own left-aligned block, keeping every
 * line break, blank line, run of spaces and indentation exactly as typed. Left-aligned because the template's result cell is
 * usually centred, which would push a layout the user wrote by hand out of shape.
 */
const MULTI_LINE_STYLE = 'display:block;white-space:pre-wrap;text-align:left';

/** A one-line value with spaces or tabs HTML would collapse: kept as typed, but still centred like any other value. */
const SPACED_STYLE = 'white-space:pre-wrap';

/**
 * The HTML a result reading prints as (`{observed1}` / `{observed2}`): the text escaped, with its whitespace kept as the
 * user typed it when it has any that HTML would otherwise squash (line breaks, tabs, a run of spaces, leading or trailing
 * spaces). An ordinary one-line value is only escaped, exactly as before.
 *
 * @param raw the reading as saved
 * @returns safe HTML for a print template
 */
export function observedValueHtml(raw: string): string {
  if (/[\r\n]/.test(raw)) {
    return `<span style="${MULTI_LINE_STYLE}">${escapeHtml(raw.replace(/\r\n?/g, '\n'))}</span>`;
  }
  if (/\t| {2,}|^ | $/.test(raw)) {
    return `<span style="${SPACED_STYLE}">${escapeHtml(raw)}</span>`;
  }
  return escapeHtml(raw);
}
