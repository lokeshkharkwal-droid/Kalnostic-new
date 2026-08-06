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
 * Create a new branch **Lab Test List**. The list is seeded by cloning the
 * branch's default (Walk-in) list's tests, computing each row's `listPrice` from
 * `copyPriceFrom` per `priceType`:
 * - PERCENTAGE → source column × `copyPercentage` ÷ 100 (percentage required)
 * - CUSTOMIZED → source column copied as-is (percentage ignored)
 */
export class CreateBranchLabTestListDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsEnum(ListPriceSource)
  copyPriceFrom!: ListPriceSource;

  @IsEnum(ListPriceType)
  priceType!: ListPriceType;

  /** Required (0–100) only when `priceType` is PERCENTAGE. */
  @ValidateIf((o: CreateBranchLabTestListDto) => o.priceType === 'PERCENTAGE')
  @IsInt()
  @Min(0)
  @Max(100)
  copyPercentage?: number;
}
