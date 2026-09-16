/**
 * Targeted Verification: Retired Email Templates
 *
 * Verifies:
 * 1. Interactive Demo CONTENT_RETIRED dispatches email with simplified body and CTAs
 * 2. Video Demo CONTENT_RETIRED dispatches email with simplified body and CTAs
 * 3. HTML escaping prevents injection in displayName and title
 */

const realConsole = console;

// Mock Apps Script globals
let emailsSent = [];
global.GmailApp = {
  sendEmail: (to, subject, body, opts) => {
    emailsSent.push({ to, subject, body, htmlBody: opts.htmlBody, opts });
  }
};

global.Logger = { log: () => {} };

const mockSpreadsheet = {
  sheets: {
    'Request_Master': {
      data: [
        ['Number', 'Status', 'Final Demo Title', 'Creator Name', 'Creator Email', 'Origin Type', 'Creation Link', 'Drupal Page URL', 'Creator Submission Email Sent?', 'Creator Published Email Sent?', 'Creator Retired Email Sent?'],
        ['1', 'Retired', 'Test <script>alert("xss")</script> Demo', 'Alice & Bob', 'alice@redhat.com', 'Creator Intake', 'https://arcade.example.com/create/1?test=a&b=2', 'https://redhat.com/demo/test', '', '', '']
      ]
    },
    'YouTube_Responses': {
      data: [
        ['Number', 'Status', 'Video Title', 'YouTube URL', 'Creator Name', 'Creator Email', 'Origin Type', 'Creator Submission Email Sent?', 'Creator Retired Email Sent?'],
        ['1', 'Retired', 'Test "quotes" & <tags>', 'https://youtube.com/watch?v=abc&t=123', 'Dan O\'Malley', 'dan@redhat.com', 'Intake Form', '', '']
      ]
    }
  }
};

function getMockSheet(sheetName) {
  const sheetData = mockSpreadsheet.sheets[sheetName];
  if (!sheetData) return null;

  return {
    getName: () => sheetName,
    getLastRow: () => sheetData.data.length,
    getLastColumn: () => sheetData.data[0].length,
    getRange: function(row, col, numRows, numCols) {
      if (numRows && numCols) {
        const values = [];
        for (let i = 0; i < numRows; i++) {
          values.push(sheetData.data[row - 1 + i] || []);
        }
        return { getValues: () => values };
      }
      return {
        getValue: () => sheetData.data[row - 1]?.[col - 1] || '',
        setValue: (val) => { sheetData.data[row - 1][col - 1] = val; }
      };
    }
  };
}

global.SpreadsheetApp = {
  openById: (id) => ({
    getSheetByName: (name) => getMockSheet(name)
  })
};

global.getConfigProperty = (key) => {
  if (key === 'MASTER_SHEET_ID') return 'mock-spreadsheet-id';
  return null;
};

global.safeGetByName = (rowData, headerMap, colName) => {
  const idx = headerMap[colName];
  return idx !== undefined ? rowData[idx] : '';
};

global.logError = () => {};

// Load implementation
const LIFECYCLE_EVENTS = {
  SUBMISSION_RECEIVED: 'SUBMISSION_RECEIVED',
  CONTENT_PUBLISHED: 'CONTENT_PUBLISHED',
  CONTENT_RETIRED: 'CONTENT_RETIRED'
};

const ENHANCED_CONFIG = {
  STATUS: {
    DEMO_RECEIVED: 'Submitted for review',
    DEMO_PUBLISHED: 'Published',
    DEMO_RETIRED: 'Retired'
  },
  ORIGIN_TYPES: {
    CREATOR_ONLY: 'Creator Intake'
  },
  COLUMNS: {
    NUMBER: 'Number',
    FINAL_DEMO_TITLE: 'Final Demo Title',
    CREATOR_NAME: 'Creator Name',
    CREATOR_EMAIL: 'Creator Email'
  }
};

