import { IsUUID } from 'class-validator';

/** Query for today's slots: a single doctor. */
export class TodayQueryDto {
  @IsUUID()
  doctorId: string;
}
