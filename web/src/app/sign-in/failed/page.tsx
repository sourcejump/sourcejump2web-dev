// Where sign-in lands when Steam didn't confirm it.
import type { Metadata } from "next";
import { Page } from "@/ui/Page";
import { SteamButton } from "@/ui/SteamButton";

export const metadata: Metadata = {
  title: "Sign-in didn't complete",
  robots: { index: false },
};

export default function SignInFailedPage() {
  return (
    <Page width="narrow" className="items-start gap-4">
      <h1 className="text-3xl font-bold">Sign-in didn&apos;t complete</h1>
      <p className="text-text-muted">
        Steam didn&apos;t confirm the sign-in, or it took too long. Nothing was
        changed. Try again.
      </p>
      <SteamButton href="/v1/auth/steam">Sign in with Steam</SteamButton>
    </Page>
  );
}