const STATUS_TRACKER_URL = 'https://script.google.com/a/redhat.com/macros/s/AKfycbzh7a4vsJ0TECMRUFqAazGP8bCQkJuoRv0bhIJlBFHEWj0a4kposd5uKRABmz4QOYej/exec?page=status';
const INTERACT_HUB_URL = 'https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec';
const SUBMIT_NEW_DEMO_URL = 'https://script.google.com/a/macros/redhat.com/s/AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg/exec';
const TEAM_EMAIL = 'interactive-experiences@redhat.com';

function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildArcadeLifecycleContext(context, status) {
  const { rowNumber, rowData, headerMap, originType } = context;
  let event;
  if (status === ENHANCED_CONFIG.STATUS.DEMO_RETIRED) {
    event = LIFECYCLE_EVENTS.CONTENT_RETIRED;
  } else {
    return null;
  }

  const isCreatorIntake = originType === ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY;

  return {
    assetType: 'ARCADE',
    sourceRepository: 'Request_Master',
    number: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER) || '').trim(),
    event,
    title: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || '').trim(),
    creatorName: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME) || '').trim(),
    creatorEmail: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_EMAIL) || '').trim(),
    originType,
    isCreatorIntake,
    currentStatus: status,
    creationLink: String(safeGetByName(rowData, headerMap, 'Creation Link') || '').trim(),
    drupalPageUrl: String(safeGetByName(rowData, headerMap, 'Drupal Page URL') || '').trim()
  };
}

function buildYouTubeRetiredContext(rowData, headerMap, number) {
  const headers = Array.isArray(headerMap) ? headerMap : Object.keys(headerMap);
  const getByName = (name) => {
    const idx = Array.isArray(headerMap) ? headers.indexOf(name) : headerMap[name];
    return idx !== undefined && idx !== null && idx >= 0 ? String(rowData[idx] || '').trim() : '';
  };

  return {
    assetType: 'YOUTUBE',
    sourceRepository: 'YouTube_Responses',
    number: String(number || '').trim(),
    event: LIFECYCLE_EVENTS.CONTENT_RETIRED,
    title: getByName('Video Title') || getByName('Final Demo Title') || '',
    creatorName: getByName('Creator Name') || '',
    creatorEmail: getByName('Creator Email') || '',
    originType: getByName('Origin Type') || '',
    isCreatorIntake: getByName('Origin Type') === 'Intake Form',
    currentStatus: 'Retired',
    youtubeUrl: getByName('YouTube URL') || ''
  };
}

function sendRetiredEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];
  const assetType = context.assetType;

  if (assetType === 'YOUTUBE') {
    const subject = `Video Demo retired: ${title}`;
    const htmlBody = `<p>Hi ${escapeHtml_(displayName)},</p>` +
      `<p>Your Video Demo, "${escapeHtml_(title)}", has been retired.</p>` +
      (context.youtubeUrl ? `<p><strong><a href="${escapeHtml_(context.youtubeUrl)}">View video</a></strong></p>` : '') +
      `<p>Questions or changes? <a href="mailto:interactive-experiences@redhat.com">Contact the Interactive Experiences Team</a>.</p>` +
      `<p><strong><a href="${INTERACT_HUB_URL}">Explore the Interact Hub</a></strong> · <strong><a href="${STATUS_TRACKER_URL}">Check your submissions</a></strong> · <strong><a href="${SUBMIT_NEW_DEMO_URL}">Submit new content</a></strong></p>` +
      `<p>Thanks,<br>Interactive Experiences Team</p>`;

    const plainBody = `Hi ${displayName},\n\n` +
      `Your Video Demo, "${title}", has been retired.\n\n` +
      (context.youtubeUrl ? `**View video**\n${context.youtubeUrl}\n\n` : '') +
      `Questions or changes? Contact the Interactive Experiences Team: interactive-experiences@redhat.com\n\n` +
      `**Explore the Interact Hub** · **Check your submissions** · **Submit new content**\n\n` +
      `${INTERACT_HUB_URL}\n\n${STATUS_TRACKER_URL}\n\n${SUBMIT_NEW_DEMO_URL}\n\n` +
      `Thanks,\nInteractive Experiences Team`;

    GmailApp.sendEmail(creatorEmail, subject, plainBody, {
      name: 'Interactive Experiences Team',
      noReply: true,
      htmlBody: htmlBody
    });
  } else {
    const subject = `Interactive Demo retired: ${title}`;
    const htmlBody = `<p>Hi ${escapeHtml_(displayName)},</p>` +
      `<p>Your Interactive Demo, "${escapeHtml_(title)}", has been retired.</p>` +
      (context.productionLink ? `<p><strong><a href="${escapeHtml_(context.productionLink)}">View submission details</a></strong></p>` : '') +
      `<p>Questions or changes? <a href="mailto:interactive-experiences@redhat.com">Contact the Interactive Experiences Team</a>.</p>` +
      `<p><strong><a href="${INTERACT_HUB_URL}">Explore the Interact Hub</a></strong> · <strong><a href="${STATUS_TRACKER_URL}">Check your submissions</a></strong> · <strong><a href="${SUBMIT_NEW_DEMO_URL}">Submit new content</a></strong></p>` +
      `<p>Thanks,<br>Interactive Experiences Team</p>`;

    const plainBody = `Hi ${displayName},\n\n` +
      `Your Interactive Demo, "${title}", has been retired.\n\n` +
      (context.productionLink ? `**View submission details**\n${context.productionLink}\n\n` : '') +
      `Questions or changes? Contact the Interactive Experiences Team: interactive-experiences@redhat.com\n\n` +
      `**Explore the Interact Hub** · **Check your submissions** · **Submit new content**\n\n` +
      `${INTERACT_HUB_URL}\n\n${STATUS_TRACKER_URL}\n\n${SUBMIT_NEW_DEMO_URL}\n\n` +
      `Thanks,\nInteractive Experiences Team`;

    GmailApp.sendEmail(creatorEmail, subject, plainBody, {
      name: 'Interactive Experiences Team',
      noReply: true,
      htmlBody: htmlBody
    });
  }
}

function resolveSourceRecord(sourceRepository, number) {
  const ss = SpreadsheetApp.openById(getConfigProperty('MASTER_SHEET_ID'));
  const sheet = ss.getSheetByName(sourceRepository);
  if (!sheet) return null;

  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return null;

  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h || '').trim());
  const numberColIndex = headers.indexOf('Number');
  if (numberColIndex === -1) return null;

  const numberColumn = sheet.getRange(2, numberColIndex + 1, lastRow - 1, 1).getValues();
  let targetRowIndex = null;

  for (let i = 0; i < numberColumn.length; i++) {
    if (String(numberColumn[i][0] || '').trim() === String(number).trim()) {
      targetRowIndex = i + 2;
      break;
    }
  }

  if (!targetRowIndex) return null;

  const rowData = sheet.getRange(targetRowIndex, 1, 1, lastCol).getValues()[0];
  const headerMap = {};
  headers.forEach((h, i) => { if (h) headerMap[h] = i; });

  return { rowIndex: targetRowIndex, rowData, headerMap, sheet };
}

function getCreatorEmailSentColumn(assetType, event) {
  const key = `${assetType}_${event}`;
  const mapping = {
    'ARCADE_CONTENT_RETIRED': 'Creator Retired Email Sent?',
    'YOUTUBE_CONTENT_RETIRED': 'Creator Retired Email Sent?'
  };
  return mapping[key] || null;
}

