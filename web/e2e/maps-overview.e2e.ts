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
      lists: Array.from(element.querySelectorAll("section > div")).map(
        (group) =>
          Math.abs(center(group.getBoundingClientRect()) - center(panel)),
      ),
    };
  });
  expect(geometry.left).toBeLessThan(1);
  expect(geometry.right).toBeLessThan(1);
  expect(geometry.graph).toBeLessThan(1);
  expect(geometry.legend).toBeLessThan(1);
  for (const offset of geometry.lists) expect(offset).toBeLessThan(1);
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
  const layout = await list.evaluate((element) => {
    const rows = Array.from(element.querySelectorAll("a"));
    return {
      width: element.getBoundingClientRect().width,
      details: rows.map(
        (row) => row.lastElementChild!.getBoundingClientRect().left,
      ),
      gaps: rows.map((row) => {
        const name = row.children[1]!;
        const detail = row.children[2]!;
        return (
          detail.getBoundingClientRect().left -
          name.getBoundingClientRect().right
        );
      }),
    };
  });
  expect(layout.width).toBeLessThan(400);
  for (const left of layout.details)
    expect(Math.abs(left - layout.details[0]!)).toBeLessThan(1);
  for (const gap of layout.gaps) expect(gap).toBe(8);
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
