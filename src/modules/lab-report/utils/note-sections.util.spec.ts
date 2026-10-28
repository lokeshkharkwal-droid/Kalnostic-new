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
    expect(notesSelectableFor('DIRECT', { labTest: true, labPanel: true })).toBe(
      false,
    );
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
  it('leaves out the saved sections while the switch is on', () => {
    expect([...excludedSectionsToApply(true, ['limitations'])]).toEqual([
      'limitations',
    ]);
  });

  it('leaves nothing out while the switch is off, whatever was saved', () => {
    expect(excludedSectionsToApply(false, ['limitations', 'remarks']).size).toBe(
      0,
    );
  });
});
