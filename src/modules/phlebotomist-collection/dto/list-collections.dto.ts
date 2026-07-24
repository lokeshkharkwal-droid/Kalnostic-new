import {
  CollectionPriority,
  CollectionStatus,
  PaymentStatus,
} from '@prisma/client';
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
 * Query parameters for the Collection Schedule list (also reused by the
 * patient-wise report). Extends the shared pagination DTO. `dateFrom`/`dateTo`
 * filter `scheduledCollectionAt` inclusively; `search` matches the patient's
 * name/mobile/UMID, the order code/bill id, or a sample barcode. All optional.
 */
export class ListCollectionsDto extends PaginationQueryDto {
  /** Free-text match on patient name/mobile/UMID, order code/bill id, or barcode. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @IsOptional()
  @IsEnum(CollectionStatus)
  status?: CollectionStatus;

  /**
   * Virtual status group for the Collection Schedule chips. `IN_PROGRESS` maps to
   * the set of active field/lab statuses (see `IN_PROGRESS_COLLECTION_STATUSES`).
   * Ignored when an explicit `status` is also given.
   */
  @IsOptional()
  @IsIn(['IN_PROGRESS'])
  statusGroup?: 'IN_PROGRESS';

  @IsOptional()
  @IsEnum(CollectionPriority)
  priority?: CollectionPriority;

  /** Assigned phlebotomist (a staff Person id). */
  @IsOptional()
  @IsUUID()
  phlebotomistId?: string;

  @IsOptional()
  @IsEnum(PaymentStatus)
  paymentStatus?: PaymentStatus;

  /** Referral (B2B) panel filter (FK). */
  @IsOptional()
  @IsUUID()
  referralPanelId?: string;

  /** Referring doctor filter (the order's `referredByDoctorId` FK). */
  @IsOptional()
  @IsUUID()
  referredById?: string;

  /**
   * Collection type (the FE chip). Only home collections exist server-side today,
   * so this is accepted for forward-compatibility but does not narrow results.
   */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  collectionType?: string;

  /** Inclusive lower bound on `scheduledCollectionAt` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  /** Inclusive upper bound on `scheduledCollectionAt` (ISO-8601 date). */
  @IsOptional()
  @IsDateString()
  dateTo?: string;

  /** Branch override (defaults to the active branch from the JWT). */
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
