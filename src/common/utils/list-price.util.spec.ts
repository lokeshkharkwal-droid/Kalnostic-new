import { ListPriceSource } from '@prisma/client';
import {
  computeListPrice,
  resolveImportListPrice,
  resolveSourcePrice,
  resolveSyncListPrice,
  type ListPricingConfig,
  type SourcePriceColumns,
} from './list-price.util';

/** A source row carrying all five price columns (minor units). */
const row: SourcePriceColumns = {
  priceMsrp: 1000,
  priceMaximum: 900,
  priceMinimum: 400,
  priceOriginal: 800,
  franchisePrice: 600,
};

/** Build a list pricing config, defaulting the unused fields. */
const cfg = (over: Partial<ListPricingConfig>): ListPricingConfig => ({
  isDefault: false,
  priceType: 'CUSTOMIZED',
  copyPriceFrom: 'MSRP',
  copyPercentage: null,
  ...over,
});

describe('resolveSourcePrice', () => {
  it.each<[ListPriceSource, number]>([
    ['MSRP', 1000],
    ['MAXIMUM', 900],
    ['MINIMUM', 400],
    ['ORIGINAL', 800],
    ['FRANCHISE', 600],
  ])('reads the %s column', (source, expected) => {
    expect(resolveSourcePrice(row, source)).toBe(expected);
  });
});

describe('computeListPrice', () => {
  it('rounds percentage of base', () => {
    expect(computeListPrice(1000, 'PERCENTAGE', 50)).toBe(500);
    expect(computeListPrice(1500, 'PERCENTAGE', 50)).toBe(750);
    expect(computeListPrice(333, 'PERCENTAGE', 50)).toBe(167); // round(166.5)
  });

  it('treats a null percentage as 0', () => {
    expect(computeListPrice(1000, 'PERCENTAGE', null)).toBe(0);
  });

  it('copies the base as-is for CUSTOMIZED', () => {
    expect(computeListPrice(1000, 'CUSTOMIZED', 50)).toBe(1000);
  });
});

describe('resolveImportListPrice (new row)', () => {
  it('seeds the default (Walk-in) list at MSRP', () => {
    expect(resolveImportListPrice(row, cfg({ isDefault: true }))).toBe(1000);
  });

  it('applies the formula for a PERCENTAGE list', () => {
    const c = cfg({
      priceType: 'PERCENTAGE',
      copyPriceFrom: 'MSRP',
      copyPercentage: 50,
    });
    expect(resolveImportListPrice(row, c)).toBe(500);
  });

  it('applies the formula against any source column', () => {
    const c = cfg({
      priceType: 'PERCENTAGE',
      copyPriceFrom: 'FRANCHISE',
      copyPercentage: 50,
    });
    expect(resolveImportListPrice(row, c)).toBe(300); // 600 × 50%
  });

  it('copies the source column as-is for a CUSTOMIZED list', () => {
    const c = cfg({ priceType: 'CUSTOMIZED', copyPriceFrom: 'MINIMUM' });
    expect(resolveImportListPrice(row, c)).toBe(400);
  });
});

describe('resolveSyncListPrice (existing row)', () => {
  it('recomputes the default (Walk-in) list to MSRP', () => {
    const c = cfg({ isDefault: true });
    // MSRP rose 1000 → 1500 in master; Walk-in tracks it.
    expect(resolveSyncListPrice({ ...row, priceMsrp: 1500 }, c)).toBe(1500);
  });

  it('recomputes a PERCENTAGE list from the fresh source × stored percentage', () => {
    const c = cfg({
      priceType: 'PERCENTAGE',
      copyPriceFrom: 'MSRP',
      copyPercentage: 50,
    });
    // The ticket example: MSRP 1000 → 1500 ⇒ list price 500 → 750.
    expect(resolveSyncListPrice({ ...row, priceMsrp: 1500 }, c)).toBe(750);
  });

  it('returns null for a CUSTOMIZED (non-default) list so the price is preserved', () => {
    const c = cfg({ priceType: 'CUSTOMIZED' });
    expect(resolveSyncListPrice({ ...row, priceMsrp: 1500 }, c)).toBeNull();
  });

  it('preserves CUSTOMIZED regardless of which source column was configured', () => {
    for (const copyPriceFrom of [
      'MSRP',
      'MAXIMUM',
      'MINIMUM',
      'ORIGINAL',
      'FRANCHISE',
    ] as ListPriceSource[]) {
      const c = cfg({ priceType: 'CUSTOMIZED', copyPriceFrom });
      expect(resolveSyncListPrice(row, c)).toBeNull();
    }
  });
});
