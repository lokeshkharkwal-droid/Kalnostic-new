/** The active-role key that triggers B2B isolation + module gating. */
export const B2B_ROLE_KEY = 'b2b_referring_panel';

/**
 * Default-deny path allow-list for B2B Referring Panel tokens. A request whose
 * path (after the global `/api/v1` prefix is stripped) does not start with one
 * of these prefixes is rejected with 403. Covers the five B2B features plus the
 * shared infrastructure endpoints the app shell needs after login.
 */
export const B2B_ALLOWED_PATH_PREFIXES: readonly string[] = [
  '/auth', //             refresh / logout / switch-profile / me
  '/users/manage/me', //  permissions + profile for the shell
  '/modules', //          branch module catalogue (TopBar tabs)
  '/tenant/locale', //    timezone/currency for display
  '/branches', //         branch lookups (read); writes still 403 via existing perms
  '/orders', //           Registration → Order Console + Finance → Billing
  '/invoices', //         Finance → Invoices
  '/payments', //         order payments (billing)
  '/finance/payments', // Finance → Payments ledger
  '/lab-reports', //      Technician → Reporting
] as const;

/**
 * Whether a request path is allowed for a B2B session.
 * @param path the request path with the global api prefix already stripped
 */
export function isB2bAllowedPath(path: string): boolean {
  return B2B_ALLOWED_PATH_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`) || path.startsWith(`${p}?`),
  );
}
