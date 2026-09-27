import { ListPriceSource, ListPriceType } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Create a new branch **Radiology Panel List**. Seeded by cloning the branch's
 * default (Walk-in) list's panels (with member tests), computing each row's
 * `listPrice` from `copyPriceFrom` per `priceType`.
 */
export class CreateBranchRadiologyPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(ListPriceSource)
  copyPriceFrom!: ListPriceSource;

  @IsEnum(ListPriceType)
  priceType!: ListPriceType;

  /** Required (0–100) only when `priceType` is PERCENTAGE. */
  @ValidateIf(
    (o: CreateBranchRadiologyPanelListDto) => o.priceType === 'PERCENTAGE',
  )
  @IsInt()
  @Min(0)
  @Max(100)
  copyPercentage?: number;
}
