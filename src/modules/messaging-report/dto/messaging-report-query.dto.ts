import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  Matches,
  Min,
} from 'class-validator';
import {
  SMS_REPORT_STATUSES,
  WHATSAPP_REPORT_STATUSES,
} from '../entities/messaging-report.types';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Lower-cases and trims a status; an empty value means "All" (no filter). */
const normaliseStatus = ({ value }: { value: unknown }): unknown => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toLowerCase();
  return trimmed === '' ? undefined : trimmed;
};

/**
 * Shared filters of the messaging reports. The date range is required (the
 * legacy screens marked Date as required) and is inclusive of both whole days
 * in the gateway's local time. There is no `limit`: the Exchange fixes the
 * page size.
 */
export class MessagingReportQueryDto {
  /** First day, `YYYY-MM-DD` (inclusive, from 00:00:00). */
  @Matches(DATE_ONLY, { message: 'dateFrom must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  dateFrom: string;

  /** Last day, `YYYY-MM-DD` (inclusive, to 23:59:59). */
  @Matches(DATE_ONLY, { message: 'dateTo must be YYYY-MM-DD' })
  @IsDateString({ strict: true })
  dateTo: string;

  /** 1-based page number (defaults to 1). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;
}

/** WhatsApp Report filters. */
export class WhatsappReportQueryDto extends MessagingReportQueryDto {
  /** Provider delivery status; omit (or send empty) for All. Case-insensitive. */
  @IsOptional()
  @Transform(normaliseStatus)
  @IsIn(WHATSAPP_REPORT_STATUSES)
  status?: (typeof WHATSAPP_REPORT_STATUSES)[number];
}

/** SMS Report filters. */
export class SmsReportQueryDto extends MessagingReportQueryDto {
  /** Provider delivery status; omit (or send empty) for All. Case-insensitive. */
  @IsOptional()
  @Transform(normaliseStatus)
  @IsIn(SMS_REPORT_STATUSES)
  status?: (typeof SMS_REPORT_STATUSES)[number];
}
