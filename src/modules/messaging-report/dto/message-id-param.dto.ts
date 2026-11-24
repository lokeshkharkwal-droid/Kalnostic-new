import { Type } from 'class-transformer';
import { IsInt, Min } from 'class-validator';

/** Route param of the "Message Detail" endpoints: the Exchange notification id. */
export class MessageIdParamDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  id: number;
}
