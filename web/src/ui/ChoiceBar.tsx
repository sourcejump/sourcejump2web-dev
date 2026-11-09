// The row of ChoiceMenus (and tabs) above a board or list, so every page spaces its choices the same way.
import type { ReactNode } from "react";

export function ChoiceBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
      {children}
    </div>
  );
}
