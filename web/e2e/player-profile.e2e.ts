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
  await history.getByRole("button", { name: /^Show/ }).click();
  await page
    .getByRole("menuitemradio", { name: "World records", exact: true })
    .click();
  await expect(history.getByRole("heading")).toContainText(
    "World records, last 12 months · Normal · All tracks",
  );
  expect(await table.innerText()).toBe(before);
  await graph.focus();
  await page.keyboard.press("End");
  await expect(history.locator('[aria-live="polite"]')).toContainText(
    ` · ${normal.world_records} · sample history`,
  );
  await page.evaluate(() => {
    (window as { profileStayed?: boolean }).profileStayed = true;
  });
  await page.getByRole("button", { name: /^Style / }).click();
  await page
    .getByRole("menuitemradio", { name: "Scroll", exact: true })
    .click();
  await expect(page).toHaveURL(/style=scroll/);
  await expect(history.getByRole("heading")).toContainText(
    "World records, last 12 months · Scroll · All tracks",
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

test("stat cards open the player's matching progress without changing style", async ({
  page,
  request,
}) => {
  const steamid = "76561199900000002";
  const profile = (await (
    await request.get(`/v1/players/${steamid}`)
  ).json()) as Schemas["PlayerProfile"];
  const normal = profile.styles.find((style) => style.style === "normal")!;
  const bonuses = (await (
    await request.get(
      `/v1/players/${steamid}/personal-bests?style=normal&tracks=bonuses&limit=100`,
    )
  ).json()) as Schemas["PersonalBestPage"];
  expect(bonuses.next_cursor).not.toBeTruthy();
  await page.goto(`/players/${steamid}`);
  const stats = page.getByRole("region", { name: "Player statistics" });
  const times = page.getByRole("region", { name: "Player times" });
  const card = (name: string) =>
    stats.getByRole("button", { name: new RegExp(`^${name}`) });
  const top10 = normal.personal_bests.filter(
    (pb) => pb.rank != null && pb.rank <= 10,
  );
  const all = [...normal.personal_bests, ...bonuses.personal_bests];

  async function expectRuns(pbs: Schemas["PersonalBest"][]) {
    await expect(times.locator("tbody tr")).toHaveCount(pbs.length);
    expect(
      await times
        .locator('tbody a[href^="/maps/"]')
        .evaluateAll((links) =>
          links.map((a) => a.getAttribute("href")).sort(),
        ),
    ).toEqual(
      pbs
        .map(
          (pb) =>
            `/maps/${pb.map}?style=${pb.style}${pb.track > 0 ? `&track=${pb.track}` : ""}`,
        )
        .sort(),
    );
  }

  await expect(stats.getByRole("link")).toHaveCount(2);
  await expect(stats.getByRole("button")).toHaveCount(4);
  await page.evaluate(() => {
    (window as { progressStayed?: boolean }).progressStayed = true;
  });
  await card("Bonuses completed").click();
  await expect(page).toHaveURL(/style=normal.*tracks=bonuses/);
  await expect(times).toBeFocused();
  await expect(card("Bonuses completed")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expectRuns(bonuses.personal_bests);
  await expect(stats.getByRole("link", { name: /^Points/ })).toHaveAttribute(
    "href",
    "/leaderboards/points?track=bonuses",
  );
  await card("Maps completed").click();
  await expect(card("Maps completed")).toHaveAttribute("aria-pressed", "true");
  await expectRuns(normal.personal_bests);
  await card("Top 10s").click();
  await expect(page).toHaveURL(/show=top10/);
  await expect(card("Top 10s")).toHaveAttribute("aria-pressed", "true");
  await expectRuns(top10);
  await expect(times).toContainText(`All ${top10.length} top 10 finishes`);
  await expect(card("Top 10s")).toContainText(String(top10.length));
  await times.getByRole("button", { name: /^Show/ }).click();
  await page
    .getByRole("menuitemradio", { name: "All runs", exact: true })
    .click();
  await expectRuns(normal.personal_bests);
  await card("World records").click();
  await expect(page).toHaveURL(/tracks=any.*show=records/);
  await expect(card("World records")).toHaveAttribute("aria-pressed", "true");
  await expectRuns(all.filter((pb) => pb.rank === 1));
  await card("Top 10s").click();
  await expectRuns(all.filter((pb) => pb.rank != null && pb.rank <= 10));
  await expect(page.getByRole("button", { name: /^Style / })).toContainText(
    "Normal",
  );
  expect(
    await page.evaluate(
      () => (window as { progressStayed?: boolean }).progressStayed,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: /^Style / }).click();
  await page
    .getByRole("menuitemradio", { name: "Autosync", exact: true })
    .click();
  await card("Bonuses completed").click();
  await expect(times).toContainText(
    "No Autosync personal bests on bonuses yet.",
  );
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
