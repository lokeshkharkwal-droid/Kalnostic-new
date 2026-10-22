import { RadiologyStudyStatus } from '@prisma/client';
import {
  ACTION_STAMP,
  nextRadiologyStatus,
  RADIOLOGY_TRANSITIONS,
} from './radiology-transitions.constant';

/**
 * The radiology state machine backing the worklist "Submit" action: submitting a
 * report saves it (REPORTED) then APPROVES it. These tests pin the `approve`
 * transition + its `approvedAt` stamp so the Approved status + timestamp can't
 * silently regress.
 */
describe('radiology transitions — approve', () => {
  it('approves a REPORTED study into APPROVED', () => {
    expect(nextRadiologyStatus('approve', RadiologyStudyStatus.REPORTED)).toBe(
      RadiologyStudyStatus.APPROVED,
    );
  });

  it('approves a VALIDATED study into APPROVED (validation path)', () => {
    expect(nextRadiologyStatus('approve', RadiologyStudyStatus.VALIDATED)).toBe(
      RadiologyStudyStatus.APPROVED,
    );
  });

  it('cannot approve a NEW study (report must be filled first)', () => {
    expect(nextRadiologyStatus('approve', RadiologyStudyStatus.NEW)).toBeNull();
  });

  it('stamps approvedAt on the approve action', () => {
    expect(ACTION_STAMP.approve).toBe('approvedAt');
  });

  it('publishes from APPROVED (Approved → Published worklist action)', () => {
    expect(nextRadiologyStatus('publish', RadiologyStudyStatus.APPROVED)).toBe(
      RadiologyStudyStatus.PUBLISHED,
    );
  });

  it('exposes approve in the transition table for both REPORTED and VALIDATED only', () => {
    expect(Object.keys(RADIOLOGY_TRANSITIONS.approve).sort()).toEqual(
      [RadiologyStudyStatus.REPORTED, RadiologyStudyStatus.VALIDATED].sort(),
    );
  });
});
