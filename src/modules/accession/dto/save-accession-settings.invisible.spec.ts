import { ValidationPipe } from '@nestjs/common';
import { SaveAccessionSettingsDto } from './save-accession-settings.dto';

/**
 * The backend Settings DTO was deliberately NOT tightened in the "visible text" change
 * (only the frontend Settings form refuses an invisible-only list entry, and the
 * Reject / Repeat / Receive DTOs refuse invisible reasons). This pins that decision so
 * nobody assumes the backend refuses it - and so a future change is a conscious one.
 */
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});
const run = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SaveAccessionSettingsDto });

describe('SaveAccessionSettingsDto stays as it was (not tightened)', () => {
  it.each([
    'MasterData_RejectionReasons',
    'MasterData_RepeatReasons',
    'MasterData_SampleConditions',
    'MasterData_TubeTypes',
  ])('%s still accepts an invisible-only entry', async (field) => {
    await expect(run({ [field]: ['\u200B'] })).resolves.toMatchObject({
      [field]: ['\u200B'],
    });
  });

  it('still accepts ordinary entries and an empty list', async () => {
    await expect(
      run({ MasterData_RejectionReasons: ['Damaged in Transit', 'Leaked'] }),
    ).resolves.toBeDefined();
    await expect(
      run({ MasterData_RejectionReasons: [] }),
    ).resolves.toBeDefined();
  });

  it('still refuses a non-text entry (unchanged rule)', async () => {
    await expect(
      run({ MasterData_RejectionReasons: [7] }),
    ).rejects.toBeDefined();
  });
});
