// The page to come back to after signing in or out: its path and query, so filters and open dialogs stay.
import { usePathname, useSearchParams } from "next/navigation";

export function useReturnTo(): string {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  return search ? `${pathname}?${search}` : pathname;
}
