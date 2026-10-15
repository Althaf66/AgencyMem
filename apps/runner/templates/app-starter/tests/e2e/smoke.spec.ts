import { expect, test } from "@playwright/test";
import { resetApp } from "./fixtures";

test("the shell renders the clinic name, the nav and the home page", async ({ page, request }) => {
  await resetApp(request, { now: "2026-11-02T09:00:00+05:30" });
  await page.goto("/#/");
  await expect(page.getByTestId("app-clinic-name")).toHaveText("Clinic name");
  await expect(page.getByTestId("nav-doctors")).toBeVisible();
  await expect(page.getByTestId("home-page")).toBeVisible();
  await page.getByTestId("nav-admin").click();
  await expect(page.getByTestId("admin-page")).toBeVisible();
});
