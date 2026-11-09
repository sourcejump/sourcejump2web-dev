import { expect, test } from "@playwright/test";
import type { Schemas } from "../src/api/client";

test("profile stats, history controls and the table follow the selected style", async ({
  page,
  request,
}) => {
  const steamid = "76561199900000002";
  const response = await request.get(`/v1/players/${steamid}`);
  expect(response.ok()).toBe(true);
  const profile = (await response.json()) as Schemas["PlayerProfile"];
  const normal = profile.styles.find((style) => style.style === "normal")!;
  await page.goto(`/players/${steamid}`);
  const stats = page.getByRole("region", {
    name: "Player statistics",
    exact: true,
  });
  await expect(stats.locator(":scope > *")).toHaveCount(6);
  await expect(
    stats.getByText("Global rank", { exact: true }).locator(".."),
  ).toContainText(`#${normal.main_standing!.rank}`);
  await expect(
    stats.getByText("Top 10s", { exact: true }).locator(".."),
  ).toContainText(
    String(
      normal.personal_bests.filter((pb) => pb.rank != null && pb.rank <= 10)
        .length,
    ),
  );
  const history = page.getByRole("region", {
    name: "Player history",
    exact: true,
  });
  await expect(
    history.getByText("Sample history", { exact: true }),
  ).toBeVisible();
  const table = page.getByRole("table");
  const before = await table.innerText();
  await history.getByRole("button", { name: /^Show/ }).click();
  await page
    .getByRole("menuitemradio", { name: "Points", exact: true })
    .click();
  await expect(history.getByRole("heading")).toContainText(
    "Points, last 12 months",
  );
  expect(await table.innerText()).toBe(before);
  const graph = history.getByRole("img");
  await graph.focus();
  await page.keyboard.press("Home");
  await expect(history.locator('[aria-live="polite"]')).toContainText("Dec");
  await page.evaluate(() => {
    (window as { profileStayed?: boolean }).profileStayed = true;
  });
  await page.getByRole("button", { name: /^Style / }).click();
  await page
    .getByRole("menuitemradio", { name: "Scroll", exact: true })
    .click();
  await expect(page).toHaveURL(/style=scroll/);
  await expect(history.getByRole("heading")).toContainText(
    "Points, last 12 months · Scroll",
  );
  expect(
    await page.evaluate(
      () => (window as { profileStayed?: boolean }).profileStayed,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /^Style / }).click();
  await page.getByRole("menuitemradio", { name: "Any", exact: true }).click();
  await expect(
    stats.getByText("Global rank", { exact: true }).locator(".."),
  ).toContainText(`#${normal.main_standing!.rank}`);
  await page.getByRole("button", { name: /^Style / }).click();
  await page
    .getByRole("menuitemradio", { name: "Autosync", exact: true })
    .click();
  await expect(
    stats.getByText("Global rank", { exact: true }).locator(".."),
  ).toContainText("—");
  await expect(
    history.getByText(/history isn't available for this player/),
  ).toBeVisible();
});

test("profile containers fit desktop and narrow phones", async ({ page }) => {
  await page.goto("/players/76561199900000002");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  for (const width of [1920, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const columns = await page
      .getByRole("region", { name: "Player statistics" })
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      );
    expect(columns).toBe(width < 640 ? 2 : 3);
  }
  expect(
    await page
      .locator("clipPath rect")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
});

test("history reveals from left to right when motion is enabled", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/players/76561199900000002");
  const scales = await page.locator("clipPath rect").evaluate((element) => {
    const animation = element.getAnimations()[0]!;
    animation.pause();
    const values = [0, 450, 900].map((time) => {
      animation.currentTime = time;
      return new DOMMatrix(getComputedStyle(element).transform).a;
    });
    animation.finish();
    return values;
  });
  expect(scales[0]).toBe(0);
  expect(scales[1]).toBeGreaterThan(0);
  expect(scales[1]).toBeLessThan(1);
  expect(scales[2]).toBe(1);
});
