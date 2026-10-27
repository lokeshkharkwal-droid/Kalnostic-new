/**
 * Group actions run several samples / transfers in ONE transaction. Two overlapping
 * group requests that visit the same rows in different orders each hold a lock the
 * other is waiting for (a deadlock -> HTTP 500). So the work always runs in ONE fixed
 * order - ascending id, whatever order the user selected the rows in - and the result
 * is put back in the order the caller asked for.
 */

/** The ids in the fixed order group work is done in (a sorted copy; the input is untouched). */
export function inLockOrder(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/**
 * `items` re-sorted into the order of `requested` (by the id each item carries).
 * Stable; an item whose id was not requested goes to the end. The input is untouched.
 */
export function inRequestOrder<T>(
  items: readonly T[],
  requested: readonly string[],
  idOf: (item: T) => string,
): T[] {
  const position = new Map<string, number>();
  requested.forEach((id, i) => {
    if (!position.has(id)) position.set(id, i);
  });
  const rank = (item: T): number =>
    position.get(idOf(item)) ?? Number.MAX_SAFE_INTEGER;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map((x) => x.item);
}
