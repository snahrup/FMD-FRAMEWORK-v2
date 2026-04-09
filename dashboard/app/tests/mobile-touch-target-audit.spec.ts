// Run with: npm run test:mobile-touch-audit
// Audits every static route from src/App.tsx at a 375px viewport.

import { expect, test } from "@playwright/test";
import { loadStaticAppRoutes, navigateForMobileAudit } from "./helpers/mobileAudit";

const routes = loadStaticAppRoutes();

test.describe("Mobile touch target audit", () => {
  for (const route of routes) {
    test(`${route.name} meets the 44x44 minimum target size`, async ({ page }) => {
      const fatalErrors = await navigateForMobileAudit(page, route.path);

      const violations = await page.locator('button, a, input, select, [role="button"]').evaluateAll((elements) => {
        return elements
          .map((element) => {
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            const isHidden =
              style.display === "none" ||
              style.visibility === "hidden" ||
              style.opacity === "0" ||
              rect.width === 0 ||
              rect.height === 0;

            if (isHidden) return null;

            const text = (htmlElement.innerText || htmlElement.getAttribute("aria-label") || htmlElement.getAttribute("title") || "")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 80);

            if (rect.width >= 44 && rect.height >= 44) return null;

            return {
              tag: htmlElement.tagName.toLowerCase(),
              text: text || "(unlabeled)",
              width: Number(rect.width.toFixed(2)),
              height: Number(rect.height.toFixed(2)),
            };
          })
          .filter(Boolean);
      });

      console.log(`[mobile-touch-target-audit] ${route.path}: ${violations.length} violation(s)`);
      if (fatalErrors.length > 0) {
        console.log(`[mobile-touch-target-audit] ${route.path}: ${fatalErrors.length} non-network error(s)`);
      }

      expect(
        fatalErrors,
        `${route.path} had fatal render errors: ${fatalErrors.join(" | ")}`
      ).toHaveLength(0);

      expect(
        violations,
        `${route.path} has undersized touch targets: ${JSON.stringify(violations, null, 2)}`
      ).toHaveLength(0);
    });
  }
});
