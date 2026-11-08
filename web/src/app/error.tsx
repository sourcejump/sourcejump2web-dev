"use client";
// The page for an unexpected failure while showing any page below the root layout, so the header and footer stay
// and the player can try again or move on, instead of a blank error screen.
import { useEffect } from "react";
import { Button, ButtonLink } from "@/ui/Button";
import { Page } from "@/ui/Page";

export default function ErrorPage({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  useEffect(() => {
    // The server logs its own failures; this keeps the browser's in its console for whoever reports one.
    console.error(error);
  }, [error]);

  return (
    <Page width="narrow">
      <div className="flex flex-col items-start gap-4">
        <h1 className="text-3xl font-bold">Something went wrong</h1>
        <p className="text-text-muted">
          This page couldn&apos;t be shown. Try again, or come back in a moment.
        </p>
        <div className="flex gap-3">
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
          <ButtonLink href="/">Go to the home page</ButtonLink>
        </div>
      </div>
    </Page>
  );
}
