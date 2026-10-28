import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import { NOTE_SECTION_KEYS } from '../utils/note-sections.util';

/**
 * Body for `PATCH /lab-reports/:id/note-print-sections`.
 *
 * `excludedSections` is the FULL list of Notes sections to leave out of this
 * report's printed version (it replaces the stored list): a section that is not
 * in the list prints. An empty list means all five print. It is stored on this
 * report only, and only has an effect while the matching Branch Setting
 * (Branch Settings > Technician Settings > Report Printing: Lab Test / Lab Panel) is on.
 */
export class UpdateNotePrintSectionsDto {
  @IsArray()
  @ArrayMaxSize(NOTE_SECTION_KEYS.length)
  @ArrayUnique()
  @IsIn(NOTE_SECTION_KEYS, { each: true })
  excludedSections!: string[];
}
