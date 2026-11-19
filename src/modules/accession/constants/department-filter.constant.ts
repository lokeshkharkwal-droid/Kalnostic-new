/**
 * The Department filter's "No Department" choice: the list is limited to samples that
 * have no department. Sent in place of a department id (`departmentId=none`).
 */
export const NO_DEPARTMENT_FILTER = 'none';

/** A department id (UUID) or the "No Department" choice. */
export const DEPARTMENT_FILTER_PATTERN =
  /^(none|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
