// Sign-in uses one browser origin and only shows failure text for signed-out visitors.
import { expect, test } from "@playwright/test";

test("sign-in canonicalizes a localhost alias before issuing its browser cookie", async ({
  request,
}) => {
  const alias = await request.get(
    "http://127.0.0.1:3000/v1/auth/steam?return_to=%2Fmaps%3Ftier%3D2",
    { maxRedirects: 0 },
  );
  expect(alias.status()).toBe(303);
  expect(alias.headers()["set-cookie"]).toBeUndefined();
  const canonical = new URL(alias.headers().location!);
  expect(canonical.hostname).toBe("localhost");
  expect(canonical.searchParams.get("return_to")).toBe("/maps?tier=2");
  const start = await request.get(canonical.href, { maxRedirects: 0 });
  expect(start.status()).toBe(303);
  expect(start.headers()["set-cookie"]).toContain("sj_sign_in=");
  const steam = new URL(start.headers().location!);
  expect(steam.hostname).toBe("steamcommunity.com");
  const callback = new URL(steam.searchParams.get("openid.return_to")!);
  expect(callback.origin).toBe(canonical.origin);
  expect(callback.searchParams.get("return_to")).toBe("/maps?tier=2");
});

test("a signed-out visitor still sees the sign-in failure message", async ({
  page,
}) => {
  await page.goto("/sign-in/failed");
  await expect(
    page.getByRole("heading", { name: "Sign-in didn't complete" }),
  ).toBeVisible();
  await expect(
    page.getByRole("main").getByRole("link", { name: "Sign in with Steam" }),
  ).toBeVisible();
});
