"use client";
// The signed-in player's menu: their profile, the staff area for staff, and signing out.
import { LogOut, ShieldCheck, User } from "lucide-react";
import type { Schemas } from "@/api/client";
import { isStaff } from "@/features/staff/sections";
import { Avatar } from "@/ui/Avatar";
import { Menu, MenuItem, MenuLink, MenuSeparator } from "@/ui/Menu";
import { useReturnTo } from "./useReturnTo";
import { avatarSrc } from "@/features/players/avatarSrc";

const SIGN_OUT_FORM = "sign-out";

export function AccountMenu({ me }: { me: Schemas["Me"] }) {
  const returnTo = useReturnTo();
  return (
    <>
      {/* A plain form post, so signing out works before scripts load. The API checks it came from our pages. */}
      <form
        id={SIGN_OUT_FORM}
        method="post"
        action={`/v1/auth/sign-out?return_to=${encodeURIComponent(returnTo)}`}
        hidden
      />
      <Menu
        label={`Account: ${me.name}`}
        align="end"
        trigger={<Avatar name={me.name} src={avatarSrc(me)} />}
        triggerClassName="flex rounded-full"
      >
        <div className="text-text-muted px-3 py-2 text-xs">
          Signed in as <span className="text-text">{me.name}</span>
        </div>
        <MenuSeparator />
        <MenuLink href={`/players/${me.steamid64}`}>
          <User aria-hidden />
          Your profile
        </MenuLink>
        {isStaff(me.privileges) && (
          <MenuLink href="/staff">
            <ShieldCheck aria-hidden />
            Staff
          </MenuLink>
        )}
        <MenuItem type="submit" form={SIGN_OUT_FORM}>
          <LogOut aria-hidden />
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
