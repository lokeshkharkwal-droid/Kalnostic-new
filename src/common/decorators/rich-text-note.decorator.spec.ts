import { ValidationPipe } from '@nestjs/common';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { IsOptional, IsString } from 'class-validator';
import { NOTE_MAX_LENGTH } from '../validators/note-max-length.validator';
import { RichTextNote } from './rich-text-note.decorator';
import { BulkEditBranchLabTestItemDto } from '../../modules/branch-lab-test/dto/bulk-edit-branch-lab-tests.dto';
import { UpdateBranchLabTestDto } from '../../modules/branch-lab-test/dto/update-branch-lab-test.dto';
import { UpdateContentSectionsDto } from '../../modules/lab-report/dto/update-content-sections.dto';
import { UpdateOverallResultDto } from '../../modules/lab-report/dto/update-overall-result.dto';
import { UpdateParameterNoteDto } from '../../modules/lab-report/dto/update-parameter-note.dto';
import { BulkEditLabTestItemDto } from '../../modules/lab-test/dto/bulk-edit-lab-tests.dto';
import { CreateLabTestDto } from '../../modules/lab-test/dto/create-lab-test.dto';
import { ImportXlsxTestRowDto } from '../../modules/lab-test/dto/import-lab-tests-xlsx.dto';
import { ImportLabTestRowDto } from '../../modules/lab-test/dto/import-lab-tests.dto';
import { UpdateLabTestDto } from '../../modules/lab-test/dto/update-lab-test.dto';
import { CreateOverallResultTemplateDto } from '../../modules/overall-result-template/dto/create-overall-result-template.dto';
import { UpdateOverallResultTemplateDto } from '../../modules/overall-result-template/dto/update-overall-result-template.dto';

/**
 * `@RichTextNote` cleans a rich-text note as the request body becomes the DTO, then holds it to the shared length
 * limit. The first half exercises the decorator through the SAME `ValidationPipe` options `main.ts` uses; the second
 * half is a guard: every DTO that carries a rich-text note must have it, so a field cannot silently lose its cleaning.
 */
const DIRTY =
  '<p>Fasting <strong>needed</strong></p><script>fetch("http://internal-server/x")</script><img src="x" onerror="alert(1)">';
const CLEAN = '<p>Fasting <strong>needed</strong></p><img src="x" />';

class SampleDto {
  @IsOptional()
  @IsString()
  @RichTextNote('Sample Note')
  note?: string;
}

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const run = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SampleDto });

describe('@RichTextNote through the request pipe', () => {
  it('removes anything active and keeps the formatting', async () => {
    const dto = (await run({ note: DIRTY })) as SampleDto;
    expect(dto.note).toBe(CLEAN);
  });

  it('leaves a clean note, plain text and an empty string as they are', async () => {
    expect(((await run({ note: '<p>ok</p>' })) as SampleDto).note).toBe(
      '<p>ok</p>',
    );
    expect(((await run({ note: 'plain text' })) as SampleDto).note).toBe(
      'plain text',
    );
    expect(((await run({ note: '' })) as SampleDto).note).toBe('');
  });

  it('leaves an omitted field omitted', async () => {
    expect(((await run({})) as SampleDto).note).toBeUndefined();
  });

  it("never makes the cleaner throw on a value that is not a string: the pipe's own type handling decides", async () => {
    // `enableImplicitConversion` (see main.ts) turns a number into its string before the field is checked, for every
    // string field in the app — the cleaner then simply sees a string.
    expect(((await run({ note: 123 })) as SampleDto).note).toBe('123');
    expect(((await run({ note: null })) as SampleDto).note).toBeNull();
  });

  it('applies the length limit to the cleaned note, with the field name in the message', async () => {
    const tooLong = '<p>' + 'x'.repeat(NOTE_MAX_LENGTH) + '</p>';
    await expect(run({ note: tooLong })).rejects.toMatchObject({
      response: {
        message: [expect.stringContaining('Sample Note is too long')],
      },
    });
  });

  it('counts only what will be stored: a huge script that is removed does not use up the limit', async () => {
    const note =
      '<p>short</p><script>' + 'a'.repeat(NOTE_MAX_LENGTH + 10) + '</script>';
    expect(((await run({ note })) as SampleDto).note).toBe('<p>short</p>');
  });

  it('does not touch a note when a DTO is written back out', () => {
    const dto = Object.assign(new SampleDto(), { note: DIRTY });
    expect(instanceToPlain(dto).note).toBe(DIRTY);
  });
});

describe('every DTO that carries a rich-text note cleans it', () => {
  const FIVE = [
    'usefulFor',
    'interpretationOfResults',
    'limitations',
    'remarks',
    'references',
  ];
  const cases: Array<[string, new () => object, string[]]> = [
    ['UpdateLabTestDto', UpdateLabTestDto, FIVE],
    ['CreateLabTestDto', CreateLabTestDto, FIVE],
    ['BulkEditLabTestItemDto', BulkEditLabTestItemDto, FIVE],
    ['ImportLabTestRowDto', ImportLabTestRowDto, FIVE],
    ['ImportXlsxTestRowDto', ImportXlsxTestRowDto, FIVE],
    ['UpdateBranchLabTestDto', UpdateBranchLabTestDto, FIVE],
    ['BulkEditBranchLabTestItemDto', BulkEditBranchLabTestItemDto, FIVE],
    [
      'UpdateContentSectionsDto',
      UpdateContentSectionsDto,
      ['usefulFor', 'interpretation', 'limitations', 'remarks', 'references'],
    ],
    ['UpdateOverallResultDto', UpdateOverallResultDto, ['content']],
    ['UpdateParameterNoteDto', UpdateParameterNoteDto, ['content']],
    [
      'CreateOverallResultTemplateDto',
      CreateOverallResultTemplateDto,
      ['content'],
    ],
    [
      'UpdateOverallResultTemplateDto',
      UpdateOverallResultTemplateDto,
      ['content'],
    ],
  ];

  it.each(cases)('%s', (_name, Dto, fields) => {
    const body = Object.fromEntries(fields.map((f) => [f, DIRTY]));
    const dto = plainToInstance(Dto, body) as Record<string, unknown>;
    for (const f of fields) expect([f, dto[f]]).toEqual([f, CLEAN]);
  });
});
