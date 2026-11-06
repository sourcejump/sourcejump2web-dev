"use client";
// Sends the player to Steam to sign in, and back to this page afterwards.
import { ButtonAnchor } from "@/ui/Button";
import { useReturnTo } from "./useReturnTo";

export function SignInButton() {
  const returnTo = useReturnTo();
  return (
    // A full page load, not a client navigation: the API redirects to Steam.
    <ButtonAnchor
      href={`/v1/auth/steam?return_to=${encodeURIComponent(returnTo)}`}
      size="sm"
    >
      Sign in with Steam
    </ButtonAnchor>
  );
}
