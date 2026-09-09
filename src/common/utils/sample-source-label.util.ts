import { SampleSource } from '@prisma/client';

/**
 * Human-readable label for an order's `SampleSource` (`OrderDiagnostics.
 * sampleSource`), for display in print templates (`{sample_source_label}`) —
 * mirrors `genderLabel`'s pattern (`gender-label.util.ts`).
 */
export function sampleSourceLabel(
  source: SampleSource | null | undefined,
): string {
  switch (source) {
    case SampleSource.SUPPLIED:
      return 'Supplied';
    case SampleSource.IN_HOUSE:
      return 'In-House';
    default:
      return '';
  }
}
