import { test as setup, expect } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';

const authFile = 'playwright/.auth/user.json';
const APP_URL = 'https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec';

setup('authenticate', async ({ page }) => {
  // Extend timeout for manual authentication (5 minutes)
  setup.setTimeout(300000);

  // Check if auth file already exists
  if (fs.existsSync(authFile)) {
    console.log('\n===========================================');
    console.log('✅ AUTH STATE ALREADY EXISTS');
    console.log('===========================================');
    console.log('File:', authFile);
    console.log('\nSkipping authentication setup.');
    console.log('To re-authenticate, delete the file and run this again.');
    console.log('===========================================\n');
    return;
  }

  console.log('\n===========================================');
  console.log('🔐 MANUAL AUTHENTICATION REQUIRED');
  console.log('===========================================');
  console.log('A Playwright browser will open.');
  console.log('\nPlease complete these steps:');
  console.log('1. Sign in with your Red Hat Google account');
  console.log('2. Complete all Google and Red Hat SSO prompts');
  console.log('3. Click "Log in to SSO" and submit the form');
  console.log('4. Wait for "The Interact Hub" page to load');
  console.log('5. Auth state will be saved automatically');
  console.log('\nYou have 4 minutes to complete authentication.');
  console.log('===========================================\n');

  // Step 1: Navigate to the deployed web app
  console.log('Step 1: Navigating to app...');
  await page.goto(APP_URL);

  // Step 2: Wait for authentication to complete
  console.log('Step 2: Waiting for you to complete Red Hat SSO login...');
  console.log('After you submit the login form, the page will redirect.');
  console.log('Looking for the app to load (title: "Interact Hub")...\n');

  // Wait for the page title to change to "The Interact Hub" (or similar)
  // This indicates auth completed and app loaded
  await expect(page).toHaveTitle(/Interact Hub/, { timeout: 240000 });

  console.log('✓ Authentication completed, app title detected');

  // Wait for network to be idle (app JS loaded)
  await page.waitForLoadState('networkidle', { timeout: 30000 });

  // Step 3: Debug page structure
  console.log('\nStep 3: Inspecting page structure...');
  console.log('URL:', page.url());
  console.log('Title:', await page.title());

  const frames = page.frames();
  console.log('Number of frames:', frames.length);

  // Try to find the app - check main page first, then iframes
  let appFrame = page;
  let searchInput = page.locator('#globalSearch');

  // Check if #globalSearch exists in main page
  const mainPageHasSearch = await searchInput.count() > 0;

  if (!mainPageHasSearch && frames.length > 1) {
    // App might be in an iframe - check each frame
    console.log('App not in main page, checking iframes...');
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const frameSearch = frame.locator('#globalSearch');
      if (await frameSearch.count() > 0) {
        console.log(`✓ Found app in iframe ${i}: ${frame.url()}`);
        appFrame = frame;
        searchInput = frameSearch;
        break;
      }
    }
  } else if (mainPageHasSearch) {
    console.log('✓ Found app in main page');
  }

  // Step 4: Verify the app loaded
  console.log('\nStep 4: Verifying app loaded...');

  // Now try to find #globalSearch with a generous timeout
  try {
    // Try main page first
    await expect(searchInput).toBeVisible({ timeout: 45000 });
    console.log('✓ #globalSearch found and visible');
    console.log('\n✅ SUCCESS: The Interact Hub is accessible!');
    console.log('Final URL:', page.url());

  } catch (mainPageError) {
    // If not in main page, the app might be in an iframe (unlikely for Apps Script HtmlService)
    console.log('Could not find #globalSearch in main page');
    console.error('\n❌ VERIFICATION FAILED');
    console.error('===========================================');
    console.error('Current URL:', page.url());
    console.error('Current Title:', await page.title());
    console.error('\nDebugging info:');
    console.error('- Page has correct title but #globalSearch not found');
    console.error('- This might indicate the app is still loading');
    console.error('- Or the element ID changed');
    console.error('===========================================\n');

    throw new Error(`Could not find #globalSearch. URL: ${page.url()}`);
  }

  // Step 5: Save authentication state
  console.log('\nStep 5: Saving authentication state...');

  const authDir = path.dirname(authFile);
  if (!fs.existsSync(authDir)) {
    fs.mkdirSync(authDir, { recursive: true });
  }

  await page.context().storageState({ path: authFile });

  console.log('✅ Authentication state saved to:', authFile);
  console.log('\n===========================================');
  console.log('SETUP COMPLETE');
  console.log('===========================================');
  console.log('You can now run the E2E tests:');
  console.log('  npm run test:e2e');
  console.log('  npm run test:e2e:ui');
  console.log('  npm run test:e2e:headed');
  console.log('  npm run test:e2e:debug');
  console.log('\nTo re-authenticate later, delete:');
  console.log('  rm playwright/.auth/user.json');
  console.log('  npx playwright test tests/auth.setup.ts --headed --project=setup');
  console.log('===========================================\n');
});
