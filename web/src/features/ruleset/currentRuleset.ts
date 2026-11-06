// The current ruleset, read from the API once per web server process.
import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { api, type Schemas } from "@/api/client";

/**
 * The current ruleset, or null if none is published. Throws when the API can't be reached, and a failed read
 * isn't cached, so the next request asks again.
 */
export async function currentRuleset(): Promise<Schemas["Ruleset"] | null> {
  // Read at request time, never while the site is built: the API isn't reachable then, and a build-time read
  // would be kept in the static shell.
  await connection();
  return cachedRuleset();
}

// A ruleset is published only by a migration (`docs/domain.md`), which ships with a deploy, and a deploy
// restarts the web app, which empties this in-memory cache. So the read can be kept for the process's life.
async function cachedRuleset(): Promise<Schemas["Ruleset"] | null> {
  "use cache";
  cacheLife("max");
  const result = await api.GET("/v1/ruleset");
  if (result.data) return result.data;
  if (result.response.status === 404) return null;
  throw new Error(`GET /v1/ruleset answered ${result.response.status}`);
}
