import { allowedModulesForRole } from './role-module-access.config';

describe('b2b_referring_panel module access', () => {
  it('grants exactly registration, finance and lab_operations', () => {
    expect(allowedModulesForRole('b2b_referring_panel').sort()).toEqual([
      'finance',
      'lab_operations',
      'registration',
    ]);
  });
});
