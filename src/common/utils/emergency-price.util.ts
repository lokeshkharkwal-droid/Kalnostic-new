/**
 * The unit price a catalogue LAB TEST line bills at, given whether emergency
 * pricing applies to the order (Registration Settings → Emergency Pricing).
 *
 * When emergency pricing applies and the test has a positive `emergencyPrice`,
 * that price is used; otherwise (pricing not active, or no emergency price set
 * on the test — stored as 0) the normal list price is kept, so a test without
 * an emergency price is never billed at 0. Panels have no emergency price and
 * never go through this helper.
 *
 * Mirrored 1:1 by the frontend's `effectiveLabTestPrice` so the Create Order
 * screen shows exactly what the server bills.
 * @param listPrice the list row's normal price (minor units)
 * @param emergencyPrice the list row's emergency price (minor units; 0 = unset)
 * @param emergency whether emergency pricing applies to the order
 */
export function effectiveLabTestPrice(
  listPrice: number,
  emergencyPrice: number | null | undefined,
  emergency: boolean,
): number {
  if (emergency && emergencyPrice != null && emergencyPrice > 0) {
    return emergencyPrice;
  }
  return listPrice;
}
