import { IsUUID } from 'class-validator';

/** Query for today's slots: a single phlebotomist. */
export class TodayQueryDto {
  @IsUUID()
  phlebotomistId: string;
}
