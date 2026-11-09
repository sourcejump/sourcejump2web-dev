// Map-card regressions: real podiums, complete text, responsive columns and stable image dimensions.
import { expect, test, type Locator } from "@playwright/test";
import type { Schemas } from "../src/api/client";
import { formatTime } from "../src/features/runs/time";

async function expectTextInside(card: Locator) {
  const clipped = await card.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const failures: string[] = [];
    let node;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of Array.from(range.getClientRects())) {
        if (
          rect.left < bounds.left - 1 ||
          rect.right > bounds.right + 1 ||
          rect.top < bounds.top - 1 ||
          rect.bottom > bounds.bottom + 1
        ) {
          failures.push(node.textContent);
        }
      }
    }
    return failures;
  });
  expect(clipped).toEqual([]);
}

test("cards show the API's top three for the chosen style", async ({
  page,
  request,
}) => {
  const response = await request.get("/v1/maps?limit=1&sort=popular");
  const list = (await response.json()) as Schemas["MapList"];
  const map = list.maps[0]!;
  const result = await request.get(
    `/v1/maps/${encodeURIComponent(map.name)}/leaderboard?style=${list.style}&limit=3`,
  );
  const board = (await result.json()) as Schemas["Leaderboard"];
  await page.goto("/maps");
  const card = page.locator(`[data-map="${map.name}"]`);
  await expect(card).toBeVisible();
  const rows = card.locator("ol > li");
  await expect(rows).toHaveCount(board.entries.length);
  for (let index = 0; index < board.entries.length; index++) {
    const entry = board.entries[index]!;
    await expect(
      rows.nth(index).getByLabel(`Placement ${entry.rank}`),
    ).toBeVisible();
    await expect(
      rows.nth(index).getByText(entry.player.name, { exact: true }),
    ).toBeVisible();
    await expect(
      rows.nth(index).getByText(formatTime(entry.time), { exact: true }),
    ).toBeVisible();
  }
  await expectTextInside(card);
  const preview = await card.evaluate((element) => {
    const cover = element.firstElementChild!;
    const image = cover.firstElementChild!;
    const records = element.querySelector("ol")!;
    return {
      bottom: cover.getBoundingClientRect().bottom,
      records: records.getBoundingClientRect().top,
      mask: getComputedStyle(image).maskImage,
      filter: getComputedStyle(image).filter,
    };
  });
  expect(preview.bottom).toBeLessThanOrEqual(preview.records);
  expect(preview.mask).toBe("none");
  expect(preview.filter).toBe("none");
});

test("map hover stays still and the preview opens the map", async ({
  page,
}) => {
  await page.goto("/maps");
  const card = page.locator("[data-map]").first();
  await expect(card).toBeVisible();
  await card.scrollIntoViewIfNeeded();
  const before = await card.boundingBox();
  const border = await card.evaluate(
    (element) => getComputedStyle(element).borderColor,
  );
  await card.hover();
  expect(await card.boundingBox()).toEqual(before);
  expect(
    await card.evaluate((element) => getComputedStyle(element).borderColor),
  ).not.toBe(border);
  const href = await card.locator("h3 a").getAttribute("href");
  const preview = await card.locator(":scope > div").first().boundingBox();
  await page.mouse.click(
    preview!.x + preview!.width / 2,
    preview!.y + preview!.height / 2,
  );
  await expect(page).toHaveURL(new RegExp(`${href}$`));
});

test("player links and replay controls work independently of the map link", async ({
  page,
}) => {
  await page.goto("/maps");
  const card = page.locator("[data-map]").first();
  await expect(card).toBeVisible();
  await page.evaluate(() => {
    (window as { mapsStillHere?: boolean }).mapsStillHere = true;
  });
  const replay = card
    .getByRole("link", { name: "Watch replay", exact: true })
    .first();
  const href = await replay.getAttribute("href");
  const id = /\/runs\/(\d+)/.exec(href!)![1];
  await replay.click();
  await expect(page).toHaveURL(new RegExp(`/maps\\?replay=${id}$`));
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Run page" })).toHaveAttribute(
    "href",
    `/runs/${id}`,
  );
  expect(
    await page.evaluate(
      () => (window as { mapsStillHere?: boolean }).mapsStillHere,
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/maps$/);
  await expect(replay).toBeFocused();
  const player = card
    .locator("ol > li")
    .first()
    .locator('a[href^="/players/"]');
  await expect(
    card.locator("ol > li").first().locator('a[href^="/players/"]'),
  ).toHaveCount(1);
  const profile = await player.getAttribute("href");
  const avatar = player.locator(":scope > span").first();
  const name = player.locator(":scope > span").nth(1);
  const color = await name.evaluate(
    (element) => getComputedStyle(element).color,
  );
  const avatarBorder = await avatar
    .locator("img, span")
    .first()
    .evaluate((element) => getComputedStyle(element).borderColor);
  await avatar.hover();
  await expect
    .poll(() => name.evaluate((element) => getComputedStyle(element).color))
    .not.toBe(color);
  expect(
    await avatar
      .locator("img, span")
      .first()
      .evaluate((element) => getComputedStyle(element).borderColor),
  ).toBe(avatarBorder);
  await avatar.click();
  await expect(page).toHaveURL(new RegExp(`${profile}$`));
  await page.goBack();
  await player.locator(":scope > span").nth(1).click();
  await expect(page).toHaveURL(new RegExp(`${profile}$`));
  await expect(dialog).toBeHidden();
});

