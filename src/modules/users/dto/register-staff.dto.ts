import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

/** Payload to register a staff member (person + credentials + initial profile). */
export class RegisterStaffDto {
  @IsString()
  @MaxLength(100)
  firstName: string;

  @IsString()
  @IsOptional()
  @MaxLength(100)
  lastName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(30)
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  /** Branch to assign the initial profile at. Omit for tenant-level profiles. */
  @IsString()
  @IsOptional()
  branchId?: string;

  /** Profile key from the registry (e.g. 'lab_technician'). */
  @IsString()
  profileKey: string;
}
