import { ContainerType, LabReportStatus, OrderType } from '@prisma/client';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { ToStringArray } from '../../../common/decorators/to-string-array.decorator';
import type { CollectionProgress } from '../../../common/utils';
import type { OrderReportStatus } from '../../../common/utils/derive-report-status.util';

/** The Order Console's "Order Status" values (see `deriveReportStatus`). */
const ORDER_REPORT_STATUSES: OrderReportStatus[] = [
  'PENDING',
  'PARTIALLY_COMPLETED',
  'COMPLETED',
  'APPROVED',
  'PUBLISHED',
];

/**
 * The filters that mean the same thing on every accession listing - the In-House
 * list (`ListSamplesDto`) and the Internal / External / Outsourced transfer queues
 * (`ListTransfersDto`). They all describe the SAMPLE (or its order) and are turned
 * into conditions by `buildSampleFilterConditions`, so a filter is declared, validated
 * and applied once and cannot drift between screens.
 */
export class SampleFilterFieldsDto extends PaginationQueryDto {
  /** Filter by the order's referring doctor. */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Filter by the order's referring panel. */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

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

  /**
   * Filter by the order-level sample **collection progress** - derived from the
   * order's workflow items' `collectedAt`: `PENDING` (none collected), `PARTIAL`
   * (some collected), `COLLECTED` (all collected). Distinct from `status` (the
   * 15-stage sample lifecycle). Shares `buildCollectionProgressWhere` with the
   * Order Console's `sampleStatus` filter.
   */
  @IsOptional()
  @IsIn(['PENDING', 'PARTIAL', 'COLLECTED'])
  collectionStatus?: CollectionProgress;

  /**
   * Filter by the status of the sample's REPORT - the same nine statuses the
   * Technician Reporting screen uses (Pending ... Result Rejected). The sample's
   * own `reportStatus` column is never written, so the filter reads the real
   * `LabReport` (see `resolveAsyncSampleFilters`). A sample with no report yet
   * matches no status.
   */
  @IsOptional()
  @IsEnum(LabReportStatus)
  reportStatus?: LabReportStatus;

  /**
   * Filter by the ORDER's overall reporting progress - the Order Console's
   * "Order Status" (Pending, Partially Completed, Completed, Approved, Published),
   * derived from every test of the order by the same rule
   * (`deriveReportStatus`). Distinct from `reportStatus`, which is one test's report.
   */
  @IsOptional()
  @IsIn(ORDER_REPORT_STATUSES)
  orderStatus?: OrderReportStatus;

  /** Only urgent/STAT samples (or urgent-billed orders). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isUrgent?: boolean;

  /**
   * How the order came in (Registration "Order Type"): Walk-In, App or Website.
   * Replaces the old `orderMode` (kept only until the frontend stops sending it).
   */
  @IsOptional()
  @IsEnum(OrderType)
  orderType?: OrderType;

  /** "Billed by": the person who created the order (`Order.createdBy`). */
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  /** Container types (repeat the param for several). */
  @IsOptional()
  @ToStringArray()
  @IsArray()
  @ArrayMaxSize(50)
  @IsEnum(ContainerType, { each: true })
  containerTypes?: ContainerType[];

  /**
   * Sample names, matched EXACTLY as stored. The options list merges spelling
   * variants ("Serum (Plain)" / "Serum-Plain") into one entry, and the entry's
   * variants are sent here (repeat the param). Combine with `sampleNameNotSet`.
   */
  @IsOptional()
  @ToStringArray()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  sampleNames?: string[];

  /** Also include samples that have no sample name. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  sampleNameNotSet?: boolean;

  /** Sample types, matched exactly as stored (see `sampleNames`). */
  @IsOptional()
  @ToStringArray()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  sampleTypes?: string[];

  /** Also include samples that have no sample type. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  sampleTypeNotSet?: boolean;

  /** Samples of tests in this category (resolved through the test's classification). */
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  /** Samples of tests in this subcategory. */
  @IsOptional()
  @IsUUID()
  subCategoryId?: string;
}
