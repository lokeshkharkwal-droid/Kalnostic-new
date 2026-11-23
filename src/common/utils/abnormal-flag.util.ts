import { AbnormalFlag, ResultType } from '@prisma/client';

/**
 * Style rules for the Abnormal Flag Logic (spec v1.3).
 *
 * A parameter's abnormal style is one of 16 `AbnormalFlag` values: 9 BASIC styles and
 * 7 "…and High Low" variants. A High Low variant prints like the basic style it extends
 * but also puts the word High or Low beside a Quantitative value that is outside its
 * reference range. That only makes sense for a Quantitative result, so:
 *  - a High Low style may only be saved on a QUANTITATIVE parameter;
 *  - a High Low style is never offered to the Technician as a Highlight choice;
 *  - changing a parameter away from Quantitative turns its High Low style back into the
 *    basic style it extends.
 *
 * Kept in one place so the Master Data API, the Excel import, the report-entry API and
 * the print code can never disagree.
 */

/** Each "…and High Low" style → the basic style it extends. */
const HIGH_LOW_BASE: Readonly<Partial<Record<AbnormalFlag, AbnormalFlag>>> = {
  [AbnormalFlag.RED_HIGH_LOW]: AbnormalFlag.RED_ONLY,
  [AbnormalFlag.BOLD_HIGH_LOW]: AbnormalFlag.BOLD_ONLY,
  [AbnormalFlag.ITALIC_HIGH_LOW]: AbnormalFlag.ITALIC,
  [AbnormalFlag.BOLD_AND_ITALIC_HIGH_LOW]: AbnormalFlag.BOLD_AND_ITALIC,
  [AbnormalFlag.BOLD_AND_RED_HIGH_LOW]: AbnormalFlag.BOLD_AND_RED,
  [AbnormalFlag.ITALIC_AND_RED_HIGH_LOW]: AbnormalFlag.ITALIC_AND_RED,
  [AbnormalFlag.BOLD_ITALIC_AND_RED_HIGH_LOW]: AbnormalFlag.BOLD_ITALIC_AND_RED,
};

/** The seven Quantitative-only "…and High Low" styles. */
export const HIGH_LOW_STYLES: readonly AbnormalFlag[] = Object.keys(
  HIGH_LOW_BASE,
) as AbnormalFlag[];

/**
 * The nine basic styles, in display order. These are what a Semi-Quantitative or
 * Qualitative parameter can use, and the only styles in the Technician's Highlight
 * dropdown.
 */
export const BASIC_STYLES: readonly AbnormalFlag[] = [
  AbnormalFlag.RED_ONLY,
  AbnormalFlag.BOLD_ONLY,
  AbnormalFlag.ITALIC,
  AbnormalFlag.BOLD_AND_ITALIC,
  AbnormalFlag.BOLD_AND_RED,
  AbnormalFlag.ITALIC_AND_RED,
  AbnormalFlag.BOLD_ITALIC_AND_RED,
  AbnormalFlag.UNDERLINE,
  AbnormalFlag.COLOUR_HIGHLIGHT,
];

/**
 * The style the Technician's Highlight starts on (and prints in) when the parameter has NO style set —
 * the style of a parameter is optional. Only Highlight uses it: a Default reading of a parameter without a
 * style is never styled. Kept in one place so it is a one-line change if the decision changes.
 */
export const HIGHLIGHT_FALLBACK_STYLE: AbnormalFlag = AbnormalFlag.BOLD_AND_RED;

/**
 * The label shown for each style on screen and written to / read from the Excel file.
 * "Bold Italic" replaces the old label "Italic Bold" (same style); a High Low style is
 * its basic label + "with High and Low", as in the spec ("Bold and Red with High and Low").
 */
export const ABNORMAL_FLAG_LABELS: Readonly<Record<AbnormalFlag, string>> = {
  [AbnormalFlag.RED_ONLY]: 'Red',
  [AbnormalFlag.BOLD_ONLY]: 'Bold',
  [AbnormalFlag.ITALIC]: 'Italic',
  [AbnormalFlag.BOLD_AND_ITALIC]: 'Bold Italic',
  [AbnormalFlag.BOLD_AND_RED]: 'Bold and Red',
  [AbnormalFlag.ITALIC_AND_RED]: 'Italic and Red',
  [AbnormalFlag.BOLD_ITALIC_AND_RED]: 'Bold Italic and Red',
  [AbnormalFlag.UNDERLINE]: 'Underline',
  [AbnormalFlag.COLOUR_HIGHLIGHT]: 'Colour Highlight',
  [AbnormalFlag.RED_HIGH_LOW]: 'Red with High and Low',
  [AbnormalFlag.BOLD_HIGH_LOW]: 'Bold with High and Low',
  [AbnormalFlag.ITALIC_HIGH_LOW]: 'Italic with High and Low',
  [AbnormalFlag.BOLD_AND_ITALIC_HIGH_LOW]: 'Bold Italic with High and Low',
  [AbnormalFlag.BOLD_AND_RED_HIGH_LOW]: 'Bold and Red with High and Low',
  [AbnormalFlag.ITALIC_AND_RED_HIGH_LOW]: 'Italic and Red with High and Low',
  [AbnormalFlag.BOLD_ITALIC_AND_RED_HIGH_LOW]:
    'Bold Italic and Red with High and Low',
};

