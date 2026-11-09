// Regression checks for the Maps overview's alignment and filtered layouts.
import { expect, test, type Locator } from "@playwright/test";
import type { Schemas } from "../src/api/client";

async function expectAligned(overview: Locator) {
  const geometry = await overview.evaluate((element) => {
    const nav = element.querySelector("nav")!;
    const links = nav.querySelectorAll("li a");
    const reset = nav.querySelector("a")!.getBoundingClientRect();
    const first = links[0]!.firstElementChild!.getBoundingClientRect();
    const last =
      links[links.length - 1]!.lastElementChild!.getBoundingClientRect();
    const panel = element.getBoundingClientRect();
    const graph = element.querySelector("svg")!.getBoundingClientRect();
    const legend = nav.getBoundingClientRect();
    const center = (rect: DOMRect) => rect.y + rect.height / 2;
    return {
      left: Math.abs(reset.left - first.left),
      right: Math.abs(reset.right - last.right),
      graph: Math.abs(center(graph) - center(panel)),
      legend: Math.abs(center(legend) - center(panel)),
      headings: Array.from(element.querySelectorAll("section h2")).map(
        (heading) => heading.getBoundingClientRect().top,
      ),
    };
  });
  expect(geometry.left).toBeLessThan(1);
  expect(geometry.right).toBeLessThan(1);
  expect(geometry.graph).toBeLessThan(1);
  expect(geometry.legend).toBeLessThan(1);
  for (const top of geometry.headings) {
    expect(Math.abs(top - geometry.headings[0]!)).toBeLessThan(1);
  }
}

test("the overview stays centered and the reset matches the tier columns", async ({
  page,
}) => {
  await page.goto("/maps");
  const overview = page.getByRole("region", {
    name: "Map overview",
    exact: true,
  });
  const nav = overview.getByRole("navigation", { name: "Filter maps by tier" });
  await expect(nav).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectAligned(overview);

  // The page name remains available to screen readers without adding a visible heading.
  const heading = await page
    .getByRole("heading", { name: "Maps", exact: true })
    .boundingBox();
  expect(heading!.height).toBeLessThanOrEqual(1);

  const reset = nav.getByRole("link", { name: /All tiers/ });
  const firstTier = nav.locator("li a").first();
  const bounds = await firstTier.boundingBox();
  await firstTier.hover();
  expect(await firstTier.boundingBox()).toEqual(bounds);
  await reset.focus();
  await page.keyboard.press("Tab");
  await expect(firstTier).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(firstTier).toHaveAttribute("aria-current", "true");
  await expectAligned(overview);
  await reset.click();
  await expect(reset).toHaveAttribute("aria-current", "true");
  await expectAligned(overview);

  await page.setViewportSize({ width: 1920, height: 1000 });
  const spacing = await overview.evaluate((element) => {
    const groups = Array.from(element.querySelectorAll("section"));
    return {
      trailing:
        element.getBoundingClientRect().right -
        groups[groups.length - 1]!.getBoundingClientRect().right,
      columnGaps: groups.map(
        (group) =>
          group.getBoundingClientRect().right -
          (group.querySelector("ul") ?? group).getBoundingClientRect().right,
      ),
    };
  });
  expect(spacing.trailing).toBeLessThanOrEqual(21);
  for (const gap of spacing.columnGaps) expect(gap).toBeLessThan(1);
  const controls = await overview.locator("xpath=../..").evaluate((element) => {
    const frame = element
      .querySelector('[aria-label="Map overview"]')!
      .parentElement!.getBoundingClientRect();
    const input = element
      .querySelector('input[type="search"]')!
      .getBoundingClientRect();
    const buttons = element.querySelectorAll('button[aria-haspopup="menu"]');
    const first = buttons[0]!.getBoundingClientRect();
    const gallery = document
      .querySelector("[data-map]")!
      .closest("section")!
      .getBoundingClientRect();
    return {
      searchWidth: input.width,
      left: Math.abs(first.left - gallery.left),
      right: Math.abs(input.right - gallery.right),
      separated: input.top - frame.bottom,
      frameCenter: Math.abs(
        (frame.left + frame.right - gallery.left - gallery.right) / 2,
      ),
      frameWidth: frame.width,
      pageWidth: gallery.width,
    };
  });
  expect(controls.searchWidth).toBeLessThanOrEqual(320);
  expect(controls.left).toBeLessThan(1);
  expect(controls.right).toBeLessThan(1);
  expect(controls.separated).toBeGreaterThanOrEqual(20);
  expect(controls.frameCenter).toBeLessThan(1);
  expect(controls.frameWidth).toBeLessThan(controls.pageWidth);
});

