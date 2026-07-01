import { TestGroup } from '@prisma/client';

/** A mapped lab test embedded in a test-group read (a lightweight projection). */
export interface TestGroupLabTest {
  id: string;
  testName: string;
  testCode: string;
}

/**
 * A test group composed with its mapped SITE_ADMIN lab tests — the get-one /
 * create / update response shape.
 */
export type TestGroupWithTests = TestGroup & {
  labTests: TestGroupLabTest[];
};

/**
 * One row of the test-group listing endpoint: the group id, its name, and the
 * count of active mapped lab tests.
 */
export interface TestGroupListRow {
  id: string;
  groupName: string;
  labTestsCount: number;
}
