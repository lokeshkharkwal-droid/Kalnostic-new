import { IsString, MinLength } from 'class-validator';

/** Reply text for an in-app notification thread. */
export class ReplyNotificationDto {
  @IsString()
  @MinLength(1)
  body!: string;
}
