// The ranked styles' display names and order, from the current ruleset.
import { currentRuleset } from "./currentRuleset";
import { menuOrder } from "./menuOrder";

export interface Styles {
  /** Style keys in the ruleset's order, Autosync moved up after Normal (`menuOrder`). */
  keys: string[];
  /** The style's name, or its key for a style the current ruleset no longer ranks. */
  name: (key: string) => string;
}

/** Without a ruleset, or while the API can't be reached, keys stand in for names. */
export async function currentStyles(): Promise<Styles> {
  const ruleset = await currentRuleset().catch(() => null);
  const styles = ruleset?.styles ?? [];
  const names = new Map(styles.map((style) => [style.key, style.name]));
  return {
    keys: menuOrder(styles.map((style) => style.key)),
    name: (key) => names.get(key) ?? key,
  };
}
