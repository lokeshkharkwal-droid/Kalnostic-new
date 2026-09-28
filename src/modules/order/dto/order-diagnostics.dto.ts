import { SampleSource } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * A single prescription / diagnostic file already uploaded to object storage
 * (via `POST /uploads/attachment`). We keep the original filename alongside the
 * URL so the patient's Documents panel can show a human-readable name. These are
 * persisted as `PatientDocument` rows (category DOCUMENT) at order-create time —
 * see `OrderService.create`.
 */
export class OrderPrescriptionAttachmentDto {
  @IsUrl()
  @MaxLength(2048)
  url: string;

  @IsString()
  @MaxLength(255)
  name: string;
}

/**
 * The Diagnostics section of an order. All fields optional; foreign refs
 * (`diagnosticPanelId`, `phlebotomistId`) are validated in `OrderService`.
 * Charges are integer minor units.
 */
export class OrderDiagnosticsDto {
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  prescriptionUrl?: string;

  /**
   * Prescription / diagnostic files uploaded during order creation. Mapped to
   * the order's patient as `PatientDocument` rows so they surface in the
   * patient's Documents section.
   */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderPrescriptionAttachmentDto)
  prescriptionAttachments?: OrderPrescriptionAttachmentDto[];

  @IsOptional()
  @IsUUID()
  diagnosticPanelId?: string;

  @IsOptional()
  @IsEnum(SampleSource)
  sampleSource?: SampleSource;

  @IsOptional()
  @IsInt()
  @Min(0)
  sampleCollectionCharges?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  logisticsSuppliedBy?: string;

  @IsOptional()
  @IsBoolean()
  isFasting?: boolean;

  @IsOptional()
  @IsBoolean()
  isHomeVisit?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  collectionAddress?: string;

  @IsOptional()
  @IsUUID()
  phlebotomistId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  visitCharges?: number;

  @IsOptional()
  @IsDateString()
  collectionAt?: string;

  /** Appointment date & time for this section (ISO-8601). Required when the
   * order is saved with status APPOINTMENT and this section is filled. */
  @IsOptional()
  @IsDateString()
  appointmentAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  geoLocation?: string;
}
