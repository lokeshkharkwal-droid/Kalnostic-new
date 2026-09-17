import { IsArray, IsOptional, IsString } from 'class-validator';

/**
 * Assign (replace) the set of departments a staff user belongs to. The full
 * desired set is sent every time: departments not listed are removed, new ones
 * are added. `defaultDepartmentId`, when present, must be one of
 * `departmentIds` (checked in the service). Tenant-wide — no branch dimension.
 */
export class AssignDepartmentsDto {
  /** The full desired set of department ids. Empty clears all assignments. */
  @IsArray()
  @IsString({ each: true })
  departmentIds: string[];

  /** Which of the selected departments is the user's default (optional). */
  @IsString()
  @IsOptional()
  defaultDepartmentId?: string;
}