test("the donut has clean sector boundaries, animates hover and has no click focus box", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/maps");
  const chart = page.getByRole("img", { name: /Maps per tier/ });
  await expect(chart).toBeVisible();
  const geometry = await chart.evaluate((svg) => {
    const rect = svg.getBoundingClientRect();
    const reset = svg.parentElement!.querySelector("nav > a")!.textContent!;
    const total = Number(reset.match(/([\d,]+) maps/)![1]!.replaceAll(",", ""));
    const links = Array.from(svg.querySelectorAll("a"));
    const count = Number(
      links[0]!
        .getAttribute("aria-label")!
        .match(/: ([\d,]+) maps/)![1]!
        .replaceAll(",", ""),
    );
    const angle = (((((count / total) * 100) / 2) * 3.6 - 90) * Math.PI) / 180;
    const hit = (share: number, radius: number) => {
      const angle = (share / 100) * Math.PI * 2 - Math.PI / 2;
      return (
        document
          .elementFromPoint(
            rect.x + rect.width * (0.5 + (radius / 100) * Math.cos(angle)),
            rect.y + rect.height * (0.5 + (radius / 100) * Math.sin(angle)),
          )
          ?.closest("svg a")
          ?.getAttribute("aria-label") ?? null
      );
    };
    let start = 0;
    const samples = links.map((link) => {
      const label = link.getAttribute("aria-label")!;
      const count = Number(
        label.match(/: ([\d,]+) maps/)![1]!.replaceAll(",", ""),
      );
      const length = (count / total) * 100;
      const sample = {
        label,
        middle: [33, 40, 47].map((radius) => hit(start + length / 2, radius)),
        seam:
          length === 100
            ? []
            : [33, 40, 47].map((radius) => hit(start, radius)),
      };
      start += length;
      return sample;
    });
    return {
      samples,
      x: rect.x + rect.width * (0.5 + 0.4 * Math.cos(angle)),
      y: rect.y + rect.height * (0.5 + 0.4 * Math.sin(angle)),
    };
  });
  for (const sample of geometry.samples) {
    for (const middle of sample.middle) expect(middle).toBe(sample.label);
    for (const seam of sample.seam) expect(seam).toBeNull();
  }
  const highlight = chart.locator("a").first().locator("path").last();
  await expect(highlight).toHaveCSS("opacity", "0");
  await page.mouse.move(geometry.x, geometry.y);
  const hovered = await chart
    .locator("a")
    .first()
    .locator("path")
    .last()
    .evaluate(async (path) => {
      await Promise.all(
        path.getAnimations().map((animation) => animation.finished),
      );
      const style = getComputedStyle(path);
      return {
        transition: style.transitionProperty,
        duration: parseFloat(style.transitionDuration),
      };
    });
  await expect(highlight).toHaveCSS("opacity", "1");
  expect(hovered.transition).toContain("opacity");
  expect(hovered.duration).toBeGreaterThan(0);
  await page.mouse.click(geometry.x, geometry.y);
  await expect(chart.locator("text").first()).not.toHaveText("All");
  expect(
    await chart
      .locator("a")
      .first()
      .evaluate((link) => getComputedStyle(link).outlineStyle),
  ).toBe("none");
});

