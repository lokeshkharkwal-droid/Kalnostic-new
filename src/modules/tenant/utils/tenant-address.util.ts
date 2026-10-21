import { Prisma } from '@prisma/client';

/**
 * The tenant fields a business address is built from — the structured
 * registered address plus its location relations (as loaded by
 * `TenantService.findById`) and the free-form legacy `address` JSON.
 */
export interface TenantAddressSource {
  addressLine: string | null;
  pincode: string | null;
  address: Prisma.JsonValue | null;
  area?: { name: string } | null;
  city?: { name: string } | null;
  state?: { name: string } | null;
  country?: { name: string } | null;
}

/** Keys read (in this order) from a legacy free-form `address` JSON object. */
const LEGACY_ADDRESS_KEYS = [
  'line1',
  'line2',
  'addressLine',
  'street',
  'area',
  'locality',
  'city',
  'state',
  'pincode',
  'pinCode',
  'zip',
  'country',
] as const;

/** Join the non-blank parts with ", ". */
function joinParts(parts: (string | number | null | undefined)[]): string {
  return parts
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean)
    .join(', ');
}

/** One-line address from the legacy `address` JSON (a string or a flat object). */
function legacyAddress(address: Prisma.JsonValue | null): string {
  if (typeof address === 'string') return address.trim();
  if (!address || typeof address !== 'object' || Array.isArray(address)) {
    return '';
  }
  return joinParts(
    LEGACY_ADDRESS_KEYS.map((k) => {
      const v = address[k];
      return typeof v === 'string' || typeof v === 'number' ? v : null;
    }),
  );
}

/**
 * Format the tenant's registered business address as one line, e.g.
 * "12 MG Road, Indiranagar, Bengaluru, Karnataka, 560038, India".
 *
 * The structured fields (address line → area → city → state → pincode →
 * country) win when they carry any detail; tenants created before those fields
 * existed fall back to the legacy `address` JSON. Returns "" when neither has
 * anything.
 */
export function formatTenantAddress(tenant: TenantAddressSource): string {
  const structured = joinParts([
    tenant.addressLine,
    tenant.area?.name,
    tenant.city?.name,
    tenant.state?.name,
    tenant.pincode,
    tenant.country?.name,
  ]);
  const hasDetail =
    !!tenant.addressLine?.trim() ||
    !!tenant.pincode?.trim() ||
    !!tenant.area?.name ||
    !!tenant.city?.name;
  if (hasDetail) return structured;
  return legacyAddress(tenant.address) || structured;
}
