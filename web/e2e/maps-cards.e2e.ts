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
});

test("cards keep complete names and long times inside at every breakpoint", async ({
  page,
}) => {
  await page.goto("/maps");
  const card = page.locator("[data-map]").first();
  await expect(card).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await card.evaluate((element) => {
    element.querySelector("h3")!.textContent =
      "bhop_" + "long_map_name_".repeat(5).slice(0, 59);
    for (const row of Array.from(element.querySelectorAll("ol > li"))) {
      const player = row.children[2]!;
      const result = row.children[3]!;
      player.textContent = "Long player name 玩家 日本語 Кириллица";
      result.children[0]!.textContent = "1:23:45.678";
      result.children[1]!.textContent = "+2:34:56.789";
    }
  });
  for (const width of [1440, 1084, 1080, 1024, 768, 390, 320]) {
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
  }
});

test("loading avatars and map pictures does not move the podium", async ({
  page,
}) => {
  await page.route(/avatars\.(?:akamai\.)?steamstatic\.com/, (route) =>
    route.abort(),
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
  const response = await request.get("/v1/maps?style=scroll&limit=100");
  const list = (await response.json()) as Schemas["MapList"];
  test.skip(list.style !== "scroll", "The API has no Scroll style.");
  const empty = list.maps.find((map) => !map.world_record);
  test.skip(!empty, "The current API data has no empty Scroll board.");
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`/maps?style=scroll&q=${encodeURIComponent(empty!.name)}`);
  const emptyCard = page.locator(`[data-map="${empty!.name}"]`);
  await expect(
    emptyCard.getByText("No times in this style", { exact: true }),
  ).toBeVisible();
  await expect(emptyCard.getByLabel("Placement 1")).toHaveCount(0);
  await expectTextInside(emptyCard);
  await expect(emptyCard).toHaveAttribute(
    "href",
    `/maps/${empty!.name}?style=scroll`,
  );

  // Pick an actual sparse board rather than inventing second and third place.
  let single: string | undefined;
  for (const map of list.maps
    .filter((map) => map.world_record)
    .sort((a, b) => a.players - b.players)
    .slice(0, 6)) {
    const response = await request.get(
      `/v1/maps/${encodeURIComponent(map.name)}/leaderboard?style=scroll&limit=3`,
    );
    const board = (await response.json()) as Schemas["Leaderboard"];
    if (board.total === 1) {
      single = map.name;
      break;
    }
  }
  test.skip(
    !single,
    "The current API data has no sampled Scroll board with one finisher.",
  );
  await page.goto(`/maps?style=scroll&q=${encodeURIComponent(single!)}`);
  const singleCard = page.locator(`[data-map="${single}"]`);
  await expect(
    singleCard.getByText("1 ranked time in this style", { exact: true }),
  ).toBeVisible();
  await expect(singleCard.getByLabel("Placement 1")).toBeVisible();
  await expect(singleCard.getByLabel("Placement 2")).toHaveCount(0);
  await expectTextInside(singleCard);
});
