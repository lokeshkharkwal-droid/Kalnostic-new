import { IsBoolean } from 'class-validator';

/** Activate/inactivate a patient category from the settings table row switch. */
export class SetActivePatientCategoryDto {
  @IsBoolean()
  isActive!: boolean;
}
