/**
 * Creator Lifecycle Email Notifications Verification Tests
 *
 * Verifies centralized creator lifecycle notification architecture:
 * - Asset adapters (Arcade, YouTube)
 * - Normalized lifecycle events (SUBMISSION_RECEIVED, CONTENT_PUBLISHED, CONTENT_RETIRED)
 * - Shared dispatcher
 * - Idempotency via sent columns
 * - Channel independence (Slack vs email)
 * - Repository resolver (sourceRepository + Number)
 */

// Mock Apps Script globals
let emailsSent = [];
global.GmailApp = {
  sendEmail: (to, subject, body, opts) => {
    emailsSent.push({ to, subject, body, htmlBody: opts.htmlBody, opts });
  }
};

global.Logger = {
  log: () => {}
};

const realConsole = console;

// Mock spreadsheet
const mockSpreadsheet = {
  sheets: {
    'Request_Master': {
      data: [
        ['Number', 'Status', 'Final Demo Title', 'Creator Name', 'Creator Email', 'Origin Type', 'Creation Link', 'Drupal Page URL', 'Creator Submission Email Sent?', 'Creator Published Email Sent?', 'Creator Retired Email Sent?'],
        ['1', 'Submitted for review', 'Test Arcade', 'Alice', 'alice@redhat.com', 'Creator Intake', 'https://arcade.example.com/create/1', 'https://redhat.com/demo/test-arcade', '', '', ''],
        ['2', 'Published', 'Published Arcade', 'Bob', 'bob@redhat.com', 'Creator Intake', 'https://arcade.example.com/create/2', 'https://redhat.com/demo/published-arcade', '✅', '', ''],
        ['3', 'Retired', 'Retired Arcade', 'Carol', 'carol@redhat.com', 'Request Form', '', '', '', '', '']
      ]
    },
    'YouTube_Responses': {
      data: [
        ['Number', 'Status', 'Video Title', 'YouTube URL', 'Creator Name', 'Creator Email', 'Origin Type', 'Creator Submission Email Sent?', 'Creator Retired Email Sent?'],
        ['1', 'Published', 'Test YouTube Video', 'https://youtube.com/watch?v=abc', 'Dan', 'dan@redhat.com', 'Intake Form', '', ''],
        ['2', 'Retired', 'Retired YouTube Video', 'https://youtube.com/watch?v=xyz', 'Eve', 'eve@redhat.com', 'Intake Form', '✅', '']
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
      // Single cell
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

// Load lifecycle notification system
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
    CREATOR_EMAIL: 'Creator Email',
    PROD_ARCADE_LINK: 'Prod Arcade Link'
  }
};

function buildArcadeLifecycleContext(context, status) {
  const { rowNumber, rowData, headerMap, originType } = context;

  let event;
  if (status === ENHANCED_CONFIG.STATUS.DEMO_RECEIVED) {
    event = LIFECYCLE_EVENTS.SUBMISSION_RECEIVED;
  } else if (status === ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED) {
    event = LIFECYCLE_EVENTS.CONTENT_PUBLISHED;
  } else if (status === ENHANCED_CONFIG.STATUS.DEMO_RETIRED) {
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

function buildYouTubeLifecycleContext(payload) {
  return {
    assetType: 'YOUTUBE',
    sourceRepository: 'YouTube_Responses',
    number: String(payload.number || '').trim(),
    event: LIFECYCLE_EVENTS.SUBMISSION_RECEIVED,
    title: String(payload.title || '').trim(),
    creatorName: String(payload.creator || '').trim(),
    creatorEmail: '',
    originType: 'Intake Form',
    isCreatorIntake: true,
    currentStatus: 'Published',
    youtubeUrl: String(payload.youtubeUrl || '').trim()
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

function resolveSourceRecord(sourceRepository, number) {
  try {
    const ss = SpreadsheetApp.openById(getConfigProperty('MASTER_SHEET_ID'));
    const sheet = ss.getSheetByName(sourceRepository);

    if (!sheet) {
      realConsole.warn(`Sheet not found: ${sourceRepository}`);
      return null;
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return null;
    }

    const lastCol = sheet.getLastColumn();
    const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0]
      .map(h => String(h || '').trim());

    const numberColIndex = headers.indexOf('Number');
    if (numberColIndex === -1) {
      realConsole.warn(`Number column not found in ${sourceRepository}`);
      return null;
    }

    const numberColumn = sheet.getRange(2, numberColIndex + 1, lastRow - 1, 1).getValues();
    let targetRowIndex = null;

    for (let i = 0; i < numberColumn.length; i++) {
      if (String(numberColumn[i][0] || '').trim() === String(number).trim()) {
        targetRowIndex = i + 2;
        break;
      }
    }

    if (!targetRowIndex) {
      realConsole.warn(`Number ${number} not found in ${sourceRepository}`);
      return null;
    }

    const rowData = sheet.getRange(targetRowIndex, 1, 1, lastCol).getValues()[0];

    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    return { rowIndex: targetRowIndex, rowData, headerMap, sheet };

  } catch (error) {
    logError('resolveSourceRecord', error, { sourceRepository, number });
    return null;
  }
}

function getCreatorEmailSentColumn(assetType, event) {
  const key = `${assetType}_${event}`;
  const mapping = {
    'ARCADE_SUBMISSION_RECEIVED': 'Creator Submission Email Sent?',
    'ARCADE_CONTENT_PUBLISHED': 'Creator Published Email Sent?',
    'ARCADE_CONTENT_RETIRED': 'Creator Retired Email Sent?',
    'YOUTUBE_SUBMISSION_RECEIVED': 'Creator Submission Email Sent?',
    'YOUTUBE_CONTENT_RETIRED': 'Creator Retired Email Sent?'
  };
  return mapping[key] || null;
}

const STATUS_TRACKER_URL = 'https://script.google.com/a/redhat.com/macros/s/AKfycbzh7a4vsJ0TECMRUFqAazGP8bCQkJuoRv0bhIJlBFHEWj0a4kposd5uKRABmz4QOYej/exec?page=status';

function sendSubmissionReceivedEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];
  const assetType = context.assetType;

  if (assetType === 'YOUTUBE') {
    const subject = `We received your YouTube submission: ${title}`;
    const htmlBody = `<p>Hi ${displayName},</p>` +
      `<p>We received your YouTube submission, "${title}".</p>` +
      (context.youtubeUrl ? `<p><a href="${context.youtubeUrl}">YouTube URL</a></p>` : '') +
      `<p>You can track your submission in the <a href="${STATUS_TRACKER_URL}">Status Tracker</a>.</p>` +
      `<p>Thanks,<br>Interactive Experience Team</p>`;

    GmailApp.sendEmail(creatorEmail, subject, '', {
      name: 'Interactive Experience Team',
      noReply: true,
      htmlBody: htmlBody
    });
  } else {
    const subject = `We received your Interactive Demo submission: ${title}`;
    const htmlBody = `<p>Hi ${displayName},</p>` +
      `<p>We received your Interactive Demo submission, "${title}".</p>` +
      (context.creationLink ? `<p><a href="${context.creationLink}">Creation Link</a></p>` : '') +
      `<p>You can track your submission in the <a href="${STATUS_TRACKER_URL}">Status Tracker</a>.</p>` +
      `<p>We'll review it and follow up if anything is needed.</p>` +
      `<p>Thanks,<br>Interactive Experience Team</p>`;

    GmailApp.sendEmail(creatorEmail, subject, '', {
      name: 'Interactive Experience Team',
      noReply: true,
      htmlBody: htmlBody
    });
  }
}

function sendPublishedEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];
  const subject = `Your Interactive Demo is published: ${title}`;

  const htmlBody = `<p>${displayName},</p>` +
    `<p>Your Interactive Demo, "${title}", has been published.</p>` +
    (context.drupalPageUrl ? `<p><a href="${context.drupalPageUrl}">View your Interactive Demo page</a></p>` : '') +
    `<p>You can track your submission in the <a href="${STATUS_TRACKER_URL}">Status Tracker</a>.</p>` +
    `<p>Thanks,<br>Interactive Experience Team</p>`;

  GmailApp.sendEmail(creatorEmail, subject, '', {
    name: 'Interactive Experience Team',
    noReply: true,
    htmlBody: htmlBody
  });
}

function sendRetiredEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];
  const assetType = context.assetType;

  if (assetType === 'YOUTUBE') {
    const subject = `Your YouTube content has been retired: ${title}`;
    const htmlBody = `<p>Hi ${displayName},</p>` +
      `<p>Your YouTube content, "${title}", has been retired.</p>` +
      (context.youtubeUrl ? `<p><a href="${context.youtubeUrl}">YouTube URL</a></p>` : '') +
      `<p>You can track your submission in the <a href="${STATUS_TRACKER_URL}">Status Tracker</a>.</p>` +
      `<p>Thanks,<br>Interactive Experience Team</p>`;

    GmailApp.sendEmail(creatorEmail, subject, '', {
      name: 'Interactive Experience Team',
      noReply: true,
      htmlBody: htmlBody
    });
  } else {
    const subject = `Your Interactive Demo has been retired: ${title}`;
    const htmlBody = `<p>Hi ${displayName},</p>` +
      `<p>Your Interactive Demo, "${title}", has been retired.</p>` +
      (context.creationLink ? `<p><a href="${context.creationLink}">Creation Link</a></p>` : '') +
      `<p>You can track your submission in the <a href="${STATUS_TRACKER_URL}">Status Tracker</a>.</p>` +
      `<p>Thanks,<br>Interactive Experience Team</p>`;

    GmailApp.sendEmail(creatorEmail, subject, '', {
      name: 'Interactive Experience Team',
      noReply: true,
      htmlBody: htmlBody
    });
  }
}

