import {
  assertPanelHasBranch,
  assertNoExistingB2bUser,
} from './referral-panel-user.service';
import { ConflictException } from '../../common/exceptions/kaltros.exception';

describe('referral-panel-user guards', () => {
  it('rejects a panel without a branch', () => {
    expect(() => assertPanelHasBranch({ id: 'p1', branchId: null })).toThrow(
      ConflictException,
    );
  });

  it('accepts a panel with a branch', () => {
    expect(() =>
      assertPanelHasBranch({ id: 'p1', branchId: 'b1' }),
    ).not.toThrow();
  });

  it('rejects when a b2b user already exists for the panel', () => {
    expect(() =>
      assertNoExistingB2bUser('p1', { id: 'existing' }),
    ).toThrow(ConflictException);
  });

  it('accepts when no b2b user exists yet', () => {
    expect(() => assertNoExistingB2bUser('p1', null)).not.toThrow();
  });
});
