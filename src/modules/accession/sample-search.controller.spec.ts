import { ActiveBranchRequiredException } from '../branch-lab-test/exceptions/branch-lab-test.exceptions';
import type { ActiveProfile } from '../auth/decorators/current-profile.decorator';
import { SampleSearchController } from './sample-search.controller';
import type { SampleSearchService } from './sample-search.service';

/** A profile with no active branch (the business admin) has no samples to search: a clear error, not "not found". */
describe('SampleSearchController', () => {
  const build = () => {
    const search = jest.fn().mockResolvedValue({ found: false });
    const controller = new SampleSearchController({
      search,
    } as unknown as SampleSearchService);
    return { controller, search };
  };
  const query = { barcode: '99010', menu: 'IN_HOUSE' as const };
  const profile = (branchId: string | null) =>
    ({ profileKey: 'x', branchId }) as unknown as ActiveProfile;

  it('refuses a profile without an active branch, and does not search', () => {
    const { controller, search } = build();
    expect(() => controller.search('t1', profile(null), 'p1', query)).toThrow(
      ActiveBranchRequiredException,
    );
    expect(search).not.toHaveBeenCalled();
  });

  it('searches with the tenant, the active branch and the caller', async () => {
    const { controller, search } = build();
    await controller.search('t1', profile('b1'), 'p1', query);
    expect(search).toHaveBeenCalledWith('t1', 'b1', 'p1', query);
  });
});
