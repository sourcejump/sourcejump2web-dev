"use client";
// A modal window, e.g. a run's details over the leaderboard. Controlled: the caller owns `open`.
import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./Button";

/**
 * Uses the native <dialog> element, which traps focus, makes the page behind it inert, closes on
 * Escape and returns focus to the opener. Clicking the backdrop also closes it. A field marked
 * `data-autofocus` takes focus each time it opens.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** `lg` for a large view such as a replay. */
  size?: "md" | "lg";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closingQuietly = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) {
      element.showModal();
      // React's autoFocus runs once on mount, while the dialog is still closed, so a field that should
      // take focus on each opening is marked `data-autofocus` instead.
      element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    }
    if (!open && element.open) element.close();
    // A page left by a link is kept hidden for Back (React's Activity) rather than unmounted: its effects
    // clean up, but the element stays. An open modal dialog would keep the new page inert, so it closes,
    // without telling the owner (who would otherwise navigate back). Showing the page again reopens it.
    return () => {
      if (element.open) {
        closingQuietly.current = true;
        element.close();
      }
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      onClose={() => {
        if (closingQuietly.current) {
          closingQuietly.current = false;
          return;
        }
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) onClose();
      }}
      aria-labelledby={titleId}
      // The element sits wherever its opener is, such as a table cell, and would inherit that text layout.
      className={`border-border-strong bg-surface text-text shadow-dialog backdrop:bg-bg/75 open:motion-enter m-auto rounded-lg border p-0 text-left text-base font-normal whitespace-normal ${size === "lg" ? "w-[min(100%-2rem,64rem)]" : "w-[min(100%-2rem,36rem)]"}`}
    >
      <div className="border-border flex items-center justify-between gap-4 border-b px-5 py-3">
        <h2 id={titleId} className="text-lg font-bold">
          {title}
        </h2>
        <Button variant="ghost" size="sm" aria-label="Close" onClick={onClose}>
          <X aria-hidden />
        </Button>
      </div>
      <div className="px-5 py-4">{children}</div>
      {footer && (
        <div className="border-border flex justify-end gap-2 border-t px-5 py-3">
          {footer}
        </div>
      )}
    </dialog>
  );
}