test("cards keep complete names and long times inside at every breakpoint", async ({
  page,
}) => {
  await page.goto("/maps");
  const card = page.locator("[data-map]").first();
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await card.evaluate((element) => {
    element.querySelector("h3 a")!.textContent =
      "bhop_" + "long_map_name_".repeat(5).slice(0, 59);
    for (const row of Array.from(element.querySelectorAll("ol > li"))) {
      const player = row.querySelector('a[href^="/players/"]')!;
      const result = row.lastElementChild!;
      player.children[1]!.textContent =
        "Long player name 玩家 日本語 Кириллица";
      result.children[0]!.querySelector("a")!.textContent = "1:23:45.678";
      result.children[1]!.textContent = "+2:34:56.789";
    }
  });
  for (const width of [1920, 1440, 1084, 1080, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await expectTextInside(card);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    const layout = await card.evaluate((element) => ({
      width: element.clientWidth,
      result: getComputedStyle(
        element.querySelector("ol > li > span:last-child")!,
      ).display,
    }));
    expect(layout.result).toBe(layout.width >= 320 ? "grid" : "flex");
    if (width === 1920 || width === 1440) {
      const columns = await card
        .locator("xpath=../..")
        .evaluate(
          (element) =>
            getComputedStyle(element).gridTemplateColumns.split(" ").length,
        );
      expect(columns).toBe(width === 1920 ? 4 : 3);
    }
  }
});

test("loading avatars and map pictures does not move the podium", async ({
  page,
}) => {
  await page.route(
    /avatars(?:\.[a-z]+)?\.steamstatic\.com|\/v1\/players\/[^/]+\/avatar/,
    (route) => route.abort(),
  );
  await page.goto("/maps");
  const card = page.locator("[data-map]").first();
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const before = await card.locator("ol").boundingBox();
  await card
    .locator("img")
    .evaluateAll((images) =>
      Promise.all(
        images.map((image) =>
          (image as HTMLImageElement).decode().catch(() => {}),
        ),
      ),
    );
  expect(await card.locator("ol").boundingBox()).toEqual(before);
  await expect(card.locator("ol img")).toHaveCount(0);
  await expectTextInside(card);
});

test("a single finisher and an empty style stay honest and readable", async ({
  page,
  request,
}) => {
  let selected: { list: Schemas["MapList"]; style: string } | undefined;
  for (const style of ["scroll", "hsw"]) {
    const response = await request.get(`/v1/maps?style=${style}&limit=100`);
    if (!response.ok()) continue;
    const list = (await response.json()) as Schemas["MapList"];
    if (
      list.style === style &&
      list.maps.some((map) => !map.world_record) &&
      list.maps.some((map) => map.world_record)
    ) {
      selected = { list, style };
      break;
    }
  }
  test.skip(
    !selected,
    "The current API data has no style with both empty and populated boards.",
  );
  const { list, style } = selected!;
  const empty = list.maps.find((map) => !map.world_record)!;
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/maps?style=${style}&q=${encodeURIComponent(empty.name)}`);
  const emptyCard = page.locator(`[data-map="${empty!.name}"]`);
  await expect(
    emptyCard.getByText("No times in this style", { exact: true }),
  ).toBeVisible();
  await expect(emptyCard.getByLabel("Placement 1")).toHaveCount(0);
  await expectTextInside(emptyCard);
  await expect(emptyCard.locator("h3 a")).toHaveAttribute(
    "href",
    `/maps/${empty.name}?style=${style}`,
  );

  // Pick an actual sparse board rather than inventing second and third place.
  let single: string | undefined;
  for (const map of list.maps
    .filter((map) => map.world_record)
    .sort((a, b) => a.players - b.players)
    .slice(0, 6)) {
    const response = await request.get(
      `/v1/maps/${encodeURIComponent(map.name)}/leaderboard?style=${style}&limit=3`,
    );
    const board = (await response.json()) as Schemas["Leaderboard"];
    if (board.total === 1) {
      single = map.name;
      break;
    }
  }
  test.skip(
    !single,
    "The current API data has no sampled board with one finisher.",
  );
  await page.goto(`/maps?style=${style}&q=${encodeURIComponent(single!)}`);
  const singleCard = page.locator(`[data-map="${single}"]`);
  await expect(singleCard.locator("ol > li")).toHaveCount(1);
  await expect(singleCard.getByText(/ranked times? in this style/)).toHaveCount(
    0,
  );
  await expect(singleCard.getByLabel("Placement 1")).toBeVisible();
  await expect(singleCard.getByLabel("Placement 2")).toHaveCount(0);
  await expectTextInside(singleCard);
});
