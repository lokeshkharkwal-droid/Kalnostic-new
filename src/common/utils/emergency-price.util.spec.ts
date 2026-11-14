import { effectiveLabTestPrice } from './emergency-price.util';

describe('effectiveLabTestPrice', () => {
  it('keeps the list price when emergency pricing does not apply', () => {
    expect(effectiveLabTestPrice(500, 900, false)).toBe(500);
  });

  it('uses the emergency price when emergency pricing applies', () => {
    expect(effectiveLabTestPrice(500, 900, true)).toBe(900);
  });

  it('may be lower than the list price (whatever the test is configured with)', () => {
    expect(effectiveLabTestPrice(500, 300, true)).toBe(300);
  });

  it.each([0, null, undefined, -5])(
    'falls back to the list price when the emergency price is %p (not set)',
    (emergencyPrice) => {
      expect(effectiveLabTestPrice(500, emergencyPrice, true)).toBe(500);
    },
  );
});
