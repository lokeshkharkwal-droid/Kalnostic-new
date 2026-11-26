import { BranchType } from '@prisma/client';
import {
  isValidProfileKey,
  isProfileValidForBranch,
  PROFILE_BRANCH_MATRIX,
  PROFILE_LABELS,
  STAFF_ROLE_KEYS,
} from './profile-registry.constant';

describe('b2b_referring_panel profile', () => {
  it('is a valid profile key with a label', () => {
    expect(isValidProfileKey('b2b_referring_panel')).toBe(true);
    expect(PROFILE_LABELS['b2b_referring_panel' as never]).toBe(
      'B2B Referring Panel',
    );
  });

  it('is branch-level (allowed at DIAGNOSTIC, not tenant-level)', () => {
    expect(
      isProfileValidForBranch('b2b_referring_panel', BranchType.DIAGNOSTIC),
    ).toBe(true);
  });
});

describe('typist profile', () => {
  it('is a valid staff profile key labelled "Typist"', () => {
    expect(isValidProfileKey('typist')).toBe(true);
    expect(PROFILE_LABELS.typist).toBe('Typist');
    expect(STAFF_ROLE_KEYS).toContain('typist');
  });

  it('is branch-level and offered on the lab branch types only', () => {
    expect(PROFILE_BRANCH_MATRIX.typist.length).toBeGreaterThan(0);
    for (const t of [
      BranchType.DIAGNOSTIC,
      BranchType.RADIOLOGY,
      BranchType.BLOOD_BANK,
      BranchType.COMBINED,
      BranchType.TECHNICIAN,
    ]) {
      expect(isProfileValidForBranch('typist', t)).toBe(true);
    }
    for (const t of [
      BranchType.OPD,
      BranchType.PHARMACY,
      BranchType.FRANCHISE,
    ]) {
      expect(isProfileValidForBranch('typist', t)).toBe(false);
    }
  });
});
