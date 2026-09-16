/************************************************************
 * RM_Creator_Lifecycle_Notifications.js
 * Centralized Creator Lifecycle Email Notification System
 *
 * ARCHITECTURE:
 * Single lifecycle notification hub for all Interactive Experience assets.
 * Asset-specific adapters → normalized lifecycle events → shared dispatcher.
 *
 * IDENTITY:
 * sourceRepository + Number (Number column value, NOT physical row index)
 *
 * NORMALIZED EVENTS:
 * - SUBMISSION_RECEIVED
 * - CONTENT_PUBLISHED
 * - CONTENT_RETIRED
 *
 * SUPPORTED ASSETS:
 * - Arcade (Request_Master)
 * - YouTube (YouTube_Responses)
 ************************************************************/

/* =========================
   LIFECYCLE EVENTS
========================= */

const LIFECYCLE_EVENTS = {
  SUBMISSION_RECEIVED: 'SUBMISSION_RECEIVED',
  CONTENT_PUBLISHED: 'CONTENT_PUBLISHED',
  CONTENT_RETIRED: 'CONTENT_RETIRED'
};

/* =========================
   ASSET ADAPTERS
========================= */

/**
 * Build normalized lifecycle context for Arcade (Request_Master)
 */
function buildArcadeLifecycleContext(context, status) {
  const { rowNumber, rowData, headerMap, originType } = context;

  // Map Arcade status to normalized event
  let event;
  if (status === ENHANCED_CONFIG.STATUS.DEMO_RECEIVED) {
    event = LIFECYCLE_EVENTS.SUBMISSION_RECEIVED;
  } else if (status === ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED) {
    event = LIFECYCLE_EVENTS.CONTENT_PUBLISHED;
  } else if (status === ENHANCED_CONFIG.STATUS.DEMO_RETIRED) {
    event = LIFECYCLE_EVENTS.CONTENT_RETIRED;
  } else {
    return null; // Not a lifecycle event we handle
  }

  // Determine if Creator Intake
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
    drupalPageUrl: String(safeGetByName(rowData, headerMap, 'Drupal Page URL') || '').trim(),
    productionLink: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK) || '').trim()
  };
}

/**
 * Build normalized lifecycle context for YouTube (YouTube_Responses)
 */
function buildYouTubeLifecycleContext(payload) {
  // YouTube webhook payload for initial submission
  // Maps initial Published to SUBMISSION_RECEIVED

  return {
    assetType: 'YOUTUBE',
    sourceRepository: 'YouTube_Responses',
    number: String(payload.number || '').trim(),
    event: LIFECYCLE_EVENTS.SUBMISSION_RECEIVED,
    title: String(payload.title || '').trim(),
    creatorName: String(payload.creator || '').trim(),
    creatorEmail: '', // Will be resolved from sheet
    originType: 'Intake Form',
    isCreatorIntake: true, // YouTube submissions are always Creator Intake
    currentStatus: 'Published',
    youtubeUrl: String(payload.youtubeUrl || '').trim()
  };
}

/**
 * Build normalized lifecycle context for YouTube Retired status
 */
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

/* =========================
   REPOSITORY RESOLVER
========================= */

/**
 * Resolve source record by sourceRepository + Number
 * Returns { rowIndex, rowData, headerMap, sheet } or null
 */
function resolveSourceRecord(sourceRepository, number) {
  try {
    const ss = SpreadsheetApp.openById(getConfigProperty('MASTER_SHEET_ID'));
    const sheet = ss.getSheetByName(sourceRepository);

    if (!sheet) {
      console.warn(`Sheet not found: ${sourceRepository}`);
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
      console.warn(`Number column not found in ${sourceRepository}`);
      return null;
    }

    // Find row by Number column value
    const numberColumn = sheet.getRange(2, numberColIndex + 1, lastRow - 1, 1).getValues();
    let targetRowIndex = null;

    for (let i = 0; i < numberColumn.length; i++) {
      if (String(numberColumn[i][0] || '').trim() === String(number).trim()) {
        targetRowIndex = i + 2; // Physical row index (1-indexed, +1 for header)
        break;
      }
    }

    if (!targetRowIndex) {
      console.warn(`Number ${number} not found in ${sourceRepository}`);
      return null;
    }

    const rowData = sheet.getRange(targetRowIndex, 1, 1, lastCol).getValues()[0];

    // Build headerMap
    const headerMap = {};
    headers.forEach((h, i) => { if (h) headerMap[h] = i; });

    return { rowIndex: targetRowIndex, rowData, headerMap, sheet };

  } catch (error) {
    logError('resolveSourceRecord', error, { sourceRepository, number });
    return null;
  }
}

/* =========================
   CREATOR EMAIL DISPATCHER
========================= */

/**
 * Dispatch creator lifecycle email notification
 * Central dispatcher for all assets and lifecycle events
 */
