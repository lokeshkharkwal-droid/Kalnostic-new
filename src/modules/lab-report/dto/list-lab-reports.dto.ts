import { LabReportStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

/** Source pill (LABORATORY.docx §1.1 element 2, §3.2). */
export type ReportSource = 'ALL' | 'IN_HOUSE' | 'OUTSOURCE';

/**
 * Query params for the Reporting Worklist (`GET /lab-reports`) and its live
 * counts sibling (`GET /lab-reports/counts`, same filters minus `status`).
 * `branchId` defaults to the caller's active branch (never trusts the query
 * value across branches — resolved in the controller, mirroring
 * PhlebotomistScheduleController.requireBranch).
 */
export class ListLabReportsDto {
  @IsOptional()
  @IsEnum(LabReportStatus)
  status?: LabReportStatus;

  /**
   * "All Branches" filter (LABORATORY.docx §3.1). Overrides the caller's
   * active branch when supplied — same permissive pattern as
   * `ListOrdersDto.branchId` (any branch in the tenant, no ownership check).
   * Omit to default to the caller's own active branch.
   */
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsIn(['ALL', 'IN_HOUSE', 'OUTSOURCE'])
  source?: ReportSource;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;

  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  branchLabPanelId?: string;

  @IsOptional()
  @IsUUID()
  branchLabTestId?: string;

  /**
   * "All Sample Status" filter (LABORATORY.docx §3.1). Only the two states
   * derivable from `OrderItem.collectedAt` are real today — Accession's own
   * New/Collected/Accepted/... sample lifecycle doesn't exist in the backend
   * yet (see `SAMPLE_STATUS_OPTIONS`).
   */
  @IsOptional()
  @IsIn(['NOT_COLLECTED', 'COLLECTED'])
  sampleStatus?: 'NOT_COLLECTED' | 'COLLECTED';

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  outsource?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  urgent?: boolean;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  homeCollection?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
