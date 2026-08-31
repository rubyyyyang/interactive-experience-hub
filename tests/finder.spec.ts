/**
 * finder.spec.ts
 * Minimal browser verification for Arcade Finder /dev deployment
 * Run with: npm run test:e2e
 *
 * Uses saved auth state from one-time setup.
 * Tests are read-only and do not mutate production data.
 */

import { test, expect } from '@playwright/test';

test.describe('Arcade Finder - Browser Verification', () => {
  test('Finder app smoke test', async ({ page, baseURL }) => {
    // Capture console and page errors
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];

    page.on('console', msg => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    page.on('pageerror', err => {
      pageErrors.push(err.message);
    });

    // Navigate to app
    await page.goto(baseURL!);

    // Verify authenticated (correct title)
    await expect(page).toHaveTitle(/The Interact Hub/i, { timeout: 15000 });

    // Wait for app to load
    await page.waitForLoadState('networkidle', { timeout: 30000 });

    // Apps Script renders in nested iframes
    // Frame structure: page -> sandboxFrame -> userHtmlFrame (actual content)
    await page.locator('iframe').last().waitFor({ timeout: 10000 });

    const frames = page.frames();
    // Find the userHtmlFrame by name (more reliable than URL matching)
    const contentFrame = frames.find(f => f.name() === 'userHtmlFrame');

    if (!contentFrame) {
      throw new Error('App content iframe (userHtmlFrame) not found');
    }

    // Verify main heading
    await expect(contentFrame.locator('h1').filter({ hasText: 'The Interact Hub' }))
      .toBeVisible({ timeout: 15000 });

    // Verify global search is visible
    await expect(contentFrame.locator('#globalSearch'))
      .toBeVisible({ timeout: 15000 });

    // Verify initial results/data loaded (not stuck on "Loading...")
    const summaryText = contentFrame.locator('#summaryText');
    await expect(summaryText).not.toContainText('Loading...', { timeout: 30000 });
    await expect(summaryText).toContainText(/\d+/, { timeout: 10000 });

    // Verify at least one result card rendered
    const firstCard = contentFrame.locator('#results .card').first();
    await expect(firstCard).toBeVisible({ timeout: 15000 });

    // Verify no console errors
    expect(consoleErrors).toHaveLength(0);

    // Verify no uncaught page errors
    expect(pageErrors).toHaveLength(0);
  });

  test('Core discovery search flow', async ({ page, baseURL }) => {
    await page.goto(baseURL!);

    // Wait for iframe
    await page.locator('iframe').last().waitFor({ timeout: 10000 });

    const frames = page.frames();
    const contentFrame = frames.find(f => f.name() === 'userHtmlFrame');

    if (!contentFrame) {
      throw new Error('App content iframe (userHtmlFrame) not found');
    }

    // Wait for initial load
    const summaryText = contentFrame.locator('#summaryText');
    await expect(summaryText).not.toContainText('Loading...', { timeout: 30000 });

    // Capture initial summary for comparison
    const initialSummary = await summaryText.textContent();

    // Type search query
    const searchInput = contentFrame.locator('#globalSearch');
    await searchInput.fill('OpenShift');
    await expect(searchInput).toHaveValue('OpenShift');

    // Apply search
    const applyButton = contentFrame.locator('#applySearchBtn');
    await applyButton.click();

    // Wait for search to process (summary should update or stay valid)
    await page.waitForTimeout(2000);
    await expect(summaryText).toContainText(/\d+/, { timeout: 15000 });

    // Verify results still present
    const resultsAfterSearch = contentFrame.locator('#results .card');
    await expect(resultsAfterSearch.first()).toBeVisible({ timeout: 15000 });

    // Reset search
    const resetButton = contentFrame.locator('button', { hasText: 'Reset' });
    await resetButton.click();

    // Verify search cleared
    await expect(searchInput).toHaveValue('');

    // Verify normal results state returns
    await page.waitForTimeout(1000);
    await expect(summaryText).toContainText(/\d+/, { timeout: 15000 });
    await expect(resultsAfterSearch.first()).toBeVisible({ timeout: 15000 });
  });
});
