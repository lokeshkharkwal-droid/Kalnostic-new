import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

/** A holiday/exception date on which the schedule generates no slots. */
export class ScheduleHolidayDto {
  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  remarks?: string;
}
