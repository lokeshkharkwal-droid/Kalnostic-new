import { IsDateString, IsUUID } from 'class-validator';

/**
 * Query for the weekly calendar view: a phlebotomist and the week's start date.
 * Previous/next week is served by passing a different `weekStart`.
 */
export class CalendarQueryDto {
  @IsUUID()
  phlebotomistId: string;

  /** ISO `YYYY-MM-DD`; the first day of the 7-day week to render. */
  @IsDateString()
  weekStart: string;
}
