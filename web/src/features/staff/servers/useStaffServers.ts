"use client";
// Every server, for staff who hold manage_servers, read from the browser so the Servers page's
// server render is the same for everyone. Nothing caches that render yet; it is built per request.
import { useCallback, useEffect, useState } from "react";
import { api, type Schemas } from "@/api/client";
import { useHeldPrivilege } from "../useHeldPrivilege";

/**
 * Null for everyone else, and until the list arrives. If it can't be read, staff keep the public list rather
 * than an error: nothing there is lost, and the staff tools come back on the next visit.
 */
export function useStaffServers(): {
  servers: Schemas["StaffServer"][];
  reload: () => void;
} | null {
  const allowed = useHeldPrivilege("manage_servers");
  const [servers, setServers] = useState<Schemas["StaffServer"][] | null>(null);

  const reload = useCallback(() => {
    void api
      .GET("/v1/staff/servers")
      .then((result) => {
        if (result.data) setServers(result.data.servers);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (allowed) reload();
  }, [allowed, reload]);

  return allowed && servers ? { servers, reload } : null;
}
