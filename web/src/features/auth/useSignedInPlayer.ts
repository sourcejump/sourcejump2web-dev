"use client";
// The signed-in player, asked from the browser. Public pages show per-player buttons and staff tools through
// this, so their server render is the same for everyone (nothing caches it yet; it is built per request). The API
// checks every change again.
import { useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";

/** Asked once per visit: signing in or out reloads the page. */
let asked: Promise<Schemas["Me"] | null> | undefined;
function loadMe() {
  asked ??= api
    .GET("/v1/me")
    .then((result) => result.data ?? null)
    .catch(() => null);
  return asked;
}

/** Undefined until the answer arrives; null when signed out or when the API can't be reached. */
export function useSignedInPlayer(): Schemas["Me"] | null | undefined {
  const [me, setMe] = useState<Schemas["Me"] | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    void loadMe().then((player) => current && setMe(player));
    return () => {
      current = false;
    };
  }, []);
  return me;
}