function dispatchCreatorLifecycleNotification(context) {
  if (!context.isCreatorIntake) return;
  if (!context.title) return;

  const record = resolveSourceRecord(context.sourceRepository, context.number);
  if (!record) return;

  const creatorEmail = context.creatorEmail || String(safeGetByName(record.rowData, record.headerMap, 'Creator Email') || '').trim();
  if (!creatorEmail) return;

  const sentColumn = getCreatorEmailSentColumn(context.assetType, context.event);
  if (!sentColumn) return;

  const sentColIndex = record.headerMap[sentColumn];
  if (sentColIndex === undefined) return;

  const alreadySent = String(record.rowData[sentColIndex] || '').trim().toLowerCase();
  if (alreadySent === 'yes' || alreadySent === 'true' || alreadySent === 'sent' || alreadySent === '✅') {
    return;
  }

  let emailSent = false;
  try {
    const creatorName = context.creatorName || creatorEmail.split('@')[0];
    if (context.event === LIFECYCLE_EVENTS.CONTENT_RETIRED) {
      sendRetiredEmail_(creatorEmail, creatorName, context.title, context);
    }
    emailSent = true;
  } catch (emailError) {
    return;
  }

  if (emailSent) {
    record.sheet.getRange(record.rowIndex, sentColIndex + 1).setValue('✅');
  }
}

