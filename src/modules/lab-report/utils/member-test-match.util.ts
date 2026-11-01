/**
 * Panel members in the Technician worklist.
 *
 * A report of a PANEL order line is one report per member test. Its order line is the panel (it has no
 * `BranchLabTest`), so the line's own test name / test filter / department can never describe the member: the
 * member is only known through `LabReport.memberBranchLabTestId`, a plain id (no Prisma relation) that the row's
 * displayed test name and department are looked up from. The worklist therefore judges a panel member by ITS OWN
 * test entry: the name the search matches, the Lab Test filter, and the department (the Department column, the
 * Department filter and who may see the row) - the same rule Accession applies to a panel's samples.
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
   * `BranchLabTest` ids that are the Lab Test filter's test (the entry itself or any copy of the same master test,
   * and, when a Department filter is set too, only those whose own department is that department): a report whose
   * `memberBranchLabTestId` is one of them matches the filter.
   */
  testFilter: string[];
  /**
   * Member entries of existing reports whose own department is the Department filter's department: a report whose
   * `memberBranchLabTestId` is one of them matches the Department filter.
   */
  department: string[];
  /**
   * Member entries the caller may NOT see by department: their own department is set and is not one of the
   * caller's departments. A member report with one of these ids is hidden from them (an entry with no department
   * is visible to everyone, as everywhere else).
   */
  hidden: string[];
}

/** No panel member matches or is hidden (the usual case, and what a caller that does not resolve members passes). */
export const NO_MEMBER_MATCHES: MemberEntryMatches = {
  search: [],
  testFilter: [],
  department: [],
  hidden: [],
};