function dispatchCreatorLifecycleNotification(context) {
  try {
    // Only send emails for Creator Intake submissions
    if (!context.isCreatorIntake) {
      console.log(`Skipping creator email for ${context.assetType} #${context.number}: not Creator Intake`);
      return;
    }

    // Validate required fields
    if (!context.creatorEmail && context.event !== LIFECYCLE_EVENTS.SUBMISSION_RECEIVED) {
      console.log(`No creator email for ${context.assetType} #${context.number}, skipping email`);
      return;
    }

    if (!context.title) {
      console.log(`No title for ${context.assetType} #${context.number}, skipping email`);
      return;
    }

    // Resolve source record
    const record = resolveSourceRecord(context.sourceRepository, context.number);
    if (!record) {
      console.warn(`Could not resolve ${context.sourceRepository} #${context.number}`);
      return;
    }

    // Get creatorEmail from resolved record if not in context
    const creatorEmail = context.creatorEmail ||
      String(safeGetByName(record.rowData, record.headerMap, 'Creator Email') || '').trim();

    if (!creatorEmail) {
      console.log(`No creator email in resolved record for ${context.assetType} #${context.number}`);
      return;
    }

    // Determine sent column from assetType + event
    const sentColumn = getCreatorEmailSentColumn(context.assetType, context.event);
    if (!sentColumn) {
      console.warn(`No tracking column for ${context.assetType} + ${context.event}`);
      return;
    }

    const sentColIndex = record.headerMap[sentColumn];
    if (sentColIndex === undefined) {
      console.warn(`Tracking column ${sentColumn} not found in ${context.sourceRepository}`);
      return;
    }

    // Check idempotency
    const alreadySent = String(record.rowData[sentColIndex] || '').trim().toLowerCase();
    if (alreadySent === 'yes' || alreadySent === 'true' || alreadySent === 'sent' || alreadySent === '✅') {
      console.log(`Creator email already sent for ${context.assetType} #${context.number} (${context.event})`);
      return;
    }

    // Send email by event type
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
        console.warn(`Unknown lifecycle event: ${context.event}`);
        return;
      }

      emailSent = true;
      console.log(`✅ Creator ${context.event} email sent to ${creatorEmail} for ${context.assetType} #${context.number}: "${context.title}"`);

    } catch (emailError) {
      logError('dispatchCreatorLifecycleNotification_email', emailError, {
        assetType: context.assetType,
        number: context.number,
        event: context.event,
        creatorEmail
      });
      // Email failure does NOT block lifecycle processing
      return;
    }

    // Mark as sent only after successful email delivery
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

/**
 * Get creator email sent column name from assetType + event
 */
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

/* =========================
   EMAIL TEMPLATES
========================= */

const STATUS_TRACKER_URL = 'https://script.google.com/a/redhat.com/macros/s/AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg/exec?page=status';
const INTERACT_HUB_URL = 'https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec';
const SUBMIT_NEW_DEMO_URL = 'https://script.google.com/a/macros/redhat.com/s/AKfycby41BSoZbpLqdkdRG5B5hvdr7-c1KT-TaCw9_WV3_Q0ag13oe_CjHt-JUIDeHzdSTAg/exec';
const TEAM_EMAIL = 'interactive-experiences@redhat.com';

/**
 * Escape HTML special characters to prevent injection
 */
