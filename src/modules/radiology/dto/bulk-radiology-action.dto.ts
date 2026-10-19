import { ArrayNotEmpty, IsArray, IsIn, IsUUID } from 'class-validator';
import { RadiologyStudyActionDto } from './radiology-study-action.dto';
import type { RadiologyAction } from '../constants/radiology-transitions.constant';

/** The status actions that may be applied in bulk (report is single-study only). */
export const BULK_RADIOLOGY_ACTIONS: readonly RadiologyAction[] = [
  'schedule',
  'acquire',
  'validate',
  'approve',
  'publish',
  'hold',
  'cancel',
  'retrieve',
];

/** A bulk status action over several radiology studies (ids + action + payload). */
export class BulkRadiologyActionDto extends RadiologyStudyActionDto {
  @IsIn(BULK_RADIOLOGY_ACTIONS as string[])
  action: RadiologyAction;

  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('all', { each: true })
  ids: string[];
}
