import { IsDateString, IsUUID } from 'class-validator';

/** Query for the weekly calendar view: a doctor and the week's start date. */
export class CalendarQueryDto {
  @IsUUID()
  doctorId: string;

  /** ISO `YYYY-MM-DD`; the first day of the 7-day week to render. */
  @IsDateString()
  weekStart: string;
}
