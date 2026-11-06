"use client";
// A server's address with a button to copy it, for pasting into the game's console.
import { Check, Copy } from "lucide-react";
import { useState } from "react";

export function ServerAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Without clipboard access (an insecure context or a refusal) the address is still there to select.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy ${address}`}
      className="text-text-muted hover:text-text inline-flex items-center gap-2.5 text-sm tabular-nums transition-colors duration-(--duration-fast)"
    >
      {address}
      {copied ? (
        <Check
          aria-hidden
          className="text-success mt-0.75 size-3.25 self-start"
        />
      ) : (
        <Copy aria-hidden className="mt-0.75 size-3.25 self-start" />
      )}
    </button>
  );
}
