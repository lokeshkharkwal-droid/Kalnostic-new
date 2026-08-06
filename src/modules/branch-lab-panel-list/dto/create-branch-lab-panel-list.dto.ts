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
 * Create a new branch **Lab Panel List**. Seeded by cloning the branch's default
 * (Walk-in) list's panels, computing each row's `listPrice` from `copyPriceFrom`
 * per `priceType` (PERCENTAGE → source × % ÷ 100; CUSTOMIZED → copy as-is).
 */
export class CreateBranchLabPanelListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(ListPriceSource)
  copyPriceFrom!: ListPriceSource;

  @IsEnum(ListPriceType)
  priceType!: ListPriceType;

  /** Required (0–100) only when `priceType` is PERCENTAGE. */
  @ValidateIf((o: CreateBranchLabPanelListDto) => o.priceType === 'PERCENTAGE')
  @IsInt()
  @Min(0)
  @Max(100)
  copyPercentage?: number;
}
