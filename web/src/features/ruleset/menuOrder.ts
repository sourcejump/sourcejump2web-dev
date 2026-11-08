// The order the style menus list styles in, apart from the ruleset fetch so it can be tested alone.

/**
 * The ruleset's order, but with Autosync, the style nearest Normal, right after it, as players look for it there
 * (asked 2026-11-08). A display order only: the ruleset itself is unchanged, and the Ruleset page keeps its order.
 */
export function menuOrder(keys: string[]): string[] {
  const at = keys.indexOf("autosync");
  if (keys[0] !== "normal" || at <= 1) return keys;
  return [
    keys[0],
    "autosync",
    ...keys.slice(1).filter((key) => key !== "autosync"),
  ];
}
