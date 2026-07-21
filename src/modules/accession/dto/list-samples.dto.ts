import { SampleStatus, SamplePriority } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { TAT_STATUSES } from '../constants/tat.constant';
import type { TatStatus } from '../constants/tat.constant';

/** Order-mode filter values (§A.3 "Order Mode" dropdown). */
export const ORDER_MODES = [
  'Walk-in',
  'Home Visit',
  'Referral',
  'Outsource',
  'Emergency',
] as const;
export type OrderMode = (typeof ORDER_MODES)[number];

/**
 * Query parameters for the accession sample listing (`GET /accession/samples`) —
 * the §A.3 filter panel, §A.5 status tabs and §A.4 TAT bar. Extends the shared
 * pagination DTO. `search` matches the accession number or barcode
 * (case-insensitive). `tatStatus` filters by the derived TAT band (translated to a
 * `createdAt` range in the service). All filters are scoped to the caller's tenant
 * + active branch. Validated by `class-validator` only.
 */
export class ListSamplesDto extends PaginationQueryDto {
  /** Case-insensitive match against the accession number or barcode. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  /** Filter by current lifecycle status (the §A.5 tab). */
  @IsOptional()
  @IsEnum(SampleStatus)
  status?: SampleStatus;

  /** Filter by turnaround priority. */
  @IsOptional()
  @IsEnum(SamplePriority)
  priority?: SamplePriority;

  /** Filter by derived TAT band (§A.4). */
  @IsOptional()
  @IsIn(TAT_STATUSES)
  tatStatus?: TatStatus;

  /** Filter to a single order's samples. */
  @IsOptional()
  @IsUUID()
  orderId?: string;

  /** Filter by the branch the sample was originally collected at. */
  @IsOptional()
  @IsUUID()
  originBranchId?: string;

  /** Filter by the branch responsible for processing. */
  @IsOptional()
  @IsUUID()
  processingBranchId?: string;

  /** Filter by the order's patient. */
  @IsOptional()
  @IsUUID()
  patientId?: string;

  /** Filter by the order's referring doctor. */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Filter by the order's referring panel. */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** Order-date range start (ISO). Filters the linked order's `orderDate`. */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Order-date range end (ISO). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filter by department (via the order's items' branch lab test). */
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  /** Filter to samples whose order includes this branch lab test. */
  @IsOptional()
  @IsUUID()
  branchLabTestId?: string;

  /** Filter to samples whose order includes this branch lab panel. */
  @IsOptional()
  @IsUUID()
  branchLabPanelId?: string;

  /** Order mode (Walk-in / Home Visit / Referral / Outsource / Emergency). */
  @IsOptional()
  @IsIn(ORDER_MODES)
  orderMode?: OrderMode;

  /** Filter by the sample's logistics type. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  logisticsType?: string;

  /** Filter by the (display) report status. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  reportStatus?: string;

  /** Only outsourced samples. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isOutsource?: boolean;

  /** Only urgent/STAT samples (or urgent-billed orders). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isUrgent?: boolean;

  /** Only home-collection (home-visit) samples. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isHomeCollection?: boolean;
}
