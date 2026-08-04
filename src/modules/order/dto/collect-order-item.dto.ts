import { IsBoolean, IsOptional } from 'class-validator';
import { ToBoolean } from '../../../common/decorators/to-boolean.decorator';

/**
 * Query options for `PATCH /orders/:id/items/:itemId/collect`. `print` mirrors the
 * accession "Collect & Print" action — collect the sample(s) and also assign a
 * barcode. Defaults to a plain collect (no barcode) when omitted.
 */
export class CollectOrderItemDto {
  /** When true, also assign a barcode to the collected sample(s). */
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  print?: boolean;
}
