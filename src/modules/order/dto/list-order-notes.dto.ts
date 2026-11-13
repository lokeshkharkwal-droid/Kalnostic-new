import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ORDER_NOTE_CATEGORIES } from './create-order-note.dto';
import type { OrderNoteCategoryValue } from './create-order-note.dto';

/**
 * Query for `GET /orders/:id/notes` — omit `category` to return all three tabs'
 * notes together (the SAMPLE stream additionally merges the order's accession
 * sample notes; see `OrderService.findNotes`).
 */
export class ListOrderNotesDto {
  @IsOptional()
  @IsIn(ORDER_NOTE_CATEGORIES)
  category?: OrderNoteCategoryValue;

  /**
   * Narrow the list to one sample of the order (the In-House list's per-sample
   * notes icons): that sample's Technician + accession notes, plus the Order
   * Overview notes, which are saved against the whole order. Any sample id the
   * list hands out is accepted (it is only matched against the order's samples,
   * so an unknown one simply gets an empty list).
   */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sampleId?: string;
}
