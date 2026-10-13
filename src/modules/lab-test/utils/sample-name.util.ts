import type { ImportXlsxSampleNameNotice } from '../entities/lab-test.entity';

/**
 * Standard sample names, and matching a typed name to one of them.
 *
 * `STANDARD_SAMPLE_NAMES` mirrors the frontend's `SAMPLE_TYPES` list (Master Data → Add/Edit Sample →
 * "Sample Name" dropdown). Keep the two in step. The list is NOT enforced: `sample_name` is free text on every
 * path, and real data holds many names that are not on it (X-Ray, Urine-R, ...). It is only used by the Excel
 * import to tidy the spelling of a name that is the same as a standard one apart from capitals, spacing and
 * punctuation ("Pleural fluid" → "Pleural Fluid"). Any other name is kept exactly as typed.
 */
export const STANDARD_SAMPLE_NAMES: readonly string[] = [
  'Amniotic Fluid',
  'Ascitic Fluid',
  'BAL Fluid',
  'Body Fluid - Unspecified',
  'Bone Marrow Aspirate',
  'Clinical Specimen - Miscellaneous',
  'Cord Blood',
  'Core Needle Biopsy',
  'CSF',
  'Culture Isolate / Pure Culture',
  'Exhaled Breath',
  'FNAC Aspirate',
  'Gastric Aspirate',
  'Hair',
  'Heel Prick Blood',
  'Nail Clippings',
  'Pericardial Fluid',
  'Plasma-3.2% Sodium Citrate',
  'Plasma-EDTA',
  'Plasma-Fluoride-F',
  'Plasma-Fluoride-R',
  'Plasma-Fluoride-PP',
  'Plasma-Fluoride-1st Hr GTT',
  'Plasma-Fluoride-2nd Hr GTT',
  'Plasma-Fluoride-3rd Hr GTT',
  'Plasma-Fluoride-GCT',
  'Plasma-Sodium Heparin',
  'Pleural Fluid',
  'Pus / Abscess Aspirate',
  'Renal Biopsy (Electron Microscopy - Glutaraldehyde)',
  "Renal Biopsy (Immunofluorescence - ZEUS/Michel's)",
  "Renal Biopsy (Light Microscopy - Formalin/Michel's)",
  'Saliva',
  'Semen',
  'Serum-Gel',
  'Serum-Plain',
  'Skin Biopsy',
  'Skin Scraping',
  'Smear',
  'Sputum',
  'Stool',
  'Swab-Dry / Plain',
  'Swab-Transport Medium (Amies/Stuart)',
  'Swab-VTM (Viral)',
  'Sweat',
  'Synovial Fluid',
  'Tissue-Fixed (10% NBF)',
  'Tissue-Unfixed (Fresh/Saline)',
  'Tissue / Aspirate - Unspecified',
  'Urine-24Hr (Acetic Acid)',
  'Urine-24Hr (Boric Acid)',
  'Urine-24Hr (Diazolidinyl Urea)',
  'Urine-24Hr (HCl)',
  'Urine-24Hr (No Preservative)',
  'Urine-24Hr (Sodium Carbonate)',
  'Urine-Random (No Preservative)',
  'WB-3.2% Sodium Citrate',
  'WB-3.8% Sodium Citrate (ESR)',
  'WB-Culture Aerobic',
  'WB-Culture Anaerobic',
  'WB-Culture Pediatric',
  'WB-EDTA',
  'WB-Lithium Heparin',
  'WB-Sodium Heparin',
];

/** A name reduced to its letters and digits in lower case, so "Serum (Plain)" and "Serum-Plain" compare equal. */
function matchKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const STANDARD_SET: ReadonlySet<string> = new Set(STANDARD_SAMPLE_NAMES);

/**
 * Match key → standard name. A key that two standard names share is left out, so a typed name is never
 * mapped to a name picked by chance.
 */
const STANDARD_BY_KEY: ReadonlyMap<string, string> = (() => {
  const byKey = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const name of STANDARD_SAMPLE_NAMES) {
    const key = matchKey(name);
    if (byKey.has(key)) ambiguous.add(key);
    else byKey.set(key, name);
  }
  for (const key of ambiguous) byKey.delete(key);
  return byKey;
})();

/** What became of a typed sample name. */
export type SampleNameResolution =
  /** Already a standard name, spelled exactly like it. */
  | { status: 'standard'; name: string }
  /** Same as a standard name apart from capitals, spacing or punctuation: `name` is the standard spelling. */
  | { status: 'mapped'; name: string }
  /** Not a standard name: `name` is the text as typed. */
  | { status: 'custom'; name: string };

/**
 * Match a sample name typed in the Excel sheet to the standard list.
 *
 * @param typed the cell text (already trimmed by the caller)
 * @returns the standard spelling when the name matches one ignoring capitals, spacing and punctuation;
 *   otherwise the text unchanged
 */
export function resolveSampleName(typed: string): SampleNameResolution {
  if (STANDARD_SET.has(typed)) return { status: 'standard', name: typed };
  const key = matchKey(typed);
  const standard = key ? STANDARD_BY_KEY.get(key) : undefined;
  if (standard) return { status: 'mapped', name: standard };
  return { status: 'custom', name: typed };
}

/** A sample name from one test's rows that was tidied or is not a standard name (see `resolveSampleName`). */
export interface SampleNameNote {
  /** The name as typed in the sheet. */
  typed: string;
  /** Set when it was saved under the standard spelling. */
  mappedTo?: string;
}

/**
 * Collapse the per-test notes into the import result's list: one entry per distinct (typed name, standard
 * spelling), counting each test once however many of its samples used the name. A skipped test is left out,
 * because nothing it contained was saved. Most-used first, then alphabetical.
 *
 * @param notesByTest notes keyed by the test's row label (e.g. "Rows 3-8")
 * @param skippedRowLabels row labels of the tests that were skipped
 */
export function summariseSampleNameNotes(
  notesByTest: ReadonlyMap<string, readonly SampleNameNote[]>,
  skippedRowLabels: ReadonlySet<string>,
): ImportXlsxSampleNameNotice[] {
  const bySpelling = new Map<string, ImportXlsxSampleNameNotice>();
  for (const [rowLabel, notes] of notesByTest) {
    if (skippedRowLabels.has(rowLabel)) continue;
    const seenInThisTest = new Set<string>();
    for (const { typed, mappedTo } of notes) {
      const key = `${typed}\u0000${mappedTo ?? ''}`;
      if (seenInThisTest.has(key)) continue;
      seenInThisTest.add(key);
      const existing = bySpelling.get(key);
      if (existing) existing.tests += 1;
      else
        bySpelling.set(key, {
          name: typed,
          ...(mappedTo ? { mappedTo } : {}),
          tests: 1,
        });
    }
  }
  return [...bySpelling.values()].sort(
    (a, b) => b.tests - a.tests || a.name.localeCompare(b.name),
  );
}
