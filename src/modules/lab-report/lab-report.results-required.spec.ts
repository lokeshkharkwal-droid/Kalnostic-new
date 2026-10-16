import { LabReportService } from './lab-report.service';
import { LabReportResultsRequiredException } from './exceptions/lab-report.exceptions';

/**
 * Save and Submit need at least one REAL observed value, or at least one attached file.
 * A reading made only of spaces, tabs or line breaks (an analyzer can send one) is not a result:
 * the screen treats it as empty, so the server must too.
 */
function build(readings: Array<string | null>, attachments = 0) {
  const labReportResultValue = {
    // The database filter drops null and '' already; the service looks at what is left.
    findMany: jest
      .fn()
      .mockResolvedValue(
        readings
          .filter((r) => r !== null && r !== '')
          .map((r) => ({ observed1: r })),
      ),
  };
  const labReportAttachment = {
    findFirst: jest
      .fn()
      .mockResolvedValue(attachments > 0 ? { id: 'att1' } : null),
  };
  const deps = Array(11).fill(undefined) as unknown[];
  deps[0] = { labReportResultValue, labReportAttachment };
  const service = new LabReportService(
    ...(deps as ConstructorParameters<typeof LabReportService>),
  );
  const check = () =>
    (
      service as unknown as {
        requireAtLeastOneResultValue: (
          id: string,
          tenantId: string,
        ) => Promise<void>;
      }
    ).requireAtLeastOneResultValue('r1', 't1');
  return { check, labReportAttachment };
}

describe('Save / Submit need a real result or a file', () => {
  it('one real value is enough; the attachments are not even looked at', async () => {
    const m = build(['13.5']);
    await expect(m.check()).resolves.toBeUndefined();
    expect(m.labReportAttachment.findFirst).not.toHaveBeenCalled();
  });

  it('a real value among empty ones is enough', async () => {
    await expect(
      build(['', null, '   ', '7.2']).check(),
    ).resolves.toBeUndefined();
  });

  it.each([
    ['spaces only', '   '],
    ['a tab', '\t'],
    ['line breaks', '\n\r\n'],
    ['mixed whitespace', ' \t \n '],
  ])(
    '%s is not a result: refused when there is no file',
    async (_label, text) => {
      await expect(build([text]).check()).rejects.toBeInstanceOf(
        LabReportResultsRequiredException,
      );
    },
  );

  it('nothing at all (no values, no file) is refused', async () => {
    await expect(build([]).check()).rejects.toBeInstanceOf(
      LabReportResultsRequiredException,
    );
    await expect(build(['', null]).check()).rejects.toBeInstanceOf(
      LabReportResultsRequiredException,
    );
  });

  it('a file lets an empty or whitespace-only report through', async () => {
    await expect(build([], 1).check()).resolves.toBeUndefined();
    await expect(build(['   '], 1).check()).resolves.toBeUndefined();
  });

  it('a value with spaces around it counts (only the spaces are ignored)', async () => {
    await expect(build(['  Positive  ']).check()).resolves.toBeUndefined();
  });
});
