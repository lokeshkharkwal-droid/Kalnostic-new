import { BranchType } from '@prisma/client';
import {
  isValidProfileKey,
  isProfileValidForBranch,
  PROFILE_LABELS,
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
      isProfileValidForBranch(
        'b2b_referring_panel' as never,
        BranchType.DIAGNOSTIC,
      ),
    ).toBe(true);
  });
});
