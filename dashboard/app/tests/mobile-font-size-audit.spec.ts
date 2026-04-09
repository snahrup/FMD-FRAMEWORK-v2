// Run with: npm run test:mobile-font-audit
// Audits every static route from src/App.tsx at a 375px viewport.

import { expect, test } from "@playwright/test";
import { loadStaticAppRoutes, navigateForMobileAudit } from "./helpers/mobileAudit";

const routes = loadStaticAppRoutes();

test.describe("Mobile font size audit", () => {
  for (const route of routes) {
    test(`${route.name} keeps visible text at 12px or larger`, async ({ page }) => {
      const fatalErrors = await navigateForMobileAudit(page, route.path);

      const violations = await page.locator("body *").evaluateAll((elements) => {
        const directText = (element: Element) =>
          Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

        return elements
          .map((element) => {
            const htmlElement = element as HTMLElement;
            const style = window.getComputedStyle(htmlElement);
            const rect = htmlElement.getBoundingClientRect();
            const text = directText(htmlElement);
            const fontSize = Number.parseFloat(style.fontSize);
            const isVisible =
              rect.width > 0 &&
              rect.height > 0 &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0";

            if (!isVisible || !text || Number.isNaN(fontSize) || fontSize >= 12) return null;

            return {
              tag: htmlElement.tagName.toLowerCase(),
              text: text.slice(0, 80),
              fontSize,
            };
          })
          .filter(Boolean);
      });

      console.log(`[mobile-font-size-audit] ${route.path}: ${violations.length} violation(s)`);
      if (fatalErrors.length > 0) {
        console.log(`[mobile-font-size-audit] ${route.path}: ${fatalErrors.length} non-network error(s)`);
      }

      expect(
        fatalErrors,
        `${route.path} had fatal render errors: ${fatalErrors.join(" | ")}`
      ).toHaveLength(0);

      expect(
        violations,
        `${route.path} has text under 12px: ${JSON.stringify(violations, null, 2)}`
      ).toHaveLength(0);
    });
  }
});
