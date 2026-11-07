"use client";
// Sends the player to Steam to sign in, and back to this page afterwards.
import { SteamButton } from "@/ui/SteamButton";
import { useReturnTo } from "./useReturnTo";

export function SignInButton() {
  const returnTo = useReturnTo();
  return (
    <SteamButton
      href={`/v1/auth/steam?return_to=${encodeURIComponent(returnTo)}`}
    >
      Sign in<span className="max-sm:hidden"> with Steam</span>
    </SteamButton>
  );
}
