import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { BulkEditBranchLabTestItemDto } from '../../modules/branch-lab-test/dto/bulk-edit-branch-lab-tests.dto';
import { UpdateBranchLabTestDto } from '../../modules/branch-lab-test/dto/update-branch-lab-test.dto';
import { UpdateContentSectionsDto } from '../../modules/lab-report/dto/update-content-sections.dto';
import { UpdateOverallResultDto } from '../../modules/lab-report/dto/update-overall-result.dto';
import { BulkEditLabTestItemDto } from '../../modules/lab-test/dto/bulk-edit-lab-tests.dto';
import { CreateLabTestDto } from '../../modules/lab-test/dto/create-lab-test.dto';
import { ImportLabTestRowDto } from '../../modules/lab-test/dto/import-lab-tests.dto';
import { ImportXlsxTestRowDto } from '../../modules/lab-test/dto/import-lab-tests-xlsx.dto';
import { UpdateLabTestDto } from '../../modules/lab-test/dto/update-lab-test.dto';
import { CreateOverallResultTemplateDto } from '../../modules/overall-result-template/dto/create-overall-result-template.dto';
import { UpdateOverallResultTemplateDto } from '../../modules/overall-result-template/dto/update-overall-result-template.dto';
import { NOTE_MAX_LENGTH } from './note-max-length.validator';

/**
 * ONE rule for every place a rich-text note can be saved. Master Data (create,
 * update, bulk edit, both imports), the Branch Admin copy, the Overall Result
 * templates and the Technician per-report edits must all accept exactly the
 * same length, so a note that fits in one place can always be saved in another
 * (before this, Master Data had no limit but the Technician screen refused
 * anything over 20,000 characters).
 *
 * A DTO that forgets the decorator, or uses its own number, fails here.
 */
const NOTE_FIELDS = [
  'usefulFor',
  'interpretationOfResults',
  'limitations',
  'remarks',
  'references',
] as const;

type Target = {
  name: string;
  dto: new () => object;
  fields: readonly string[];
};

const TARGETS: Target[] = [
  {
    name: 'Technician: content sections',
    dto: UpdateContentSectionsDto,
    fields: [
      'usefulFor',
      'interpretation',
      'limitations',
      'remarks',
      'references',
    ],
  },
  {
    name: 'Technician: overall result',
    dto: UpdateOverallResultDto,
    fields: ['content'],
  },
  {
    name: 'Master Data: create test',
    dto: CreateLabTestDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Master Data: update test',
    dto: UpdateLabTestDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Master Data: bulk edit',
    dto: BulkEditLabTestItemDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Master Data: import (rows)',
    dto: ImportLabTestRowDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Master Data: import (Excel)',
    dto: ImportXlsxTestRowDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Branch Admin: update test',
    dto: UpdateBranchLabTestDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Branch Admin: bulk edit',
    dto: BulkEditBranchLabTestItemDto,
    fields: NOTE_FIELDS,
  },
  {
    name: 'Overall Result template: create',
    dto: CreateOverallResultTemplateDto,
    fields: ['content'],
  },
  {
    name: 'Overall Result template: update',
    dto: UpdateOverallResultTemplateDto,
    fields: ['content'],
  },
];

const casesFor = (): Array<[string, new () => object, string]> =>
  TARGETS.flatMap((t) =>
    t.fields.map((f): [string, new () => object, string] => [
      `${t.name} › ${f}`,
      t.dto,
      f,
    ]),
  );

/** Validation errors for ONE property (other required fields are ignored). */
const errorsOn = async (
  dto: new () => object,
  property: string,
  value: string,
) => {
  const instance = plainToInstance(dto, { [property]: value });
  const errors = await validate(instance, { skipMissingProperties: true });
  return errors.filter((e) => e.property === property);
};

describe('every note field enforces the same shared limit', () => {
  it('covers 43 fields across 11 DTOs (add new note fields to the list above)', () => {
    expect(TARGETS).toHaveLength(11);
    expect(casesFor()).toHaveLength(43);
  });

  it.each(casesFor())(
    '%s accepts text of exactly the limit',
    async (_label, dto, field) => {
      expect(await errorsOn(dto, field, 'a'.repeat(NOTE_MAX_LENGTH))).toEqual(
        [],
      );
    },
  );

  it.each(casesFor())(
    '%s rejects one character over the limit, with a clear message',
    async (_label, dto, field) => {
      const errors = await errorsOn(
        dto,
        field,
        'a'.repeat(NOTE_MAX_LENGTH + 1),
      );

      expect(errors).toHaveLength(1);
      expect(errors[0]!.constraints!.maxLength).toMatch(
        /is too long \(1,000,001 characters\)\. The maximum is 1,000,000 characters\.$/,
      );
    },
  );

  it.each(casesFor())(
    '%s accepts a 200,000-character paste (the old 20,000 limit is gone)',
    async (_label, dto, field) => {
      expect(
        await errorsOn(dto, field, '<p>pasted text</p>'.repeat(11_112)),
      ).toEqual([]);
    },
  );
});
