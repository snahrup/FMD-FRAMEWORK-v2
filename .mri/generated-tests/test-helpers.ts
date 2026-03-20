import { Page, expect, Locator } from '@playwright/test';

/**
 * Shared test utilities for MRI-generated tests.
 */

/** Collect console errors during a test. Returns the errors array for assertions. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Filter known noise
      if (!text.includes('favicon') && !text.includes('extension') && !text.includes('DevTools')) {
        errors.push(text);
      }
    }
  });
  return errors;
}

/** Assert that a value looks like a real displayed number (not undefined/NaN/null/empty). */
export function expectRealValue(text: string | null, context: string) {
  expect(text, `${context} should not be null`).not.toBeNull();
  const trimmed = (text || '').trim();
  expect(trimmed, `${context} should not be empty`).not.toBe('');
  expect(trimmed, `${context} should not be undefined`).not.toBe('undefined');
  expect(trimmed, `${context} should not be NaN`).not.toBe('NaN');
  expect(trimmed, `${context} should not be null text`).not.toBe('null');
  expect(trimmed, `${context} should not be a dash placeholder`).not.toBe('\u2014');
}

/** Parse a display number like "1,666" or "42.5%" into a numeric value. */
export function parseDisplayNumber(text: string): number {
  const cleaned = text.replace(/[,%$\s]/g, '');
  return parseFloat(cleaned);
}

/** Wait for network idle with a reasonable timeout. */
export async function waitForStable(page: Page) {
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  // Extra settle time for React re-renders
  await page.waitForTimeout(300);
}

/** Take a labeled screenshot. */
export async function screenshot(page: Page, name: string) {
  await page.screenshot({
    path: `screenshots/${name}.png`,
    fullPage: true,
  });
}

/** Check that no elements visually overflow their container at a given viewport. */
export async function assertNoOverflow(page: Page) {
  const overflowing = await page.evaluate(() => {
    const body = document.body;
    const docWidth = document.documentElement.clientWidth;
    const issues: string[] = [];
    document.querySelectorAll('*').forEach(el => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      if (rect.right > docWidth + 2 || rect.left < -2) {
        const tag = (el as HTMLElement).tagName.toLowerCase();
        const cls = (el as HTMLElement).className?.toString().slice(0, 50) || '';
        if (!['script', 'style', 'link', 'meta', 'head'].includes(tag)) {
          issues.push(`${tag}.${cls} overflows (left:${Math.round(rect.left)}, right:${Math.round(rect.right)}, docWidth:${docWidth})`);
        }
      }
    });
    return issues.slice(0, 5); // cap at 5 to avoid noise
  });
  return overflowing;
}

export const ADVERSARIAL_INPUTS = {
  xss: '<script>alert("xss")</script>',
  sqlInjection: "'; DROP TABLE users; --",
  unicode: '\u00e9\u00e0\u00fc\u00f1 \u4e16\u754c \ud83d\ude80\ud83c\udf1f\ud83d\udca5',
  longString: 'A'.repeat(1000),
  specialChars: '!@#$%^&*()_+-=[]{}|;\':",./<>?',
  nullString: 'null',
  undefinedString: 'undefined',
  emptyAfterTrim: '   ',
  pathTraversal: '../../etc/passwd',
  newlines: 'line1\nline2\rline3',
};

export const BUTTON_DENYLIST = /delete|remove|logout|sign\s*out|log\s*out|pay|submit\s*payment|reset|clear\s*all|drop|destroy|nuke|erase|purge|deactivate|disable|terminate|revoke|force/i;
