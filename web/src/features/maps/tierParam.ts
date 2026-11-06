// Reads a tier from the address (`?tier=`), for the pages that filter by one.

/**
 * A tier the API takes (1 up to its 16-bit limit), or none. Any other is ignored rather than sent on, where
 * the API would refuse it and the page would show an error no retry fixes.
 */
export function tierParam(text: string | undefined): number | undefined {
  const tier = Math.floor(Number(text));
  return tier >= 1 && tier <= 32767 ? tier : undefined;
}
