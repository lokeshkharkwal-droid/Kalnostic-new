/** Why emergency pricing applies right now (null = it does not). */
export type EmergencyPricingReason = 'OVERRIDE' | 'NON_OPERATING_HOURS';

/**
 * The resolved emergency-pricing state of a branch at an instant
 * (`GET /registration-settings/emergency-pricing`, and the decision
 * `OrderService` stamps on an order as `isEmergencyPricing`).
 */
export interface EmergencyPricingStatus {
  /** Whether lab-test lines should bill at their Emergency Price now. */
  active: boolean;
  /** `OVERRIDE` wins when both toggles would apply; null when inactive. */
  reason: EmergencyPricingReason | null;
  /** Raw `EmergencyPricing_ApplyEmergencyPricesInNonOperatingHours`. */
  applyInNonOperatingHours: boolean;
  /** Raw `EmergencyPricing_OverrideEmergencyPrices`. */
  overrideEmergencyPrices: boolean;
  /**
   * Whether the branch is inside its operating hours at the instant. Only
   * evaluated when the non-operating-hours toggle is on; null when it was not
   * evaluated or the branch has no operating hours configured.
   */
  branchOpen: boolean | null;
  /** The instant the decision was made for (ISO-8601). */
  evaluatedAt: string;
}
