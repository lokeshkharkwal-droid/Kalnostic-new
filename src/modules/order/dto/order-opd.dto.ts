import { ConsultantType, OpdVisitType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

/**
 * The OPD section of an order. `doctorId` is required (a CONSULTANT doctor,
 * validated in `OrderService`). `departmentId` and `categoryId` optional.
 * `consultationAt` is an ISO date-time string.
 */
export class OrderOpdDto {
  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsUUID()
  doctorId: string;

  @IsOptional()
  @IsEnum(ConsultantType)
  consultantType?: ConsultantType;

  @IsOptional()
  @IsEnum(OpdVisitType)
  visitType?: OpdVisitType;

  @IsOptional()
  @IsDateString()
  consultationAt?: string;

  /** Appointment date & time for this section (ISO-8601). Required when the
   * order is saved with status APPOINTMENT and this section is filled. */
  @IsOptional()
  @IsDateString()
  appointmentAt?: string;
}
