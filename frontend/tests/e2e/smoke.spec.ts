import { expect, test } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

test("administrator can sign in and reach the role-aware dashboard", async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, "Provide disposable staging administrator credentials");

  await page.goto("/");
  await page.getByLabel("Email Address").fill(adminEmail!);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword!);
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Stok & kontrol", exact: true }).click();
  await expect(page.getByRole("button", { name: "Audit", exact: true })).toBeVisible();
  await expect(page.getByText("System Administrator", { exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("login form reports invalid credentials without exposing a runtime overlay", async ({ page }) => {
  test.skip(!adminEmail, "Provide a disposable staging administrator email");

  await page.goto("/");
  await page.getByLabel("Email Address").fill(adminEmail!);
  await page.getByLabel("Password", { exact: true }).fill("invalid-password-for-e2e");
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
});
