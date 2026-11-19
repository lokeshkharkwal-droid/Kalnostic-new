import {
  STANDARD_SAMPLE_NAMES,
  sampleNameMatchKey,
} from '../../lab-test/utils/sample-name.util';

/**
 * Standard sample types. Mirrors the frontend's `SAMPLE_TYPE_OPTIONS` (Master Data → Add/Edit
 * Sample → "Sample Type" dropdown); keep the two in step. Like the names it is NOT enforced -
 * `sample_type` is free text - it only decides which filter options are "standard" and which are
 * tagged "Other".
 */
export const STANDARD_SAMPLE_TYPES: readonly string[] = [
  'Whole Blood',
  'Serum',
  'Plasma',
  'Urine',
  'Stool',
  'Sputum',
  'Saliva',
  'Sweat',
  'Breath',
  'Swab',
  'Body Fluid',
  'Pus',
  'Semen',
  'Tissue',
  'Smear',
  'Bone Marrow',
  'Skin',
  'Hair',
  'Nail',
  'Dried Blood Spot',
  'Clinical Specimen',
  'Culture Medium / Isolate',
  'Dried Blood Spot (DBS)',
];

/** What a filter dropdown lists for Sample Name or Sample Type. */
export type SampleOptionField = 'name' | 'type';

/** One distinct stored value and how many samples hold it. */
export interface SampleValueCount {
  value: string | null;
  count: number;
}

/**
 * One dropdown entry. Spelling variants ("Serum (Plain)" / "Serum-Plain") are one entry; picking
 * it filters by every spelling in `values`, matched exactly as stored.
 */
export interface SampleOption {
  /** Stable id of the entry (the normalised spelling). */
  key: string;
  /** The standard spelling when there is one, else the most used spelling. */
  label: string;
  /** Every stored spelling the entry stands for. */
  values: string[];
  /** Samples holding any of the spellings. */
  count: number;
  /** True when the entry matches the standard list; the rest are shown as "Other". */
  isStandard: boolean;
}

export interface SampleOptionList {
  /** Samples with no value at all (null or blank): the "Not set" choice. */
  notSetCount: number;
  /** Standard entries first, then the others, each alphabetical. */
  options: SampleOption[];
}

const compareLabels = (a: SampleOption, b: SampleOption): number =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }) ||
  a.label.localeCompare(b.label);

/**
 * Fold the distinct stored values of a column into dropdown entries: variants that differ only in
 * capitals, spacing or punctuation merge (same rule as the Excel import), "Not set" is counted
 * apart, and a standard entry is only listed when the branch actually has it.
 * @param rows the distinct stored values with their sample counts
 * @param field which standard list to compare against
 * @param search optional text; keeps entries whose label or any spelling contains it
 */
export function buildSampleOptions(
  rows: readonly SampleValueCount[],
  field: SampleOptionField,
  search?: string,
): SampleOptionList {
  const standard =
    field === 'name' ? STANDARD_SAMPLE_NAMES : STANDARD_SAMPLE_TYPES;
  const standardByKey = new Map<string, string>();
  for (const s of standard) {
    const key = sampleNameMatchKey(s);
    // A key two standard entries share is left out, so nothing maps to one picked by chance.
    if (standardByKey.has(key)) standardByKey.set(key, '');
    else standardByKey.set(key, s);
  }

  let notSetCount = 0;
  const groups = new Map<string, SampleValueCount[]>();
  for (const row of rows) {
    if (row.value === null || row.value === '') {
      notSetCount += row.count;
      continue;
    }
    // A value with no letters or digits ("-") keeps itself as its key.
    const key = sampleNameMatchKey(row.value) || row.value;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  const options: SampleOption[] = [];
  for (const [key, variants] of groups) {
    const standardLabel = standardByKey.get(key) || undefined;
    const mostUsed = [...variants].sort(
      (a, b) =>
        b.count - a.count ||
        (a.value as string).localeCompare(b.value as string),
    )[0]!;
    options.push({
      key,
      label: standardLabel ?? (mostUsed.value as string),
      values: variants.map((v) => v.value as string).sort(),
      count: variants.reduce((n, v) => n + v.count, 0),
      isStandard: standardLabel !== undefined,
    });
  }

  const needle = search?.trim().toLowerCase();
  const matching = needle
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(needle) ||
          o.values.some((v) => v.toLowerCase().includes(needle)),
      )
    : options;

  return {
    notSetCount,
    options: [
      ...matching.filter((o) => o.isStandard).sort(compareLabels),
      ...matching.filter((o) => !o.isStandard).sort(compareLabels),
    ],
  };
}
