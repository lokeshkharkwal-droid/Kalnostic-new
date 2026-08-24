import { IsIn, IsOptional, IsString } from 'class-validator';

/**
 * Query params for the Registration dashboard's "Appointments – Status"
 * summary endpoint. `branchId` accepts a real branch id, the literal
 * `"all"` (a Business Admin's "All Branches" aggregate), or is omitted (real
 * validation happens in the controller's `resolveBranchScope`). `module`
 * selects which bucket to show; defaults to `'diagnostic'` in the controller
 * when omitted. `'diagnostic'`/`'phlebotomist'` are both derived from the
 * same `AppointmentType.DIAGNOSTIC` value, split by whether the linked
 * order's diagnostics section has `isHomeVisit` set — "Phlebotomist" is not
 * a real `AppointmentType`. `'consultant'`/`'radiologist'` are disabled
 * placeholders for now — always return an all-zero breakdown.
 */
export class RegistrationAppointmentsStatusQueryDto {
  @IsString()
  @IsOptional()
  branchId?: string;

  @IsIn(['diagnostic', 'phlebotomist', 'consultant', 'radiologist'])
  @IsOptional()
  module?: 'diagnostic' | 'phlebotomist' | 'consultant' | 'radiologist';
}
