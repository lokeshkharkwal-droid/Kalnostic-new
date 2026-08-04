import { IsIn, IsOptional } from 'class-validator';
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
}
