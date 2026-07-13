import { SampleSource } from '@prisma/client';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';

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

  @IsOptional()
  @IsString()
  @MaxLength(255)
  geoLocation?: string;
}