function dispatchCreatorLifecycleNotification(context) {
  try {
    if (!context.isCreatorIntake) {
      realConsole.log(`Skipping creator email for ${context.assetType} #${context.number}: not Creator Intake`);
      return;
    }

    if (!context.title) {
      realConsole.log(`No title for ${context.assetType} #${context.number}, skipping email`);
      return;
    }

    const record = resolveSourceRecord(context.sourceRepository, context.number);
    if (!record) {
      realConsole.warn(`Could not resolve ${context.sourceRepository} #${context.number}`);
      return;
    }

    const creatorEmail = context.creatorEmail ||
      String(safeGetByName(record.rowData, record.headerMap, 'Creator Email') || '').trim();

    if (!creatorEmail) {
      realConsole.log(`No creator email in resolved record for ${context.assetType} #${context.number}`);
      return;
    }

    const sentColumn = getCreatorEmailSentColumn(context.assetType, context.event);
    if (!sentColumn) {
      realConsole.warn(`No tracking column for ${context.assetType} + ${context.event}`);
      return;
    }

    const sentColIndex = record.headerMap[sentColumn];
    if (sentColIndex === undefined) {
      realConsole.warn(`Tracking column ${sentColumn} not found in ${context.sourceRepository}`);
      return;
    }

    const alreadySent = String(record.rowData[sentColIndex] || '').trim().toLowerCase();
    if (alreadySent === 'yes' || alreadySent === 'true' || alreadySent === 'sent' || alreadySent === '✅') {
      realConsole.log(`Creator email already sent for ${context.assetType} #${context.number} (${context.event})`);
      return;
    }

    let emailSent = false;
    try {
      const creatorName = context.creatorName || creatorEmail.split('@')[0];

      if (context.event === LIFECYCLE_EVENTS.SUBMISSION_RECEIVED) {
        sendSubmissionReceivedEmail_(creatorEmail, creatorName, context.title, context);
      } else if (context.event === LIFECYCLE_EVENTS.CONTENT_PUBLISHED) {
        sendPublishedEmail_(creatorEmail, creatorName, context.title, context);
      } else if (context.event === LIFECYCLE_EVENTS.CONTENT_RETIRED) {
        sendRetiredEmail_(creatorEmail, creatorName, context.title, context);
      } else {
        realConsole.warn(`Unknown lifecycle event: ${context.event}`);
        return;
      }

      emailSent = true;
      realConsole.log(`✅ Creator ${context.event} email sent to ${creatorEmail} for ${context.assetType} #${context.number}: "${context.title}"`);

    } catch (emailError) {
      logError('dispatchCreatorLifecycleNotification_email', emailError, {
        assetType: context.assetType,
        number: context.number,
        event: context.event,
        creatorEmail
      });
      return;
    }

    if (emailSent) {
      record.sheet.getRange(record.rowIndex, sentColIndex + 1).setValue('✅');
    }

  } catch (error) {
    logError('dispatchCreatorLifecycleNotification', error, {
      assetType: context.assetType,
      number: context.number,
      event: context.event
    });
  }
}

