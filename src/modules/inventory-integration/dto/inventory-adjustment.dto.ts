import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** One product's target (final) deducted quantity in a manual adjustment save. */
export class InventoryAdjustmentLineDto {
  /** The inventory product being adjusted. */
  @IsString()
  @IsNotEmpty()
  productId: string;

  /** The final quantity that should be deducted from stock for this product. */
  @IsNumber()
  @Min(0)
  finalQty: number;
}

/** Body of `PUT /inventory/order-adjustment`. */
export class SaveOrderAdjustmentDto {
  /** The kalnostics `Order.id` being adjusted. */
  @IsString()
  @IsNotEmpty()
  orderId: string;

  /** Per-product final quantities to apply across the whole order. */
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => InventoryAdjustmentLineDto)
  lines: InventoryAdjustmentLineDto[];

  /** Optional reason recorded in the adjustment history. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;

  /** Optional free-text note recorded in the adjustment history. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

/** Body of `PUT /inventory/test-adjustment`. */
export class SaveTestAdjustmentDto extends SaveOrderAdjustmentDto {
  /** The lab report id (identifies which of the order's tests to adjust). */
  @IsString()
  @IsNotEmpty()
  labReportId: string;
}
