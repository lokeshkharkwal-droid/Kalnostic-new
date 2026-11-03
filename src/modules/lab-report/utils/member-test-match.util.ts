/**
 * Panel members in the Technician worklist.
 *
 * A report of a PANEL order line is one report per member test. Its order line is the panel (it has no
 * `BranchLabTest`), so the line's own test name / test filter / department can never describe the member: the
 * member is only known through `LabReport.memberBranchLabTestId`, a plain id (no Prisma relation) that the row's
 * displayed test name and department are looked up from. The worklist therefore judges a panel member by ITS OWN
 * test entry: the name the search matches and the Lab Test filter - the same rule Accession applies to a panel's
 * samples. (The Department filter and who may see the row do NOT go through here: they compare the report's own
 * stamped `LabReport.departmentId`, which is already the member test's own department.)
 *
 * The matching ids are resolved once per request (they need a query) and handed to the pure `buildListWhere`.
 */
export interface MemberEntryMatches {
  /**
   * `BranchLabTest` ids (member entries of existing reports) whose test name contains the worklist search text:
   * a report whose `memberBranchLabTestId` is one of them matches the search.
   */
  search: string[];
  /**
   * `BranchLabTest` ids that are the Lab Test filter's test (the entry itself or any copy of the same master test):
   * a report whose `memberBranchLabTestId` is one of them matches the filter.
   */
  testFilter: string[];
}

/** No panel member matches (the usual case, and what a caller that does not resolve members passes). */
export const NO_MEMBER_MATCHES: MemberEntryMatches = {
  search: [],
  testFilter: [],
};