/**
 * Every label the Excel import accepts for a style → its enum value (the importer
 * matches case-insensitively): the current labels, the enum names themselves, and the
 * one legacy label "Italic Bold" that older files and screens used for Bold Italic.
 */
export const ABNORMAL_FLAG_IMPORT_LABELS: Readonly<Record<string, string>> =
  Object.freeze({
    ...Object.fromEntries(
      Object.entries(ABNORMAL_FLAG_LABELS).map(([flag, label]) => [
        label,
        flag,
      ]),
    ),
    ...Object.fromEntries(Object.values(AbnormalFlag).map((f) => [f, f])),
    'Italic Bold': AbnormalFlag.BOLD_AND_ITALIC,
  });

/**
 * Whether a style is one of the "…and High Low" variants.
 *
 * @param flag the style to test
 * @returns true for the seven High Low styles, false for the nine basic ones
 */
export function isHighLowStyle(flag: AbnormalFlag): boolean {
  return HIGH_LOW_BASE[flag] !== undefined;
}

/**
 * The basic style a style prints like: a High Low variant returns the style it
 * extends (e.g. `RED_HIGH_LOW` → `RED_ONLY`); a basic style returns itself.
 *
 * @param flag any style
 * @returns a basic style
 */
export function baseStyleOf(flag: AbnormalFlag): AbnormalFlag {
  return HIGH_LOW_BASE[flag] ?? flag;
}

/**
 * Whether a style may be saved on a parameter of this result type. Every style is
 * allowed on a QUANTITATIVE parameter; only the nine basic styles are allowed on
 * SEMI_QUANTITATIVE and QUALITATIVE ones.
 *
 * @param flag the style
 * @param resultType the parameter's result type
 */
export function isStyleAllowedForResultType(
  flag: AbnormalFlag | null | undefined,
  resultType: ResultType,
): boolean {
  // No style at all (the parameter's style is optional) is valid for every result type.
  if (flag === null || flag === undefined) return true;
  return resultType === ResultType.QUANTITATIVE || !isHighLowStyle(flag);
}

/**
 * The style to keep when a parameter's result type changes to `resultType`: unchanged
 * if still allowed, otherwise the basic style it extends (a Quantitative parameter's
 * "Red and High Low" becomes "Red" when it turns Qualitative).
 *
 * @param flag the style the parameter currently has
 * @param resultType the new result type
 */
export function styleForResultType(
  flag: AbnormalFlag | null,
  resultType: ResultType,
): AbnormalFlag | null {
  if (flag === null) return null;
  return isStyleAllowedForResultType(flag, resultType)
    ? flag
    : baseStyleOf(flag);
}

/**
 * The message shown when an Excel cell holds a style the system does not have. It names
 * the word that was typed and lists every allowed label (in display order), keeping the
 * seven Quantitative-only "…with High and Low" styles apart so the user knows which can
 * go where. Nothing is saved for a row that fails with this message.
 *
 * @param typed what the user put in the cell
 * @returns a one-line message for the import summary
 */
export function invalidAbnormalStyleMessage(typed: unknown): string {
  const raw = typeof typed === 'string' ? typed.trim() : '';
  const shown = raw.length > 40 ? `${raw.slice(0, 40)}…` : raw;
  const basic = BASIC_STYLES.map((f) => ABNORMAL_FLAG_LABELS[f]).join(', ');
  const highLow = HIGH_LOW_STYLES.map((f) => ABNORMAL_FLAG_LABELS[f]).join(
    ', ',
  );
  return (
    `Abnormal Flag Logic "${shown}" is not a style the system has, so nothing was saved for this test. ` +
    `Use one of: ${basic}. For Quantitative results only, you can also use: ${highLow}.`
  );
}