function escapeHtml_(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Send submission received confirmation email
 */
function sendSubmissionReceivedEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];
  const assetType = context.assetType;

  if (assetType === 'YOUTUBE') {
    // VIDEO DEMO - SUBMISSION RECEIVED
    const subject = `Video Demo submitted: ${title}`;

    const htmlBody = `<p>Hi ${escapeHtml_(displayName)},</p>` +
      `<p>We received your Video Demo submission, "${escapeHtml_(title)}".</p>` +
      (context.youtubeUrl ? `<p><strong><a href="${escapeHtml_(context.youtubeUrl)}">View submitted video</a></strong></p>` : '') +
      `<p>We'll review it and follow up if anything is needed. You can track its progress at any time in the <strong><a href="${STATUS_TRACKER_URL}">Status Tracker</a></strong>.</p>` +
      `<p>Questions or changes? <a href="mailto:interactive-experiences@redhat.com">Contact the Interactive Experiences Team</a>.</p>` +
      `<p><strong><a href="${INTERACT_HUB_URL}">Explore the Interact Hub</a></strong> · <strong><a href="${STATUS_TRACKER_URL}">Check your submissions</a></strong> · <strong><a href="${SUBMIT_NEW_DEMO_URL}">Submit new content</a></strong></p>` +
      `<p>Thanks,<br>Interactive Experiences Team</p>`;

    const plainBody = `Hi ${displayName},\n\n` +
      `We received your Video Demo submission, "${title}".\n\n` +
      (context.youtubeUrl ? `**View submitted video**\n${context.youtubeUrl}\n\n` : '') +
      `We'll review it and follow up if anything is needed. You can track its progress at any time in the **Status Tracker**.\n\n` +
      `${STATUS_TRACKER_URL}\n\n` +
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
    // INTERACTIVE DEMO - SUBMISSION RECEIVED
    const subject = `Interactive Demo submitted: ${title}`;

    const htmlBody = `<p>Hi ${escapeHtml_(displayName)},</p>` +
      `<p>We received your Interactive Demo submission, "${escapeHtml_(title)}".</p>` +
      (context.creationLink ? `<p><strong><a href="${escapeHtml_(context.creationLink)}">View your submission</a></strong></p>` : '') +
      `<p>We'll review it and follow up if anything is needed. You can track its progress at any time in the <strong><a href="${STATUS_TRACKER_URL}">Status Tracker</a></strong>.</p>` +
      `<p>Questions or changes? <a href="mailto:interactive-experiences@redhat.com">Contact the Interactive Experiences Team</a>.</p>` +
      `<p><strong><a href="${INTERACT_HUB_URL}">Explore the Interact Hub</a></strong> · <strong><a href="${STATUS_TRACKER_URL}">Check your submissions</a></strong> · <strong><a href="${SUBMIT_NEW_DEMO_URL}">Submit new content</a></strong></p>` +
      `<p>Thanks,<br>Interactive Experiences Team,<br>Red Hat Demo Platform</p>`;

    const plainBody = `Hi ${displayName},\n\n` +
      `We received your Interactive Demo submission, "${title}".\n\n` +
      (context.creationLink ? `**View your submission**\n${context.creationLink}\n\n` : '') +
      `We'll review it and follow up if anything is needed. You can track its progress at any time in the **Status Tracker**.\n\n` +
      `${STATUS_TRACKER_URL}\n\n` +
      `Questions or changes? Contact the Interactive Experiences Team: interactive-experiences@redhat.com\n\n` +
      `**Explore the Interact Hub** · **Check your submissions** · **Submit new content**\n\n` +
      `${INTERACT_HUB_URL}\n\n${STATUS_TRACKER_URL}\n\n${SUBMIT_NEW_DEMO_URL}\n\n` +
      `Thanks,\nInteractive Experiences Team,\nRed Hat Demo Platform`;

    GmailApp.sendEmail(creatorEmail, subject, plainBody, {
      name: 'Interactive Experiences Team',
      noReply: true,
      htmlBody: htmlBody
    });
  }
}

/**
 * Send published notification email
 */
function sendPublishedEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];

  // INTERACTIVE DEMO - PUBLISHED
  const subject = `Your Interactive Demo is live: ${title}`;

  const htmlBody = `<p>Hi ${escapeHtml_(displayName)},</p>` +
    `<p>Your Interactive Demo, "${escapeHtml_(title)}", is now live.</p>` +
    (context.drupalPageUrl ? `<p><strong><a href="${escapeHtml_(context.drupalPageUrl)}">View your Interactive Demo</a></strong></p>` : '') +
    `<p>Your demo is now available to discover and share through the Interact Hub and interact.redhat.com.</p>` +
    `<p>Questions or changes? <a href="mailto:interactive-experiences@redhat.com">Contact the Interactive Experiences Team</a>.</p>` +
    `<p><strong><a href="${INTERACT_HUB_URL}">Explore the Interact Hub</a></strong> · <strong><a href="${STATUS_TRACKER_URL}">Check your submissions</a></strong> · <strong><a href="${SUBMIT_NEW_DEMO_URL}">Submit new content</a></strong></p>` +
    `<p>Thanks,<br>Interactive Experiences Team,<br>Red Hat Demo Platform</p>`;

  const plainBody = `Hi ${displayName},\n\n` +
    `Your Interactive Demo, "${title}", is now live.\n\n` +
    (context.drupalPageUrl ? `**View your Interactive Demo**\n${context.drupalPageUrl}\n\n` : '') +
    `Your demo is now available to discover and share through the Interact Hub and interact.redhat.com.\n\n` +
    `Questions or changes? Contact the Interactive Experiences Team: interactive-experiences@redhat.com\n\n` +
    `**Explore the Interact Hub** · **Check your submissions** · **Submit new content**\n\n` +
    `${INTERACT_HUB_URL}\n\n${STATUS_TRACKER_URL}\n\n${SUBMIT_NEW_DEMO_URL}\n\n` +
    `Thanks,\nInteractive Experiences Team,\nRed Hat Demo Platform`;

  GmailApp.sendEmail(creatorEmail, subject, plainBody, {
    name: 'Interactive Experiences Team',
    noReply: true,
    htmlBody: htmlBody
  });
}

/**
 * Send retired notification email
 */
function sendRetiredEmail_(creatorEmail, creatorName, title, context) {
  const displayName = creatorName || creatorEmail.split('@')[0];
  const assetType = context.assetType;

  if (assetType === 'YOUTUBE') {
    // VIDEO DEMO - RETIRED
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
    // INTERACTIVE DEMO - RETIRED
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
