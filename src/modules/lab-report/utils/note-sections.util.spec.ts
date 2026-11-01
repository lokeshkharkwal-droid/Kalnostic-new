import {
  excludedSectionsToApply,
  normaliseNoteSections,
  notesSelectableFor,
  reportKindOfItem,
} from './note-sections.util';

describe('reportKindOfItem', () => {
  it('a panel order line is a PANEL, a test line a TEST, free text DIRECT', () => {
    expect(
      reportKindOfItem({ branchLabPanelId: 'p1', branchLabTestId: null }),
    ).toBe('PANEL');
    expect(
      reportKindOfItem({ branchLabPanelId: null, branchLabTestId: 't1' }),
    ).toBe('TEST');
    expect(
      reportKindOfItem({ branchLabPanelId: null, branchLabTestId: null }),
    ).toBe('DIRECT');
  });
});

describe('notesSelectableFor', () => {
  it('a panel report follows the Lab Panel switch, a test report the Lab Test switch', () => {
    const onlyTest = { labTest: true, labPanel: false };
    expect(notesSelectableFor('TEST', onlyTest)).toBe(true);
    expect(notesSelectableFor('PANEL', onlyTest)).toBe(false);
    const onlyPanel = { labTest: false, labPanel: true };
    expect(notesSelectableFor('TEST', onlyPanel)).toBe(false);
    expect(notesSelectableFor('PANEL', onlyPanel)).toBe(true);
  });

  it('a free-text line has no Notes, so no switch applies', () => {
    expect(
      notesSelectableFor('DIRECT', { labTest: true, labPanel: true }),
    ).toBe(false);
  });
});

describe('normaliseNoteSections', () => {
  it('keeps known keys once each, in the canonical section order', () => {
    expect(
      normaliseNoteSections(['references', 'useful_for', 'references']),
    ).toEqual(['useful_for', 'references']);
  });

  it('drops anything unknown and tolerates null / undefined', () => {
    expect(normaliseNoteSections(['bogus', 'remarks'])).toEqual(['remarks']);
    expect(normaliseNoteSections(null)).toEqual([]);
    expect(normaliseNoteSections(undefined)).toEqual([]);
  });
});

describe('excludedSectionsToApply', () => {
  const ALL = ['useful_for', 'interpretation', 'limitations', 'remarks', 'references'];

  it('before anyone chose: the setting ON selects everything, so nothing is left out', () => {
    expect(excludedSectionsToApply(true, false, []).size).toBe(0);
  });

  it('before anyone chose: the setting OFF selects nothing, so every section is left out', () => {
    expect([...excludedSectionsToApply(false, false, [])]).toEqual(ALL);
  });

  it('before anyone chose, a stray stored list is ignored', () => {
    expect(excludedSectionsToApply(true, false, ['remarks']).size).toBe(0);
    expect([...excludedSectionsToApply(false, false, ['remarks'])]).toEqual(ALL);
  });

  it('once chosen, the saved list is the choice whether the setting is ON or OFF', () => {
    expect([...excludedSectionsToApply(true, true, ['limitations'])]).toEqual(['limitations']);
    expect([...excludedSectionsToApply(false, true, ['limitations'])]).toEqual(['limitations']);
  });

  it('once chosen, an empty list means every section prints, even with the setting OFF', () => {
    expect(excludedSectionsToApply(false, true, []).size).toBe(0);
  });
});
