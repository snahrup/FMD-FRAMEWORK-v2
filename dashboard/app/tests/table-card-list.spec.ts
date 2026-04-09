import { expect, test } from "@playwright/test";

test.describe("TableCardList fixture", () => {
  test("renders cards, stat chips, and controlled expansion", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/__test/table-card-list", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "TableCardList fixture" })).toBeVisible();
    await expect(page.getByTestId("table-card-mes-orders")).toBeVisible();
    await expect(page.getByTestId("table-card-m3-items")).toBeVisible();
    await expect(page.getByTestId("table-card-mes-orders-stat-Status")).toContainText("Ready");
    await expect(page.getByTestId("table-card-m3-items-stat-Errors")).toContainText("3");

    const expandButtons = page.getByRole("button", { name: /expand row details|collapse row details/i });
    await expect(expandButtons).toHaveCount(2);

    await expandButtons.nth(0).click();
    await expect(page.getByTestId("table-card-expanded-mes-orders")).toContainText("incremental refresh");

    await expandButtons.nth(1).click();
    await expect(page.getByTestId("table-card-expanded-m3-items")).toContainText("watermark advancement");
    await expect(page.getByTestId("table-card-expanded-mes-orders")).toHaveCount(0);
  });
});
