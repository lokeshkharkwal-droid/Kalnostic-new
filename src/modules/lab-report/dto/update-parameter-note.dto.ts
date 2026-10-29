import { IsString } from 'class-validator';
import { RichTextNote } from '../../../common/decorators/rich-text-note.decorator';

/**
 * Body for `PATCH /lab-reports/:id/parameter-note/:resultParamId`: the technician's text for ONE result parameter's
 * Note on this report (rich-text HTML from the Notes editor). An empty string is allowed and means "no note on this
 * report" — different from never having saved one, which keeps showing the parameter's configured Note. It never
 * changes the configured Note itself.
 */
export class UpdateParameterNoteDto {
  @IsString()
  @RichTextNote('Parameter Note')
  content: string;
}