// Test suite
function runTests() {
  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      emailsSent = [];
      // Reset sent flags (Request_Master: columns 8,9,10; YouTube_Responses: columns 7,8)
      mockSpreadsheet.sheets['Request_Master'].data[1][8] = '';
      mockSpreadsheet.sheets['Request_Master'].data[1][9] = '';
      mockSpreadsheet.sheets['Request_Master'].data[1][10] = '';
      mockSpreadsheet.sheets['Request_Master'].data[2][8] = '';
      mockSpreadsheet.sheets['Request_Master'].data[2][9] = '';
      mockSpreadsheet.sheets['Request_Master'].data[2][10] = '';
      mockSpreadsheet.sheets['YouTube_Responses'].data[1][7] = '';
      mockSpreadsheet.sheets['YouTube_Responses'].data[1][8] = '';
      mockSpreadsheet.sheets['YouTube_Responses'].data[2][7] = '';
      mockSpreadsheet.sheets['YouTube_Responses'].data[2][8] = '';
      // Reset row 3 origin type
      mockSpreadsheet.sheets['Request_Master'].data[2][5] = 'Request Form';
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

  // Test 1: Arcade SUBMISSION_RECEIVED sends email
  test("Arcade SUBMISSION_RECEIVED sends creator email", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 10).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 10).getValues()[0];
    const context = {
      rowNumber: 2,
      rowData,
      headerMap,
      originType: 'Creator Intake'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Submitted for review');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    assertEqual(emailsSent.length, 1, "Should send one email");
    assertEqual(emailsSent[0].to, 'alice@redhat.com', "Email to correct recipient");
  });

  // Test 2: Arcade CONTENT_PUBLISHED sends email
  test("Arcade CONTENT_PUBLISHED sends creator email", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 10).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(3, 1, 1, 10).getValues()[0];
    const context = {
      rowNumber: 3,
      rowData,
      headerMap,
      originType: 'Creator Intake'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Published');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    assertEqual(emailsSent.length, 1, "Should send one email");
    assertEqual(emailsSent[0].to, 'bob@redhat.com', "Email to correct recipient");
  });

  // Test 3: YouTube SUBMISSION_RECEIVED sends email
  test("YouTube SUBMISSION_RECEIVED sends creator email", () => {
    const payload = {
      number: '1',
      title: 'Test YouTube Video',
      creator: 'Dan',
      youtubeUrl: 'https://youtube.com/watch?v=abc'
    };

    const lifecycleContext = buildYouTubeLifecycleContext(payload);
    dispatchCreatorLifecycleNotification(lifecycleContext);

    assertEqual(emailsSent.length, 1, "Should send one email");
    assertEqual(emailsSent[0].to, 'dan@redhat.com', "Email to correct recipient");
  });

  // Test 4: Idempotency prevents duplicate emails
  test("Idempotency prevents duplicate submission emails", () => {
    mockSpreadsheet.sheets['Request_Master'].data[1][8] = '✅';

    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = {
      rowNumber: 2,
      rowData,
      headerMap,
      originType: 'Creator Intake'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Submitted for review');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    assertEqual(emailsSent.length, 0, "Should not send email when already sent");
  });

  // Test 5: Non-Creator Intake skips notification
  test("Non-Creator Intake submissions skip email", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 10).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(4, 1, 1, 10).getValues()[0];
    const context = {
      rowNumber: 4,
      rowData,
      headerMap,
      originType: 'Request Form'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Retired');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    assertEqual(emailsSent.length, 0, "Should not send email for Request Form");
  });

  // Test 6: YouTube Retired context builds correctly
  test("YouTube Retired context builds correctly", () => {
    const sheet = getMockSheet('YouTube_Responses');
    const headers = sheet.getRange(1, 1, 1, 9).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(3, 1, 1, 9).getValues()[0];
    const context = buildYouTubeRetiredContext(rowData, headerMap, '2');

    assertEqual(context.event, LIFECYCLE_EVENTS.CONTENT_RETIRED, "Event is CONTENT_RETIRED");
    assertEqual(context.assetType, 'YOUTUBE', "Asset type is YOUTUBE");
    assertEqual(context.number, '2', "Number is correct");
    assertEqual(context.title, 'Retired YouTube Video', "Title is correct");
  });

  // Test 7: Repository resolver finds record by Number
  test("Repository resolver finds record by Number", () => {
    const record = resolveSourceRecord('Request_Master', '1');

    assertEqual(record !== null, true, "Should find record");
    assertEqual(record.rowIndex, 2, "Row index is correct");
    assertEqual(record.rowData[2], 'Test Arcade', "Title is correct");
  });

  // Test 8: Email uses "Interactive Demo" not "Arcade" in copy
  test("Email uses 'Interactive Demo' terminology", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = {
      rowNumber: 2,
      rowData,
      headerMap,
      originType: 'Creator Intake'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Submitted for review');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    const email = emailsSent[0];
    assertEqual(email.subject.includes('Interactive Demo submission'), true, "Subject should say 'Interactive Demo submission'");
    assertEqual(email.htmlBody.includes('Interactive Demo submission'), true, "Body should say 'Interactive Demo submission'");
    assertEqual(email.subject.includes('Arcade submission'), false, "Subject should not say 'Arcade submission'");
  });

  // Test 9: Interactive Demo uses Creation Link and Status Tracker
  test("Interactive Demo SUBMISSION_RECEIVED uses Creation Link", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(2, 1, 1, 11).getValues()[0];
    const context = {
      rowNumber: 2,
      rowData,
      headerMap,
      originType: 'Creator Intake'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Submitted for review');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    const email = emailsSent[0];
    assertEqual(email.htmlBody.includes('https://arcade.example.com/create/1'), true, "Should include Creation Link");
    assertEqual(email.htmlBody.includes(STATUS_TRACKER_URL), true, "Should include Status Tracker link");
  });

  // Test 10: Interactive Demo Published uses Drupal Page URL
  test("Interactive Demo CONTENT_PUBLISHED uses Drupal Page URL", () => {
    const sheet = getMockSheet('Request_Master');
    const headers = sheet.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    const rowData = sheet.getRange(3, 1, 1, 11).getValues()[0];
    const context = {
      rowNumber: 3,
      rowData,
      headerMap,
      originType: 'Creator Intake'
    };

    const lifecycleContext = buildArcadeLifecycleContext(context, 'Published');
    dispatchCreatorLifecycleNotification(lifecycleContext);

    const email = emailsSent[0];
    assertEqual(email.htmlBody.includes('https://redhat.com/demo/published-arcade'), true, "Should include Drupal Page URL");
    assertEqual(email.htmlBody.includes('View your Interactive Demo page'), true, "Should have correct link text");
    assertEqual(email.htmlBody.includes(STATUS_TRACKER_URL), true, "Should include Status Tracker link");
  });

  // Test 11: YouTube uses YouTube URL
  test("YouTube emails use YouTube URL", () => {
    const payload = {
      number: '1',
      title: 'Test YouTube Video',
      creator: 'Dan',
      youtubeUrl: 'https://youtube.com/watch?v=abc'
    };

    const lifecycleContext = buildYouTubeLifecycleContext(payload);
    dispatchCreatorLifecycleNotification(lifecycleContext);

    const email = emailsSent[0];
    assertEqual(email.htmlBody.includes('https://youtube.com/watch?v=abc'), true, "Should include YouTube URL");
    assertEqual(email.htmlBody.includes(STATUS_TRACKER_URL), true, "Should include Status Tracker link");
  });

  // Test 12: All emails include Status Tracker
  test("All five email types include Status Tracker link", () => {
    const statusTrackerCount = [];

    // Arcade Submission
    const sheet1 = getMockSheet('Request_Master');
    const headers1 = sheet1.getRange(1, 1, 1, 11).getValues()[0];
    const headerMap1 = {};
    headers1.forEach((h, i) => { if (h) headerMap1[h] = i; });
    const rowData1 = sheet1.getRange(2, 1, 1, 11).getValues()[0];
    const ctx1 = buildArcadeLifecycleContext({ rowNumber: 2, rowData: rowData1, headerMap: headerMap1, originType: 'Creator Intake' }, 'Submitted for review');
    dispatchCreatorLifecycleNotification(ctx1);
    statusTrackerCount.push(emailsSent[emailsSent.length - 1].htmlBody.includes(STATUS_TRACKER_URL));

    // Arcade Published
    mockSpreadsheet.sheets['Request_Master'].data[2][8] = '';
    const rowData2 = sheet1.getRange(3, 1, 1, 11).getValues()[0];
    const ctx2 = buildArcadeLifecycleContext({ rowNumber: 3, rowData: rowData2, headerMap: headerMap1, originType: 'Creator Intake' }, 'Published');
    dispatchCreatorLifecycleNotification(ctx2);
    statusTrackerCount.push(emailsSent[emailsSent.length - 1].htmlBody.includes(STATUS_TRACKER_URL));

    // Arcade Retired (need Creator Intake)
    mockSpreadsheet.sheets['Request_Master'].data[2][9] = '';
    mockSpreadsheet.sheets['Request_Master'].data[2][5] = 'Creator Intake';
    const rowData3 = sheet1.getRange(3, 1, 1, 11).getValues()[0];
    const ctx3 = buildArcadeLifecycleContext({ rowNumber: 3, rowData: rowData3, headerMap: headerMap1, originType: 'Creator Intake' }, 'Retired');
    dispatchCreatorLifecycleNotification(ctx3);
    statusTrackerCount.push(emailsSent[emailsSent.length - 1].htmlBody.includes(STATUS_TRACKER_URL));

    // YouTube Submission
    const payload = { number: '1', title: 'Test YouTube Video', creator: 'Dan', youtubeUrl: 'https://youtube.com/watch?v=abc' };
    mockSpreadsheet.sheets['YouTube_Responses'].data[1][7] = '';
    const ctx4 = buildYouTubeLifecycleContext(payload);
    dispatchCreatorLifecycleNotification(ctx4);
    statusTrackerCount.push(emailsSent[emailsSent.length - 1].htmlBody.includes(STATUS_TRACKER_URL));

    // YouTube Retired
    const sheet2 = getMockSheet('YouTube_Responses');
    const headers2 = sheet2.getRange(1, 1, 1, 9).getValues()[0];
    const headerMap2 = {};
    headers2.forEach((h, i) => { if (h) headerMap2[h] = i; });
    mockSpreadsheet.sheets['YouTube_Responses'].data[2][8] = '';
    const rowData5 = sheet2.getRange(3, 1, 1, 9).getValues()[0];
    const ctx5 = buildYouTubeRetiredContext(rowData5, headerMap2, '2');
    dispatchCreatorLifecycleNotification(ctx5);
    statusTrackerCount.push(emailsSent[emailsSent.length - 1].htmlBody.includes(STATUS_TRACKER_URL));

    const allHaveTracker = statusTrackerCount.every(has => has === true);
    assertEqual(allHaveTracker, true, "All five email types should include Status Tracker link");
    assertEqual(statusTrackerCount.length, 5, "Should have tested all five email types");
  });

  realConsole.log(`\n✅ ${passed} passed, ${failed > 0 ? '❌ ' + failed + ' failed' : 'all tests passed'}`);
  return failed === 0;
}

// Run tests
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { runTests };
}

if (require.main === module) {
  const success = runTests();
  process.exit(success ? 0 : 1);
}