test("a filtered short list is centered and its details stay beside the names", async ({
  page,
  request,
}) => {
  const response = await request.get("/v1/maps?limit=1");
  expect(response.ok()).toBe(true);
  const { stats } = (await response.json()) as { stats: Schemas["MapStats"] };
  const tier =
    stats.by_tier.findIndex((_, index) => {
      const newest = stats.newest.filter(
        (map) => map.tier === index + 1,
      ).length;
      const played = stats.played_this_week.filter(
        (map) => map.tier === index + 1,
      ).length;
      return (
        (newest > 0 && newest < 5 && played === 0) ||
        (played > 0 && played < 5 && newest === 0)
      );
    }) + 1;
  test.skip(
    tier === 0,
    "The current API data has no tier with just one short summary list.",
  );

  await page.goto("/maps");
  const headingPositions = await page
    .getByRole("region", { name: "Map overview", exact: true })
    .locator("section")
    .evaluateAll((sections) =>
      Object.fromEntries(
        sections.map((section) => [
          section.getAttribute("aria-label"),
          section.querySelector("h2")!.getBoundingClientRect().top,
        ]),
      ),
    );

  await page.goto(`/maps?tier=${tier}`);
  const overview = page.getByRole("region", {
    name: "Map overview",
    exact: true,
  });
  await expect(overview.getByRole("navigation")).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expectAligned(overview);
  const filteredHeading = await overview
    .locator("section:has(ul)")
    .first()
    .evaluate((section) => ({
      name: section.getAttribute("aria-label")!,
      top: section.querySelector("h2")!.getBoundingClientRect().top,
    }));
  expect(
    Math.abs(filteredHeading.top - headingPositions[filteredHeading.name]),
  ).toBeLessThan(1);
  const list = overview.locator("section:has(ul)").first().locator("ul");
  await expect(list).toHaveCount(1);
  const layout = await list.evaluate((element) =>
    Array.from(element.querySelectorAll("a")).map((row) => {
      const name = row.children[1]!.getBoundingClientRect();
      const detail = row.children[2]!.getBoundingClientRect();
      return {
        width: row.getBoundingClientRect().width,
        gap: detail.left - name.right,
        top: Math.abs(detail.top - name.top),
      };
    }),
  );
  for (const row of layout) {
    expect(row.width).toBeLessThan(250);
    expect(Math.abs(row.gap - 8)).toBeLessThan(1);
    expect(row.top).toBeLessThan(1);
  }
});

test("the compact legend fits a narrow phone without changing its reset alignment", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/maps");
  const nav = page.getByRole("navigation", { name: "Filter maps by tier" });
  await expect(nav).toBeVisible();
  const edges = await nav.evaluate((element) => {
    const reset = element.querySelector("a")!.getBoundingClientRect();
    const links = element.querySelectorAll("li a");
    return {
      left:
        reset.left - links[0]!.firstElementChild!.getBoundingClientRect().left,
      right:
        reset.right -
        links[links.length - 1]!.lastElementChild!.getBoundingClientRect()
          .right,
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(Math.abs(edges.left)).toBeLessThan(1);
  expect(Math.abs(edges.right)).toBeLessThan(1);
  expect(edges.overflow).toBe(false);
});

test("searching a WR holder shows their maps", async ({ page, request }) => {
  const response = await request.get("/v1/maps?limit=100");
  expect(response.ok()).toBe(true);
  const all = (await response.json()) as Schemas["MapList"];
  const holder = all.maps.find((map) => map.world_record)?.world_record?.player
    .name;
  test.skip(
    !holder,
    "The current data has no world record holders to search for.",
  );
  const matches = await request.get(
    `/v1/maps?q=${encodeURIComponent(holder!)}&sort=popular`,
  );
  expect(matches.ok()).toBe(true);
  const filtered = (await matches.json()) as Schemas["MapList"];
  expect(filtered.total).toBeGreaterThan(0);

  await page.goto("/maps");
  await page
    .getByRole("searchbox", {
      name: "Search maps, WR holders, or enter a SteamID",
      exact: true,
    })
    .fill(holder!);
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === holder);
  const cards = page.locator("[data-map]");
  await expect(cards).toHaveCount(filtered.maps.length);
  expect(
    await cards.evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-map")),
    ),
  ).toEqual(filtered.maps.map((map) => map.name));
});
