import { SettlementPartyType } from '@prisma/client';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Min,
} from 'class-validator';

/**
 * Create a settlement from selected collection PAYMENT records (one per collected
 * receipt). The party identity and all money are re-derived server-side from
 * `sourcePaymentIds` — no amounts are accepted from the client. `partyType` is the
 * Collection report panel the settlement is being created from; every source
 * payment's order must carry that party FK. The financial basis is each payment's
 * collected (paid) amount.
 */
export class CreateSettlementDto {
  /** The four settleable party types (from the Collection report panel). */
  @IsEnum(SettlementPartyType)
  partyType: SettlementPartyType;

  /** The selected collection PAYMENT ids (one per collected receipt) to settle. */
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  sourcePaymentIds: string[];

  /**
   * Proposed approved settlement amount (whole rupees). Optional; when omitted the
   * proposed amount defaults to the collected (paid) basis. Server-capped at the
   * collected amount — a settlement can never approve more than was collected.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  approvedAmount?: number;

  /** Settlement date/time (ISO). Optional; defaults to now. */
  @IsOptional()
  @IsDateString()
  settlementDate?: string;

  /** Optional free-text notes. */
  @IsOptional()
  @IsString()
  notes?: string;

  /** Optional URL to a supporting document (file upload is deferred). */
  @IsOptional()
  @IsUrl()
  attachmentUrl?: string;
}
