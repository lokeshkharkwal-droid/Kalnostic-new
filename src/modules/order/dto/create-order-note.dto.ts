import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * The three plain note tabs on the Order Overview page (Order / Sample / Tech).
 * Mirrors the lab-report notes' `PLAIN_NOTE_CATEGORIES`, but keyed to the order
 * so a note can be added the moment an order is created (before any lab report
 * or accession sample exists).
 */
export const ORDER_NOTE_CATEGORIES = ['ORDER', 'SAMPLE', 'TECH'] as const;
export type OrderNoteCategoryValue = (typeof ORDER_NOTE_CATEGORIES)[number];

/** Body for `POST /orders/:id/notes`. */
export class CreateOrderNoteDto {
  @IsIn(ORDER_NOTE_CATEGORIES)
  category: OrderNoteCategoryValue;

  @IsString()
  @MinLength(1)
  @MaxLength(2048)
  body: string;
}
