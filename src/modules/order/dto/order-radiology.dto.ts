import { IsDateString, IsOptional, IsUUID } from 'class-validator';

/**
 * The Radiology section of an order. `radiologistId` is required and references
 * the Radiologist master table; `radiologistDepartmentId` → Department,
 * `radiologistCategoryId` → Category and `radiologyTechnicianId` → Person (the
 * radiology technician is a Person) are optional. All validated in `OrderService`.
 */
export class OrderRadiologyDto {
  @IsUUID()
  radiologistId: string;

  @IsOptional()
  @IsUUID()
  radiologistDepartmentId?: string;

  @IsOptional()
  @IsUUID()
  radiologistCategoryId?: string;

  @IsOptional()
  @IsUUID()
  radiologyTechnicianId?: string;

  /** Appointment date & time for this section (ISO-8601). Required when the
   * order is saved with status APPOINTMENT and this section is filled. */
  @IsOptional()
  @IsDateString()
  appointmentAt?: string;
}
