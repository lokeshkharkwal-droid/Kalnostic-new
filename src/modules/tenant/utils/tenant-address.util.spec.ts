import {
  formatTenantAddress,
  TenantAddressSource,
} from './tenant-address.util';

const blank: TenantAddressSource = {
  addressLine: null,
  pincode: null,
  address: null,
  area: null,
  city: null,
  state: null,
  country: null,
};

describe('formatTenantAddress', () => {
  it('joins the structured address in line → area → city → state → pincode → country order', () => {
    expect(
      formatTenantAddress({
        ...blank,
        addressLine: '12 MG Road',
        area: { name: 'Indiranagar' },
        city: { name: 'Bengaluru' },
        state: { name: 'Karnataka' },
        pincode: '560038',
        country: { name: 'India' },
      }),
    ).toBe('12 MG Road, Indiranagar, Bengaluru, Karnataka, 560038, India');
  });

  it('skips blank structured parts', () => {
    expect(
      formatTenantAddress({
        ...blank,
        addressLine: '  ',
        city: { name: 'Pune' },
        pincode: '411001',
      }),
    ).toBe('Pune, 411001');
  });

  it('prefers the structured fields over the legacy JSON when they carry detail', () => {
    expect(
      formatTenantAddress({
        ...blank,
        addressLine: '1 New Street',
        address: { line1: 'Old Street', city: 'Pune' },
      }),
    ).toBe('1 New Street');
  });

  it('falls back to the legacy address JSON object', () => {
    expect(
      formatTenantAddress({
        ...blank,
        address: { line1: '1 Flow Street', city: 'Pune', country: 'IN' },
      }),
    ).toBe('1 Flow Street, Pune, IN');
  });

  it('falls back to the legacy JSON when only the country is structured', () => {
    expect(
      formatTenantAddress({
        ...blank,
        country: { name: 'India' },
        address: { line1: '1 Flow Street', pincode: 411001 },
      }),
    ).toBe('1 Flow Street, 411001');
  });

  it('accepts a legacy address stored as a plain string', () => {
    expect(
      formatTenantAddress({ ...blank, address: ' 5 Lab Lane, Pune ' }),
    ).toBe('5 Lab Lane, Pune');
  });

  it('ignores non-text legacy values and unknown keys', () => {
    expect(
      formatTenantAddress({
        ...blank,
        address: { line1: { nested: true }, city: 'Pune', gst: 'X' },
      }),
    ).toBe('Pune');
  });

  it('returns the country alone when nothing else is known', () => {
    expect(formatTenantAddress({ ...blank, country: { name: 'India' } })).toBe(
      'India',
    );
  });

  it('returns an empty string when the tenant has no address', () => {
    expect(formatTenantAddress(blank)).toBe('');
    expect(formatTenantAddress({ ...blank, address: [] })).toBe('');
  });
});
