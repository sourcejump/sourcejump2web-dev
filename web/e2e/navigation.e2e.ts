// Moving between pages swaps the content in place: no full page load, and the header stays.
import { expect, test } from "@playwright/test";

test("following a link doesn't reload the page", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => {
    (window as { stillHere?: boolean }).stillHere = true;
  });
  await page
    .getByRole("banner")
    .getByRole("link", { name: "Maps", exact: true })
    .click();
  await expect(page).toHaveURL(/\/maps$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Maps");
  expect(
    await page.evaluate(() => (window as { stillHere?: boolean }).stillHere),
  ).toBe(true);
});

// Needs the development seed (`just db`): bhop_forest has runs on several styles and a bonus.
test("styles switch in place, and a run opens in a dialog without leaving the page", async ({
  page,
}) => {
  await page.goto("/maps/bhop_forest");
  await page.evaluate(() => {
    (window as { stillHere?: boolean }).stillHere = true;
  });
  const times = page.getByRole("table").getByRole("link", {
    name: /^\d+:?\d*\.\d{3}$/,
  });
  const dialog = page.getByRole("dialog");

  await page.getByRole("button", { name: /^Style/ }).click();
  await page
    .getByRole("menuitemradio", { name: "Sideways", exact: true })
    .click();
  await expect(page).toHaveURL(/style=sw/);
  await expect(page.getByRole("button", { name: /^Style/ })).toHaveText(
    /Sideways/,
  );

  await times.first().click();
  await expect(page).toHaveURL(/run=\d+/);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page).not.toHaveURL(/run=/);
  await expect(page).toHaveURL(/style=sw/);

  // Following a link out of the dialog closes it, and the new page keeps its own Escape key.
  await times.first().click();
  // The player's link, not the footer's "Run page", which shows before the run has loaded.
  await dialog.locator('a[href^="/players/"]').click();
  await expect(page).toHaveURL(/\/players\/\d+$/);
  await expect(dialog).toBeHidden();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(/\/players\/\d+$/);
  expect(
    await page.evaluate(() => (window as { stillHere?: boolean }).stillHere),
  ).toBe(true);
});