// Test suite
function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      emailsSent = [];
      mockSpreadsheet.sheets['Request_Master'].data[1][10] = '';
      mockSpreadsheet.sheets['YouTube_Responses'].data[1][8] = '';
      fn();
      realConsole.log(`✅ ${name}`);
      passed++;
    } catch (error) {
      realConsole.error(`❌ ${name}: ${error.message}`);
      failed++;
    }
  }

  function assertEqual(actual, expected, message) {
    if (actual !== expected) {
      throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
  }

  function assertIncludes(text, substring, message) {
    if (!text.includes(substring)) {
      throw new Error(`${message}: expected to include "${substring}"`);
    }
  }

  // Test 1: Interactive Demo CONTENT_RETIRED dispatches email
  test("Interactive Demo CONTENT_RETIRED dispatches email", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = buildArcadeLifecycleContext({ rowNumber: 2, rowData, headerMap, originType: 'Creator Intake' }, 'Retired');

    dispatchCreatorLifecycleNotification(context);

    assertEqual(emailsSent.length, 1, "Should send one email");
    assertEqual(emailsSent[0].to, 'alice@redhat.com', "Email to correct recipient");
  });

  // Test 2: Interactive Demo Retired has simplified body with CTAs only
  test("Interactive Demo Retired has simplified body with CTAs", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = buildArcadeLifecycleContext({ rowNumber: 2, rowData, headerMap, originType: 'Creator Intake' }, 'Retired');

    dispatchCreatorLifecycleNotification(context);

    const email = emailsSent[0];
    assertEqual(email.htmlBody.includes('https://redhat.com/demo/test'), false, "Should NOT include drupalPageUrl");
    assertEqual(email.htmlBody.includes('https://arcade.example.com/create/1'), false, "Should NOT include creationLink");
    assertEqual(email.htmlBody.includes(TEAM_EMAIL), false, "Should NOT include team email");
    assertIncludes(email.htmlBody, INTERACT_HUB_URL, "Should include Interact Hub CTA");
    assertIncludes(email.htmlBody, SUBMIT_NEW_DEMO_URL, "Should include Submit new demo CTA");
  });

  // Test 3: Interactive Demo Retired marks sent flag
  test("Interactive Demo Retired marks sent flag after success", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = buildArcadeLifecycleContext({ rowNumber: 2, rowData, headerMap, originType: 'Creator Intake' }, 'Retired');

    dispatchCreatorLifecycleNotification(context);

    const sentFlag = mockSpreadsheet.sheets['Request_Master'].data[1][10];
    assertEqual(sentFlag, '✅', "Should mark Creator Retired Email Sent?");
  });

  // Test 4: YouTube CONTENT_RETIRED dispatches email
  test("YouTube CONTENT_RETIRED dispatches email", () => {
    const sheet = getMockSheet('YouTube_Responses');
    const headers = sheet.getRange(1, 1, 1, 9).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 9).getValues()[0];
    const context = buildYouTubeRetiredContext(rowData, headerMap, '1');

    dispatchCreatorLifecycleNotification(context);

    assertEqual(emailsSent.length, 1, "Should send one email");
    assertEqual(emailsSent[0].to, 'dan@redhat.com', "Email to correct recipient");
  });

  // Test 5: Video Demo Retired has simplified body with CTAs only
  test("Video Demo Retired has simplified body with CTAs", () => {
    const sheet = getMockSheet('YouTube_Responses');
    const headers = sheet.getRange(1, 1, 1, 9).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 9).getValues()[0];
    const context = buildYouTubeRetiredContext(rowData, headerMap, '1');

    dispatchCreatorLifecycleNotification(context);

    const email = emailsSent[0];
    assertEqual(email.htmlBody.includes('https://youtube.com/watch?v=abc'), false, "Should NOT include YouTube URL");
    assertEqual(email.htmlBody.includes(TEAM_EMAIL), false, "Should NOT include team email");
    assertIncludes(email.htmlBody, INTERACT_HUB_URL, "Should include Interact Hub CTA");
    assertIncludes(email.htmlBody, SUBMIT_NEW_DEMO_URL, "Should include Submit new demo CTA");
  });

  // Test 6: YouTube Retired marks sent flag
  test("YouTube Retired marks sent flag after success", () => {
    const sheet = getMockSheet('YouTube_Responses');
    const headers = sheet.getRange(1, 1, 1, 9).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 9).getValues()[0];
    const context = buildYouTubeRetiredContext(rowData, headerMap, '1');

    dispatchCreatorLifecycleNotification(context);

    const sentFlag = mockSpreadsheet.sheets['YouTube_Responses'].data[1][8];
    assertEqual(sentFlag, '✅', "Should mark Creator Retired Email Sent?");
  });

  // Test 7: HTML escaping prevents XSS in displayName
  test("HTML escaping prevents XSS in displayName", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = buildArcadeLifecycleContext({ rowNumber: 2, rowData, headerMap, originType: 'Creator Intake' }, 'Retired');

    dispatchCreatorLifecycleNotification(context);

    const email = emailsSent[0];
    assertIncludes(email.htmlBody, 'Alice &amp; Bob', "Should escape ampersand in displayName");
    assertEqual(email.htmlBody.includes('Alice & Bob'), false, "Should not contain unescaped ampersand");
  });

  // Test 8: HTML escaping prevents XSS in title
  test("HTML escaping prevents XSS in title", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = buildArcadeLifecycleContext({ rowNumber: 2, rowData, headerMap, originType: 'Creator Intake' }, 'Retired');

    dispatchCreatorLifecycleNotification(context);

    const email = emailsSent[0];
    assertIncludes(email.htmlBody, '&lt;script&gt;', "Should escape script tags in title");
    assertEqual(email.htmlBody.includes('<script>'), false, "Should not contain unescaped script tag");
  });

  // Test 9: Plain-text fallback remains readable
  test("Plain-text fallback remains readable", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = buildArcadeLifecycleContext({ rowNumber: 2, rowData, headerMap, originType: 'Creator Intake' }, 'Retired');

    dispatchCreatorLifecycleNotification(context);

    const email = emailsSent[0];
    assertIncludes(email.body, 'Alice & Bob', "Plain-text should contain original text");
    assertIncludes(email.body, INTERACT_HUB_URL, "Plain-text should include Interact Hub URL");
    assertIncludes(email.body, SUBMIT_NEW_DEMO_URL, "Plain-text should include Submit URL");
  });

  realConsole.log(`\n✅ ${passed} passed, ${failed > 0 ? '❌ ' + failed + ' failed' : 'all tests passed'}`);
  return failed === 0;
}

if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}
