import { expect, test, type ConsoleMessage } from "@playwright/test";

const CANVAS_URL = process.env.FMD_CANVAS_TEST_URL || "http://127.0.0.1:5288/canvas";

const IGNORABLE_CONSOLE_PATTERNS = [
  /Download the React DevTools/i,
  /Failed to load resource/i,
  /ERR_/i,
];

function isIgnorableConsole(text: string): boolean {
  return IGNORABLE_CONSOLE_PATTERNS.some((pattern) => pattern.test(text));
}

test.describe("FMD Canvas Builder", () => {
  test("renders, edits a node, and compiles a dry-run plan", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (message: ConsoleMessage) => {
      if (message.type() === "error" && !isIgnorableConsole(message.text())) {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(`[pageerror] ${error.message}`);
    });

    await page.goto(CANVAS_URL, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /Build the pipeline path/i })).toBeVisible();
    await expect(page.getByRole("link", { name: /Canvas Builder/i })).toBeVisible();
    await expect(page.getByText("Node Palette")).toHaveCount(0);

    await page.getByRole("button", { name: /Add nodes/i }).click();
    await expect(page.getByRole("heading", { name: "Node Palette" })).toBeVisible();
    await page.getByRole("button", { name: /Add nodes/i }).click();
    await expect(page.getByText("Node Palette")).toHaveCount(0);

    const bronzeNode = page.locator(".fmd-canvas-node").filter({ hasText: "Bronze Delta" });
    await expect(bronzeNode).toHaveCount(1);
    await bronzeNode.click();

    await expect(page.getByRole("heading", { name: "Node Inspector" })).toBeVisible();
    await page.getByLabel("LandingzoneEntityId scope").fill("599, 600");
    await page.getByRole("button", { name: /Dry run/i }).click();

    await expect(page.getByText("Dry run compiled successfully.")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("heading", { name: "Validation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Compiled Run Plan" })).toBeVisible();
    await expect(page.getByText(/\d+ entities across landing, bronze, silver/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Start Pipeline/i })).toBeEnabled();

    expect(consoleErrors).toEqual([]);
  });
});
