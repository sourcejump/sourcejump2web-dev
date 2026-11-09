"use client";
// Sends the player to Steam to sign in, and back to this page afterwards.
import { SteamButton } from "@/ui/SteamButton";
import { useReturnTo } from "./useReturnTo";

export function SignInButton() {
  const returnTo = useReturnTo();
  return (
    <SteamButton
      href={`/v1/auth/steam?return_to=${encodeURIComponent(returnTo)}`}
      // Just the logo below 360px, as a square: the hidden label would otherwise leave its gap beside it.
      className="max-xs:w-9 max-xs:justify-center max-xs:gap-0 max-xs:px-0"
    >
      <span className="max-xs:sr-only">Sign in</span>
      <span className="max-sm:hidden"> with Steam</span>
    </SteamButton>
  );
}
