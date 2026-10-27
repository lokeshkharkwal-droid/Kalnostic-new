import { IsOptional, IsUUID } from 'class-validator';

/**
 * Query for `GET /orders/patient-dues` — the patient whose outstanding previous
 * dues (summed across their active, non-cancelled orders at the active branch)
 * should be returned so the Create Order screen can display + pre-validate them.
 */
export class PatientDuesQueryDto {
  /** The patient to compute outstanding dues for. */
  @IsUUID()
  patientId: string;

  /**
   * The order currently being edited, if any — excluded from the outstanding
   * total so an order's OWN unpaid balance is never shown/charged as its
   * "previous dues". Matches the server-side previous-dues gate (which also
   * excludes the order being finalized), so the Create screen's figure and the
   * finalize-time check always agree. Omitted when creating a brand-new order.
   */
  @IsOptional()
  @IsUUID()
  excludeOrderId?: string;
}
