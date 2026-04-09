import fs from "node:fs";
import path from "node:path";
import type { Page } from "@playwright/test";

const APP_TSX_PATH = path.resolve(__dirname, "../../src/App.tsx");

function prettifyRoute(routePath: string) {
  if (routePath === "/") return "root";
  return routePath
    .replace(/^\/+/, "")
    .replace(/[/:]+/g, " ")
    .trim();
}

export function loadStaticAppRoutes() {
  const source = fs.readFileSync(APP_TSX_PATH, "utf8");
  const matches = [...source.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
  const uniqueRoutes = [...new Set(matches)];

  return uniqueRoutes
    .filter((routePath) => routePath !== "*")
    .filter((routePath) => !routePath.includes("/:"))
    .filter((routePath) => !routePath.startsWith("/__test"))
    .map((routePath) => ({
      path: routePath,
      name: prettifyRoute(routePath),
    }));
}

export async function navigateForMobileAudit(page: Page, routePath: string) {
  const fatalErrors: string[] = [];
  const ignorablePatterns = [
    /Failed to fetch/i,
    /NetworkError/i,
    /ERR_CONNECTION_REFUSED/i,
    /net::ERR_/i,
    /ECONNREFUSED/i,
    /AbortError/i,
    /Load failed/i,
    /TypeError: Load failed/i,
    /AxiosError/i,
    /fetch.*failed/i,
    /404.*api/i,
    /500.*api/i,
    /ERR_EMPTY_RESPONSE/i,
    /Failed to load resource/i,
    /Internal Server Error/i,
  ];

  const isIgnorable = (text: string) => ignorablePatterns.some((pattern) => pattern.test(text));

  page.removeAllListeners("console");
  page.removeAllListeners("pageerror");

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (!isIgnorable(text)) fatalErrors.push(text);
  });

  page.on("pageerror", (error) => {
    const text = error.message || String(error);
    if (!isIgnorable(text)) fatalErrors.push(`[pageerror] ${text}`);
  });

  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto(routePath, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(2000);

  return fatalErrors;
}
