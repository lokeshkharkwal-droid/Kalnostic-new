import { SampleStatus, SamplePriority } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import { TAT_STATUSES } from '../constants/tat.constant';
import { DEPARTMENT_FILTER_PATTERN } from '../constants/department-filter.constant';
import type { TatStatus } from '../constants/tat.constant';
import { SampleFilterFieldsDto } from './sample-filter-fields.dto';
import { IN_HOUSE_SORT_KEYS } from '../utils/in-house-sort.util';
import type { InHouseSortKey } from '../utils/in-house-sort.util';
import type { SortDirection } from '../utils/transfer-sort.util';

/** A calendar day (`YYYY-MM-DD`) — the transfer-date filters match the whole day. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

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
 * the §A.3 filter panel, §A.5 status tabs and §A.4 TAT bar. Extends the filters shared
 * with the transfer queues (`SampleFilterFieldsDto`). `search` is the Global Search
 * (see the field below: barcode, order id, patient name / UHID / mobile, referral panel
 * and test / panel name; case-insensitive). `tatStatus`
 * filters by the derived TAT band (translated to a `createdAt` range in the
 * service). All filters are scoped to the caller's tenant + active branch.
 * Validated by `class-validator` only.
 */
export class ListSamplesDto extends SampleFilterFieldsDto {
  /**
   * Global Search: case-insensitive match against the barcode, order id
   * (`orderCode`), patient name (every word, in any order), patient UHID, patient
   * mobile number, referral panel name, or the test / panel name on the order.
   * The accession number is not searched.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  /**
   * Sort the In-House list (`/accession/samples/grouped`) by a column. The list pages by order, so an
   * order is ranked by its smallest value when sorting ascending and its largest when descending.
   * Absent = newest first. Ignored by the other endpoints that share this query.
   */
  @IsOptional()
  @IsIn(IN_HOUSE_SORT_KEYS)
  sortBy?: InHouseSortKey;

  /** Sort direction; defaults to `asc`. Orders with no value in the column are always last. */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortDirection;

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

  /** Order-date range start (ISO). Filters the linked order's `orderDate`. */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Order-date range end (ISO). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /**
   * Filter by department: a department id, or `none` for samples with no department.
   * Judged on the SAMPLE's own department (stamped when the sample was created).
   * Redeclared here on purpose: this REPLACES the parent's UUID-only check, so `none`
   * is accepted on the In-House list only. The transfer queues share the parent
   * (`SampleFilterFieldsDto`) and keep rejecting `none`. The `= undefined` initializer
   * is only there because TypeScript requires one when a subclass redeclares a base
   * property; it changes nothing at runtime.
   */
  @IsOptional()
  @Matches(DEPARTMENT_FILTER_PATTERN, {
    message: 'departmentId must be a UUID or "none"',
  })
  departmentId?: string = undefined;

  /** Order mode (Walk-in / Home Visit / Referral / Outsource / Emergency). */
  @IsOptional()
  @IsIn(ORDER_MODES)
  orderMode?: OrderMode;

  /** Filter by the sample's logistics type. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  logisticsType?: string;

  /** Only outsourced samples. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isOutsource?: boolean;

  /** Only home-collection (home-visit) samples. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isHomeCollection?: boolean;

  /** Filter by the order's internal referral (the referring employee). */
  @IsOptional()
  @IsUUID()
  internalReferralId?: string;

  /** Filter by the order's external referral (the referring partner). */
  @IsOptional()
  @IsUUID()
  externalReferralId?: string;

  /** Filter by the branch of the order's internal referral (its "center"). */
  @IsOptional()
  @IsUUID()
  internalReferralBranchId?: string;

  /**
   * Filter by the organisation of the order's external referral (its
   * "center"). Exact, case-insensitive match on `organisationName`.
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalReferralOrganisation?: string;

  /** Only samples outsourced to this outsource center (OUTSOURCE transfer). */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /** Only samples Sent (INTERNAL transfer) on this day (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'sendDate must be YYYY-MM-DD' })
  sendDate?: string;

  /** Only samples Forwarded (EXTERNAL transfer) on this day (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'forwardDate must be YYYY-MM-DD' })
  forwardDate?: string;

  /** Only samples Outsourced (OUTSOURCE transfer) on this day (YYYY-MM-DD). */
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY, { message: 'outsourceDate must be YYYY-MM-DD' })
  outsourceDate?: string;

  /**
   * Only samples currently Sent (INTERNAL transfer) to this branch - the sender's "where did I
   * send it" filter. A sample the receiving branch sent back ("Sent - Repeated") still counts,
   * because it stays Sent until the sender decides; one that was retrieved or repeated does not.
   */
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  /**
   * Only samples currently Forwarded (EXTERNAL transfer) to a partner whose name contains this
   * text (case-insensitive).
   */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalPartnerName?: string;

  /** Part of the logistics person's name typed when the sample was sent (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  logisticsPerson?: string;

  /** Part of the storage location typed when the sample was stored (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  storeLocation?: string;

  /** Samples discarded with this method (one of the branch's Discard Methods). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  discardMethod?: string;
}
