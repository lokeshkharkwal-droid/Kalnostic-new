/**
 * A unit as it is compared: trimmed, runs of whitespace collapsed to one space, lower case.
 * Two spellings that differ only in letter case or surrounding / repeated spaces are the same
 * unit ("g/dL" = "g/dl" = " g/dL "; "uIU/mL" = "uIu/mL").
 *
 * This is deliberately NOT a unit converter and not an alias table: "g / dL" (spaces inside),
 * "10^3/uL" vs "10³/µL" and "g/dL" vs "g/L" stay different. Unknown spellings therefore fail safe
 * (no match) instead of matching the wrong unit. Letter case is ignored on purpose even though SI
 * prefixes are case-sensitive ("mU/L" milli vs "MU/L" mega): no real lab test uses both, and the
 * data we have only shows case typos.
 *
 * The frontend has the identical function in `src/utils/unit-normalize.ts`; both are tested with
 * the same table of cases and must stay in step.
 *
 * @param unit the unit text as stored or typed (may be missing)
 * @returns the unit in its comparison form; "" for a missing or blank unit
 */
export function normalizeUnit(unit: string | null | undefined): string {
  return (unit ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}
