/**
 * Makes a user's text safe to put inside a Prisma `contains` / `startsWith` / `endsWith`: Prisma hands the value to
 * PostgreSQL's LIKE as it is, so `%` would match anything and `_` any single character. Each of the three LIKE
 * metacharacters (`\`, `%`, `_`) gets a backslash in front (PostgreSQL's default LIKE escape), so what the user typed
 * is matched literally.
 */
export function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&');
}
