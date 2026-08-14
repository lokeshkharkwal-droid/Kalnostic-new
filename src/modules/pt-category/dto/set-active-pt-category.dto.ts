import { IsBoolean } from 'class-validator';

/** Activate/inactivate a PT category from the settings table row switch. */
export class SetActivePtCategoryDto {
  @IsBoolean()
  isActive!: boolean;
}
