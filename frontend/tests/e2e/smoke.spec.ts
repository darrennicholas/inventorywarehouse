import { expect, test } from "@playwright/test";

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

const roleAccounts = [
  { email: adminEmail, name: "System Administrator" },
  { email: process.env.E2E_WAREHOUSE_MANAGER_EMAIL ?? "warehouse.manager@stockflow.local", name: "Warehouse Manager" },
  { email: process.env.E2E_WAREHOUSE_STAFF_EMAIL ?? "warehouse.staff@stockflow.local", name: "Warehouse Staff" },
  { email: process.env.E2E_PROCUREMENT_EMAIL ?? "procurement@stockflow.local", name: "Procurement Officer" },
  { email: process.env.E2E_AUDITOR_EMAIL ?? "auditor@stockflow.local", name: "Inventory Auditor" },
];

test("administrator can sign in and reach the role-aware dashboard", async ({ page }) => {
  test.skip(!adminEmail || !adminPassword, "Provide disposable staging administrator credentials");

  await page.goto("/");
  await page.getByLabel("Email Address").fill(adminEmail!);
  await page.getByLabel("Password", { exact: true }).fill(adminPassword!);
  const dashboardSummary = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/operations/dashboard-summary",
  );
  await page.getByRole("button", { name: "Sign In" }).click();

  await expect(page.getByRole("heading", { name: "Dashboard", level: 1, exact: true })).toBeVisible();
  const summaryResponse = await dashboardSummary;
  expect(summaryResponse.status(), `Dashboard summary failed for administrator: ${await summaryResponse.text()}`).toBe(200);
  await page.getByRole("button", { name: "Stok & kontrol", exact: true }).click();
  await expect(page.getByRole("button", { name: "Audit", exact: true })).toBeVisible();
  await expect(page.getByText("System Administrator", { exact: true })).toBeVisible();
  await expect(page.locator("nextjs-portal")).toHaveCount(0);
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

for (const account of roleAccounts) {
  test(`${account.name} can sign in to the role-aware dashboard`, async ({ page }) => {
    test.skip(!account.email || !adminPassword, "Provide disposable staging role credentials");

    await page.goto("/");
    await page.getByLabel("Email Address").fill(account.email!);
    await page.getByLabel("Password", { exact: true }).fill(adminPassword!);
    const loginResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/auth/login",
    );
    const dashboardSummary = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/operations/dashboard-summary",
    );
    await page.getByRole("button", { name: "Sign In" }).click();

    const login = await loginResponse;
    expect(login.status(), `Login failed for ${account.name}: ${await login.text()}`).toBe(200);
    const summary = await dashboardSummary;
    expect(summary.status(), `Dashboard summary failed for ${account.name}: ${await summary.text()}`).toBe(200);
    await expect(page.getByRole("heading", { name: "Dashboard", level: 1, exact: true })).toBeVisible();
    // The profile button renders both the user's name and role; they match for warehouse roles.
    await expect(page.locator("header button[aria-expanded]").getByText(account.name, { exact: true }).first()).toBeVisible();
    await expect(page.locator("nextjs-portal")).toHaveCount(0);
  });
}
