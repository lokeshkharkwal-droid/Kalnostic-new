import { TransferKind, TransferStatus } from '@prisma/client';
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
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';
import {
  TRANSFER_SORT_KEYS,
  type SortDirection,
  type TransferSortKey,
} from '../utils/transfer-sort.util';
import { SampleFilterFieldsDto } from './sample-filter-fields.dto';

/**
 * Query for the referral/transfer queues (`GET /accession/transfers`) — the
 * Internal (Part B), External (Part C) and Outsourced referral lists. `direction`
 * selects incoming (this branch is the destination — the receiving queue) vs
 * outgoing (this branch sent it); defaults to incoming. `kind` picks Internal vs
 * External vs Outsource; `status` is the §B.5 tab. `search` matches the linked
 * sample's barcode, order id and patient name / UHID / mobile.
 *
 * The filters about the sample or its order (order type, report / order / collection
 * status, category, sample name / type, container, billed by, urgent, referral, ...) come
 * from `SampleFilterFieldsDto`, shared with the In-House list. The ones declared here
 * describe the TRANSFER itself (where it went, when, how it travelled). Scoped to the
 * caller's tenant + active branch.
 */
export class ListTransfersDto extends SampleFilterFieldsDto {
  /** Incoming (receiving queue) or outgoing (sent from this branch). */
  @IsOptional()
  @IsIn(['incoming', 'outgoing'])
  direction?: 'incoming' | 'outgoing';

  /** Transfer kind (Internal / External / Outsource). */
  @IsOptional()
  @IsEnum(TransferKind)
  kind?: TransferKind;

  /** Filter by transfer status (the §B.5 tab). */
  @IsOptional()
  @IsEnum(TransferStatus)
  status?: TransferStatus;

  /**
   * Case-insensitive match against the linked sample's barcode, its order id
   * (`orderCode`) and the patient's name, UHID or mobile number. The accession
   * number is not searched.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  /**
   * Send / Forward / Outsource date range start (ISO) — filters the transfer's own
   * `sendDate`. A day-only value starts at the beginning of that day.
   */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Send / Forward / Outsource date range end (ISO); a day-only value covers that whole day. */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Order Creation Date range start (ISO) — filters the linked order's `orderDate`. */
  @IsOptional()
  @IsDateString()
  orderDateFrom?: string;

  /** Order Creation Date range end (ISO); a day-only value covers that whole day. */
  @IsOptional()
  @IsDateString()
  orderDateTo?: string;

  /** Filter by logistics type. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  logisticsType?: string;

  /** Part of the logistics person's name typed on the transfer (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  logisticsPerson?: string;

  /** Part of the sample form typed on the transfer (e.g. "Whole Tube"; case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(150)
  sampleForm?: string;

  /** "Sent From": only transfers sent from this branch. */
  @IsOptional()
  @IsUUID()
  originBranchId?: string;

  /** "Sent To": only transfers addressed to this branch. */
  @IsOptional()
  @IsUUID()
  destinationBranchId?: string;

  /** "Forwarded To": part of the external partner's name (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  externalPartnerName?: string;

  /** Only transfers outsourced to this outsource center. */
  @IsOptional()
  @IsUUID()
  outsourceCenterId?: string;

  /** "Branch" of the Outsourced screen: the branch where the linked order was created. */
  @IsOptional()
  @IsUUID()
  orderBranchId?: string;

  /** Only home-visit orders. */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  isHomeVisit?: boolean;

  /**
   * Column to sort by (applied BEFORE paging). Without it the list is newest first. Name columns
   * (department, origin / destination branch, outsource center) sort by the resolved name.
   */
  @IsOptional()
  @IsIn(TRANSFER_SORT_KEYS)
  sortBy?: TransferSortKey;

  /** Sort direction; defaults to `asc`. Rows with no value in the column are always last. */
  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortOrder?: SortDirection;
}
