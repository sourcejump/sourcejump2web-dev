// The recovered mobile menu keeps rich section rows and native keyboard/dismissal behavior.
import { expect, test } from "@playwright/test";

for (const width of [320, 390, 768, 900]) {
  test(`mobile sections at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 740 });
    await page.goto("/dev/ui");
    const trigger = page.getByRole("button", { name: "Sections", exact: true });
    const menu = page.getByRole("menu");
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(
      menu.getByText("Every map, with its tier and world record"),
    ).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(11);
    await expect(
      menu.getByRole("menuitem", { name: "Discord", exact: true }),
    ).toHaveAttribute("href", "https://discord.gg/RYP5G4tuwX");
    const headerBox = (await page.getByRole("banner").boundingBox())!;
    expect((await menu.boundingBox())!.y).toBe(headerBox.y + headerBox.height);
    expect(
      await menu.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    await page.keyboard.press("End");
    await expect(
      menu.getByRole("menuitem", { name: "Instagram", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await menu.getByRole("menuitem", { name: "Ruleset", exact: true }).click();
    await expect(page).toHaveURL(/\/ruleset$/);
    await expect(menu).toBeHidden();
    await trigger.click();
    await page.mouse.click(width - 5, 730);
    await expect(menu).toBeHidden();
  });
}

test("desktop keeps the current header", async ({ page }) => {
  await page.goto("/dev/ui");
  await expect(
    page.getByRole("button", { name: "Sections", exact: true }),
  ).toBeHidden();
  await expect(
    page
      .getByRole("navigation", { name: "Main", exact: true })
      .getByRole("link", { name: "Records", exact: true }),
  ).toBeVisible();
});
