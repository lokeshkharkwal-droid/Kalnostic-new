import { TransferKind, TransferStatus } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

/**
 * Query for the referral/transfer queues (`GET /accession/transfers`) — the
 * Internal (Part B) and External (Part C) Referral Orders lists. `direction`
 * selects incoming (this branch is the destination — the receiving queue) vs
 * outgoing (this branch sent it); defaults to incoming. `kind` picks Internal vs
 * External vs Outsource; `status` is the §B.5 tab. `search` matches the linked
 * sample's accession number. Scoped to the caller's tenant + active branch.
 */
export class ListTransfersDto extends PaginationQueryDto {
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

  /** Case-insensitive match against the linked sample's accession number. */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  search?: string;

  /** Send-date range start (ISO) — filters the transfer's `sendDate`. */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Send-date range end (ISO). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Filter by the linked order's referring doctor. */
  @IsOptional()
  @IsUUID()
  referredByDoctorId?: string;

  /** Filter by the linked order's referring panel. */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** Filter by logistics type. */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  logisticsType?: string;
}
