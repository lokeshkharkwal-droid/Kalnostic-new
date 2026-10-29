import { PrismaService } from '../../prisma/prisma.service';
import { MasterDataService } from '../master-data/master-data.service';
import { LabTestService } from './lab-test.service';
import { blankNotesToNull } from './utils/param-notes.util';

/**
 * Clearing a result parameter's Note in Master Data.
 *
 * The edit save patches a matched parameter in place and writes only the fields it receives, so an OMITTED `notes`
 * leaves the stored text alone. The editor therefore sends `notes: ""` for a cleared Note, and the backend stores a
 * blank Note as NULL (never an empty string), on every path that writes a parameter: patch, create-in-update, create.
 */
type Fields = Record<string, unknown>;
type Where = { where: Fields; data: Fields };

describe('blankNotesToNull', () => {
  it('turns an empty or whitespace-only Note into null', () => {
    expect(blankNotesToNull({ notes: '' }).notes).toBeNull();
    expect(blankNotesToNull({ notes: '  \n\t ' }).notes).toBeNull();
  });

  it('keeps real text exactly as sent', () => {
    expect(blankNotesToNull({ notes: ' Fasting sample ' }).notes).toBe(' Fasting sample ');
  });

  it('leaves an omitted Note omitted, so the stored Note is not touched', () => {
    const out = blankNotesToNull({ parameterName: 'pH' } as { notes?: string });
    expect(out).not.toHaveProperty('notes');
  });

  it('leaves an explicit null as null and the other fields alone', () => {
    expect(blankNotesToNull({ notes: null, parameterName: 'pH' })).toEqual({ notes: null, parameterName: 'pH' });
  });
});

function build() {
  const labTestResultParam = {
    findMany: jest.fn().mockResolvedValue([{ id: 'p1', parameterCode: 'HB' }]),
    update: jest.fn<Promise<unknown>, [Where]>().mockResolvedValue({}),
    create: jest.fn<Promise<unknown>, [{ data: Fields }]>().mockResolvedValue({ id: 'p-new' }),
    updateMany: jest.fn().mockResolvedValue({}),
  };
  const tx = {
    labTestResultParam,
    labTestReferenceRange: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
    labTestReferenceValue: {
      updateMany: jest.fn().mockResolvedValue({}),
      createMany: jest.fn().mockResolvedValue({}),
    },
  };
  const service = new LabTestService({} as unknown as PrismaService, {} as unknown as MasterDataService);
  const priv = service as unknown as {
    upsertParamsByCode: (...a: unknown[]) => Promise<void>;
    createParams: (...a: unknown[]) => Promise<void>;
  };
  const save = (params: unknown[]) =>
    priv.upsertParamsByCode(tx, 't1', 'b1', 'lt1', params, new Date('2026-10-29'));
  return { save, priv, tx, labTestResultParam };
}

const param = (over: Fields = {}) => ({ id: 'p1', parameterName: 'Haemoglobin', parameterCode: 'HB', ...over });
const patched = (m: ReturnType<typeof build>) => m.labTestResultParam.update.mock.calls[0]![0].data;

describe('saving a result parameter (edit)', () => {
  it('a cleared Note (sent as "") clears the stored Note: written as null', async () => {
    const m = build();
    await m.save([param({ notes: '' })]);
    expect(patched(m)).toHaveProperty('notes', null);
  });

  it('a whitespace-only Note clears it too', async () => {
    const m = build();
    await m.save([param({ notes: '   ' })]);
    expect(patched(m)).toHaveProperty('notes', null);
  });

  it('a changed Note is saved as typed', async () => {
    const m = build();
    await m.save([param({ notes: 'Fasting sample' })]);
    expect(patched(m)).toHaveProperty('notes', 'Fasting sample');
  });

  it('a save that does not send `notes` leaves the stored Note untouched', async () => {
    const m = build();
    await m.save([param()]);
    expect(patched(m)).not.toHaveProperty('notes');
  });

  it('a new parameter added in the same save with a blank Note is created with null, not an empty string', async () => {
    const m = build();
    await m.save([param(), param({ id: undefined, parameterCode: 'MCV', parameterName: 'MCV', notes: '' })]);
    expect(m.labTestResultParam.create.mock.calls[0]![0].data).toHaveProperty('notes', null);
  });

  it('a new parameter with text keeps it', async () => {
    const m = build();
    await m.save([param(), param({ id: undefined, parameterCode: 'MCV', parameterName: 'MCV', notes: 'Venous' })]);
    expect(m.labTestResultParam.create.mock.calls[0]![0].data).toHaveProperty('notes', 'Venous');
  });
});

describe('creating a test (createParams)', () => {
  it('a blank Note is stored as null; real text is kept', async () => {
    const m = build();
    await m.priv.createParams(m.tx, 't1', 'b1', 'lt1', [
      { parameterName: 'A', parameterCode: 'A', notes: '' },
      { parameterName: 'B', parameterCode: 'B', notes: 'Keep' },
      { parameterName: 'C', parameterCode: 'C' },
    ]);
    const data = m.labTestResultParam.create.mock.calls.map((c) => c[0].data);
    expect(data[0]).toHaveProperty('notes', null);
    expect(data[1]).toHaveProperty('notes', 'Keep');
    expect(data[2]).not.toHaveProperty('notes');
  });
});
