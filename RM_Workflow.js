/************************************************************
 * Enhanced_Workflow.gs - Request Workflow Orchestration
 *
 * WHAT THIS FILE DOES:
 * Handles the main request lifecycle:
 * - request form intake
 * - master row creation/update
 * - Slack thread creation
 * - status-based workflow actions
 * - request-related document updates
 ************************************************************/

/* =========================
   CORE REQUEST FORM FLOW
========================= */

function handleRequestFormNamedValues(namedValues) {
  try {
    validateConfiguration();

    const extractedData = extractFormData(namedValues);
    const documentData = prepareDocumentData(extractedData);

    const docUrl = createDocumentFromTemplate(documentData);
    const masterPayload = prepareMasterPayload(extractedData, docUrl);

    const upsertResult = upsertMasterRowByGlobalId(extractedData.globalId, masterPayload);

    if (upsertResult.rowIndex && typeof syncRequestMasterRowToVersion === "function") {
      try {
        syncRequestMasterRowToVersion(upsertResult.rowIndex);
        console.log(`✅ Version sync triggered for row ${upsertResult.rowIndex} after form submission`);
      } catch (error) {
        logError("handleRequestFormNamedValues_version_sync", error, {
          globalId: extractedData.globalId,
          rowIndex: upsertResult.rowIndex
        });
      }
    }

    const workflowResult = handleRequestMasterByGlobalId(extractedData.globalId);

    logWorkflowEvent("request_form_processed", {
      globalId: extractedData.globalId,
      number: upsertResult.number,
      docUrl
    });

    return {
      globalId: extractedData.globalId,
      docUrl,
      ...upsertResult,
      workflow: workflowResult
    };

  } catch (error) {
    logError("handleRequestFormNamedValues", error, { namedValues });
    throw new Error(`Request form processing failed: ${error.message}`);
  }
}
function extractFormData(namedValues) {
  const getValue = (key) => {
    return (namedValues[key] && namedValues[key][0])
      ? String(namedValues[key][0]).trim()
      : "";
  };

  const data = {
    timestamp: getValue("Timestamp"),
    email: getValue("Email Address"),
    requestorName: getValue("Full name of Requestor"),
    requestorEmail: getValue("Email Address"),
    team: getValue("What team are you in?"),
    contactedBU: getValue("Have you reached out to your head of BU in charge of this tool?"),
    checkedDemo: getValue("Have you checked if the demo already exists?"),
    priority: getValue("What is the priority?"),
    deadline: getValue("Are there any upcoming deadlines?"),
    demoTitle: getValue("Suggested demo title"),
    contentType: getValue("Content Type"),
    description: getValue("Describe in as much detail the context and content required from the demo you are looking to get made (50-150 words)?"),
    audience: getValue("Primary Audience"),
    personas: getValue("Target Personas"),
    painPoints: getValue("Pain points"),
    links: getValue("Any relevant links and/or CTAs?"),

    // Request form primary product now maps to Primary Product
    primaryProduct: getValue("What Primary Product or Process is it associated with?"),

    marketingProg: getValue("Related Marketing Program?"),
    marketingProgram: getValue("Related Marketing Program?"),
    tdp: getValue("Related Technology Decision Point?"),
    salesTactic: getValue("Related Sales Tactic?"),
    verticals: getValue("Does it touch any specific verticals?"),
    eventName: getValue("Is this for a specific event?"),
    event: getValue("Is this for a specific event?"),
    destination: getValue("Destination Channels"),
    employeeAdvoc: getValue("Optional: Have an Employee Advocacy link? Add it here."),
    globalId: Utilities.getUuid(),
    originType: ENHANCED_CONFIG.ORIGIN_TYPES.REQUEST_FORM
  };

  if (!data.requestorName && !data.email) {
    throw new Error("Requestor name or email is required");
  }

  return data;
}

function prepareDocumentData(formData) {
  const safeTitle = formData.demoTitle || formData.primaryProduct || "(No title)";

  return {
    ...formData,
    productPrimary: formData.primaryProduct || "",
    docTitle: `${formData.originType} – ${safeTitle} – ${formData.requestorName || "Unknown requester"} – ${formData.globalId}`
  };
}
function prepareMasterPayload(formData, docUrl) {
  const now = new Date();

  return {
    [ENHANCED_CONFIG.COLUMNS.ORIGIN_TYPE]: formData.originType,
    [ENHANCED_CONFIG.COLUMNS.GLOBAL_ID]: formData.globalId,
    [ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL]: docUrl,
    [ENHANCED_CONFIG.COLUMNS.REQUEST_SUBMITTED_TS]: formData.timestamp || now,

    [ENHANCED_CONFIG.COLUMNS.REQUESTOR_NAME]: formData.requestorName,
    [ENHANCED_CONFIG.COLUMNS.REQUESTOR_EMAIL]: formData.email,
    [ENHANCED_CONFIG.COLUMNS.REQUESTOR_TEAM]: formData.team,
    [ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE]: formData.demoTitle,

    // Request form primary product goes to Primary Product only
    [ENHANCED_CONFIG.COLUMNS.PRIMARY_PRODUCT]: formData.primaryProduct,
    [ENHANCED_CONFIG.COLUMNS.CONTENT_TYPE]: formData.contentType,

    [ENHANCED_CONFIG.COLUMNS.PRIORITY]: formData.priority,
    [ENHANCED_CONFIG.COLUMNS.DEADLINE]: formData.deadline,
    [ENHANCED_CONFIG.COLUMNS.CONTACTED_BU]: formData.contactedBU,
    [ENHANCED_CONFIG.COLUMNS.CHECKED_DEMO]: formData.checkedDemo,
    [ENHANCED_CONFIG.COLUMNS.MARKETING_PROGRAM]: formData.marketingProg,
    [ENHANCED_CONFIG.COLUMNS.TDP]: formData.tdp,
    [ENHANCED_CONFIG.COLUMNS.SALES_TACTIC]: formData.salesTactic,
    [ENHANCED_CONFIG.COLUMNS.VERTICALS]: formData.verticals,
    [ENHANCED_CONFIG.COLUMNS.EVENT]: formData.eventName,
    [ENHANCED_CONFIG.COLUMNS.PRIMARY_AUDIENCE]: formData.audience,
    [ENHANCED_CONFIG.COLUMNS.PERSONAS]: formData.personas,
    [ENHANCED_CONFIG.COLUMNS.PAIN_POINTS]: formData.painPoints,
    [ENHANCED_CONFIG.COLUMNS.DESTINATION]: formData.destination,
    [ENHANCED_CONFIG.COLUMNS.CONTEXT_DESC]: formData.description,
    [ENHANCED_CONFIG.COLUMNS.REQUEST_LINKS]: formData.links,
    [ENHANCED_CONFIG.COLUMNS.REQUEST_EMPLOYEE_ADVOC]: formData.employeeAdvoc,

    [ENHANCED_CONFIG.COLUMNS.STATUS]: ENHANCED_CONFIG.STATUS.REQUEST_OPEN,
    [ENHANCED_CONFIG.COLUMNS.STATUS_OPEN_TS]: now
  };
}

/* =========================
   SLACK
========================= */

function postToSlack(message, threadTs = null, replyBroadcast = false) {
  try {
    const token = getConfigProperty("SLACK_BOT_TOKEN");
    const channel = getSlackChannelId();

    if (!token) throw new Error("SLACK_BOT_TOKEN not configured");
    if (!channel) throw new Error("SLACK_CHANNEL_ID not configured");
    if (!message) throw new Error("Message content is required");

    const payload = {
      channel,
      text: message
    };

    if (threadTs) {
      payload.thread_ts = threadTs;
      if (replyBroadcast === true) {
        payload.reply_broadcast = true;
      }
    }

    const response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText() || "{}");
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error || "unknown_error"}`);
    }

    logWorkflowEvent("slack_message_posted", {
      messageTs: result.ts,
      threadTs,
      channel
    });

    return result.ts;

  } catch (error) {
    logError("postToSlack", error, { message, threadTs, replyBroadcast });
    throw error;
  }
}

function postToSlackChannel(channelId, message, threadTs = null, replyBroadcast = false) {
  try {
    const token = getConfigProperty("SLACK_BOT_TOKEN");

    if (!token) throw new Error("SLACK_BOT_TOKEN not configured");
    if (!channelId) throw new Error("Channel ID is required");
    if (!message) throw new Error("Message content is required");

    const payload = {
      channel: channelId,
      text: message
    };

    if (threadTs) {
      payload.thread_ts = threadTs;
      if (replyBroadcast === true) {
        payload.reply_broadcast = true;
      }
    }

    const response = UrlFetchApp.fetch("https://slack.com/api/chat.postMessage", {
      method: "post",
      contentType: "application/json; charset=utf-8",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText() || "{}");
    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error || "unknown_error"}`);
    }

    return result.ts;

  } catch (error) {
    logError("postToSlackChannel", error, { channelId, message, threadTs, replyBroadcast });
    throw error;
  }
}

const slackUserCache = new Map();

function lookupSlackUserByEmail(email) {
  if (!email) return "";

  if (slackUserCache.has(email)) {
    return slackUserCache.get(email);
  }

  try {
    const token = getConfigProperty("SLACK_BOT_TOKEN");
    if (!token) throw new Error("SLACK_BOT_TOKEN not configured");

    const url = "https://slack.com/api/users.lookupByEmail?email=" + encodeURIComponent(email);

    const response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: `Bearer ${token}` },
      muteHttpExceptions: true
    });

    const result = JSON.parse(response.getContentText() || "{}");
    if (!result.ok) {
      console.warn(`Slack user lookup failed for ${email}: ${result.error}`);
      return "";
    }

    const userId = result.user && result.user.id ? result.user.id : "";
    slackUserCache.set(email, userId);
    return userId;

  } catch (error) {
    logError("lookupSlackUserByEmail", error, { email });
    return "";
  }
}

function createSlackMention(email) {
  if (!email) return "";
  const userId = lookupSlackUserByEmail(email);
  return userId ? `<@${userId}>` : "";
}

/* =========================
   MASTER ROW OPERATIONS
========================= */

function getMasterRowByGlobalId(globalId) {
  try {
    const cleanedId = normalizeString(globalId).replace(/^'/, "");
    if (!cleanedId) {
      return { rowIndex: -1, headers: [], row: null };
    }

    const sheet = getMasterSheet();
    const data = sheet.getDataRange().getValues();

    if (!data || data.length === 0) {
      throw new Error("Master sheet has no data");
    }

    const headers = data[0].map(h => normalizeString(h));
    const globalIdIndex = headers.indexOf(ENHANCED_CONFIG.COLUMNS.GLOBAL_ID);

    if (globalIdIndex === -1) {
      throw new Error(`"${ENHANCED_CONFIG.COLUMNS.GLOBAL_ID}" column not found in master sheet`);
    }

    for (let i = 1; i < data.length; i++) {
      const cellValue = normalizeString(data[i][globalIdIndex]).replace(/^'/, "");
      if (cellValue === cleanedId) {
        return {
          rowIndex: i + 1,
          headers,
          row: data[i]
        };
      }
    }

    return { rowIndex: -1, headers, row: null };

  } catch (error) {
    logError("getMasterRowByGlobalId", error, { globalId });
    throw error;
  }
}

function upsertMasterRowByGlobalId(globalId, payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!globalId) throw new Error("globalId is required");
    if (!payload) throw new Error("payload is required");

    const sheet = getMasterSheet();
    const data = sheet.getDataRange().getValues();

    if (!data || data.length === 0) {
      throw new Error("Master sheet has no header row");
    }

    const headers = data[0].map(h => normalizeString(h));
    const getColumnIndex = (columnName) => headers.indexOf(columnName);

    const globalIdIndex = getColumnIndex(ENHANCED_CONFIG.COLUMNS.GLOBAL_ID);
    if (globalIdIndex === -1) {
      throw new Error(`"${ENHANCED_CONFIG.COLUMNS.GLOBAL_ID}" column not found`);
    }

    const numberIndex = getColumnIndex(ENHANCED_CONFIG.COLUMNS.NUMBER);

    let rowIndex = -1;
    const cleanedGlobalId = normalizeString(globalId);

    for (let i = 1; i < data.length; i++) {
      const cellValue = normalizeString(data[i][globalIdIndex]).replace(/^'/, "");
      if (cellValue === cleanedGlobalId) {
        rowIndex = i + 1;
        break;
      }
    }

    const existingRow = rowIndex !== -1
      ? sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0]
      : new Array(headers.length).fill("");

    if (rowIndex === -1 && numberIndex !== -1) {
      const nextNumber = calculateNextNumber(sheet, numberIndex);
      payload[ENHANCED_CONFIG.COLUMNS.NUMBER] = nextNumber;
    }

    const newRow = headers.map((header, index) => {
      const currentValue = existingRow[index];
      let incomingValue = payload[header];

      if (header === ENHANCED_CONFIG.COLUMNS.STATUS && incomingValue) {
        incomingValue = normalizeStatusCanonical(incomingValue);
      }

      return (incomingValue !== undefined && incomingValue !== null && incomingValue !== "")
        ? incomingValue
        : currentValue;
    });

    newRow[globalIdIndex] = cleanedGlobalId;

    if (rowIndex === -1) {
      sheet.appendRow(newRow);
      rowIndex = sheet.getLastRow();
    } else {
      sheet.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
    }

    const number = numberIndex !== -1 ? newRow[numberIndex] : "";

    logWorkflowEvent("master_row_upserted", {
      globalId: cleanedGlobalId,
      number,
      rowIndex,
      isNewRow: existingRow[globalIdIndex] ? false : true
    });

    return { rowIndex, number };

  } catch (error) {
    logError("upsertMasterRowByGlobalId", error, { globalId, payload });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function calculateNextNumber(sheet, numberColumnIndex) {
  try {
    if (sheet.getLastRow() <= 1) return 1;

    const numberRange = sheet.getRange(2, numberColumnIndex + 1, sheet.getLastRow() - 1, 1);
    const numbers = numberRange.getValues()
      .flat()
      .map(v => Number(v))
      .filter(n => !isNaN(n) && n > 0);

    return numbers.length > 0 ? Math.max(...numbers) + 1 : 1;

  } catch (error) {
    logError("calculateNextNumber", error);
    return 1;
  }
}

/* =========================
   WORKFLOW ENTRYPOINTS
========================= */

function handleRequestMasterByGlobalId(globalId) {
  try {
    const rowInfo = getMasterRowByGlobalId(globalId);
    if (!rowInfo || rowInfo.rowIndex === -1) {
      throw new Error(`No master row found for Global ID: ${globalId}`);
    }

    return handleRequestMasterByRowNumber(rowInfo.rowIndex);

  } catch (error) {
    logError("handleRequestMasterByGlobalId", error, { globalId });
    throw error;
  }
}

function handleRequestMasterByNumber(requestNumber) {
  try {
    const sheet = getMasterSheet();
    const headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

    const numberColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.NUMBER];
    if (numberColumnIndex == null) {
      throw new Error(`"${ENHANCED_CONFIG.COLUMNS.NUMBER}" column not found in master sheet`);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= ENHANCED_CONFIG.SHEETS.HEADER_ROW) {
      throw new Error("Master sheet has no data rows");
    }

    const numberColumn = sheet.getRange(2, numberColumnIndex + 1, lastRow - 1, 1).getValues();
    let targetRow = null;

    for (let i = 0; i < numberColumn.length; i++) {
      if (String(numberColumn[i][0]).trim() === String(requestNumber).trim()) {
        targetRow = i + 2;
        break;
      }
    }

    if (!targetRow) {
      throw new Error(`Request number ${requestNumber} not found in master sheet`);
    }

    return handleRequestMasterByRowNumber(targetRow);

  } catch (error) {
    logError("handleRequestMasterByNumber", error, { requestNumber });
    throw error;
  }
}

function handleRequestMasterByRowNumber(rowNumber) {
  try {
    const sheet = getMasterSheet();
    const headerMap = getHeaderMapFromSheet(sheet, ENHANCED_CONFIG.SHEETS.HEADER_ROW);

    const requiredColumns = [
      ENHANCED_CONFIG.COLUMNS.THREAD_TS,
      ENHANCED_CONFIG.COLUMNS.STATUS,
      ENHANCED_CONFIG.COLUMNS.GLOBAL_ID
    ];

    for (const columnName of requiredColumns) {
      if (headerMap[columnName] == null) {
        throw new Error(`Required column "${columnName}" not found in master sheet`);
      }
    }

    const lastColumn = sheet.getLastColumn();
    const rowData = sheet.getRange(rowNumber, 1, 1, lastColumn).getValues()[0];

    const status = normalizeStatusCanonical(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.STATUS));
    const globalId = normalizeString(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.GLOBAL_ID)).replace(/^'/, "");
    const number = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.NUMBER) || "").trim();
    const originType = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.ORIGIN_TYPE) || ENHANCED_CONFIG.ORIGIN_TYPES.REQUEST_FORM).trim();

    const threadTsColumn = headerMap[ENHANCED_CONFIG.COLUMNS.THREAD_TS];
    const receivedThreadTsColumn = headerMap[ENHANCED_CONFIG.COLUMNS.RECEIVED_THREAD_TS];

    let requestThreadTs = String(sheet.getRange(rowNumber, threadTsColumn + 1).getValue() || "").trim().replace(/^'/, "");
    let receivedThreadTs = "";

    if (receivedThreadTsColumn != null) {
      receivedThreadTs = String(sheet.getRange(rowNumber, receivedThreadTsColumn + 1).getValue() || "").trim().replace(/^'/, "");
    }

    const workflowResult = processStatusWorkflow({
      status,
      globalId,
      number,
      originType,
      rowNumber,
      requestThreadTs,
      receivedThreadTs,
      sheet,
      headerMap,
      rowData
    });

    logWorkflowEvent("workflow_processed", {
      globalId,
      number,
      status,
      result: workflowResult
    });

    return workflowResult;

  } catch (error) {
    logError("handleRequestMasterByRowNumber", error, { rowNumber });
    throw error;
  }
}

/* =========================
   STATUS WORKFLOW
========================= */

function processStatusWorkflow(context) {
  const {
    status,
    rowNumber,
    requestThreadTs,
    receivedThreadTs,
    sheet,
    headerMap
  } = context;

  try {
    const isCreatorOnly = context.originType === ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY;
    const threadTsColumn = headerMap[ENHANCED_CONFIG.COLUMNS.THREAD_TS];
    const receivedThreadTsColumn = headerMap[ENHANCED_CONFIG.COLUMNS.RECEIVED_THREAD_TS];

    if (!requestThreadTs) {
      if (status === ENHANCED_CONFIG.STATUS.REQUEST_OPEN) {
        const threadTs = createRequestOpenThread(context);
        sheet.getRange(rowNumber, threadTsColumn + 1).setValue("'" + threadTs);
        return { rowNumber, threadTs, posted: "request_open_thread_created" };
      } else if (isCreatorOnly && status === ENHANCED_CONFIG.STATUS.IE_RECEIVED) {
        const threadTs = createCreatorOnlyReceivedThread(context);
        sheet.getRange(rowNumber, threadTsColumn + 1).setValue("'" + threadTs);
        if (receivedThreadTsColumn != null) {
          sheet.getRange(rowNumber, receivedThreadTsColumn + 1).setValue("'" + threadTs);
        }
        markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.RECEIVED_SENT);
        return { rowNumber, threadTs, posted: "creator_only_received_thread_created" };
      } else {
        console.log(`No request thread yet; status=${status}`);
        return { rowNumber, threadTs: "", posted: "skipped_no_request_thread" };
      }
    }

    const lifecycleThreadTs = receivedThreadTs || requestThreadTs;

    switch (status) {
      case ENHANCED_CONFIG.STATUS.REQUEST_APPROVED:
        return processRequestApproved(context, requestThreadTs);

      case ENHANCED_CONFIG.STATUS.IE_RECEIVED:
        return processIEReceived(context, lifecycleThreadTs);

      case ENHANCED_CONFIG.STATUS.IE_REVIEWED:
        return processIEReviewed(context, lifecycleThreadTs);

      case ENHANCED_CONFIG.STATUS.IE_PUBLISHED:
        return processIEPublished(context, lifecycleThreadTs);

      case ENHANCED_CONFIG.STATUS.IE_RETIRED:
        return processIERetired(context, lifecycleThreadTs);

      case ENHANCED_CONFIG.STATUS.CLOSED:
        return processClosed(context, requestThreadTs);

      default:
        return {
          rowNumber,
          threadTs: status === ENHANCED_CONFIG.STATUS.CLOSED ? requestThreadTs : lifecycleThreadTs,
          posted: "no_action_needed"
        };
    }

  } catch (error) {
    logError("processStatusWorkflow", error, context);
    throw error;
  }
}

/* =========================
   THREAD CREATION
========================= */

function createRequestOpenThread(context) {
  const { number, globalId, originType, rowData, headerMap } = context;

  const suggestedTitle = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE) || "").trim() || "—";
  const requestor = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.REQUESTOR_NAME) || "").trim() || "—";
  const priority = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIORITY) || "").trim();
  const deadline = formatDate(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.DEADLINE));
  const tdp = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.TDP) || "").trim();
  const requestDocUrl = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL) || "").trim();

  const primaryProduct = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIMARY_PRODUCT) || ""
  ).trim() || "—";

  const primaryAudience = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIMARY_AUDIENCE) || ""
  ).trim() || "—";

  const eventName = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.EVENT) || ""
  ).trim() || "—";

  const contextDescription = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CONTEXT_DESC) || ""
  ).trim() || "—";

  const globalIdLine = globalId ? `*Global ID*: ${globalId}\n` : "";

  const meta = [number ? `#${number}` : null, globalId ? `GID: ${globalId}` : null].filter(Boolean).join("  •  ");
  const metaLine = meta ? `${meta}\n` : "";

  const webAppUrl = getWebAppUrl();
  const actionLine = webAppUrl ? `<${webAppUrl}|Approve/close here>\n` : "";

  const message =
    `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.REQUEST_OPEN}\n` +
    metaLine +
    `*Origin*: ${originType}\n` +
    `*Deadline*: ${deadline || "—"}\n` +
    `*Suggested Title*: ${suggestedTitle}\n` +
    `*Context Description*: ${contextDescription}\n` +
    `*Requestor*: ${requestor}\n` +
    `*Priority*: ${priority || "—"}\n` +
    `*Primary Product*: ${primaryProduct}\n` +
    `*Primary Audience*: ${primaryAudience}\n` +
    `*TDP*: ${tdp || "—"}\n` +
    `*Event*: ${eventName}\n` +
    globalIdLine +
    actionLine +
    (requestDocUrl ? `<${requestDocUrl}|Creation brief>` : "");

  return postToSlack(message, null);
}
function createCreatorApprovedRequestMessage(context) {
  const { globalId, originType, rowData, headerMap } = context;

  const suggestedTitle =
    String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE) || "").trim() ||
    String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || "").trim() ||
    "—";

  const requestor = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.REQUESTOR_NAME) || ""
  ).trim() || "—";

  const priority = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIORITY) || ""
  ).trim();

  const deadline = formatDate(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.DEADLINE)
  );

  const primaryProduct = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIMARY_PRODUCT) || ""
  ).trim() || "—";

  const primaryAudience = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIMARY_AUDIENCE) || ""
  ).trim() || "—";

  const eventName = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.EVENT) || ""
  ).trim() || "—";

  const contextDescription = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CONTEXT_DESC) || ""
  ).trim() || "—";

  const globalIdLine = globalId ? `*Global ID*: ${globalId}\n` : "";

  const requestDocUrl = String(
    safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL) || ""
  ).trim();

  return (
    `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.CREATOR_CHANNEL_NEW_REQUEST}\n` +
    `*Suggested Title*: ${suggestedTitle}\n` +
    `*Context Description*: ${contextDescription}\n` +
    `*Requestor*: ${requestor}\n` +
    `*Priority*: ${priority || "—"}\n` +
    `*Deadline*: ${deadline || "—"}\n` +
    `*Primary Product*: ${primaryProduct}\n` +
    `*Primary Audience*: ${primaryAudience}\n` +
    `*Event*: ${eventName}\n` +
    globalIdLine +
    (requestDocUrl ? `<${requestDocUrl}|Creation brief>` : "")
  );
}

function postCreatorApprovedRequest(context) {
  const creatorChannelId = getCreatorSlackChannelId();
  if (!creatorChannelId) {
    throw new Error("Creator Slack channel ID not configured");
  }

  const message = createCreatorApprovedRequestMessage(context);
  return postToSlackChannel(creatorChannelId, message, null, false);
}

function createCreatorOnlyReceivedThread(context) {
  const { number, rowData, headerMap } = context;

  const finalDemoTitle = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || "").trim();
  const suggestedTitle = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE) || "").trim();
  const creatorName = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME) || "").trim();
  const creatorTeam = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM) || "").trim();

  const linksLine = buildLinksLine(rowData, headerMap);
  const webAppUrl = getWebAppUrl();
  const actionLine = webAppUrl ? `<${webAppUrl}|Review and Approve here>\n` : "";

  const message =
    `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.IE_RECEIVED} (not request-based)\n` +
    `${number ? ` #${number}` : ""}\n` +
    `*Demo Title*: ${finalDemoTitle || suggestedTitle || "—"}\n` +
    `*Creator*: ${creatorName || "—"}\n` +
    `*Creator Team*: ${creatorTeam || "—"}\n` +
    linksLine +
    actionLine;

  return postToSlack(message, null);
}

function createIEReceivedThread(context) {
  const { number, globalId, originType, rowData, headerMap } = context;
  const isCreatorOnly = originType === ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY;

  const finalDemoTitle = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || "").trim();
  const suggestedTitle = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE) || "").trim();
  const creatorName = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME) || "").trim();
  const creatorTeam = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM) || "").trim();

  let receivedMsg = "";

  if (isCreatorOnly) {
    receivedMsg =
      `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.IE_RECEIVED}\n` +
      `${number ? ` #${number}` : ""}\n` +
      `*Demo Title*: ${finalDemoTitle || suggestedTitle || "—"}\n` +
      `*Creator*: ${creatorName || "—"}\n` +
      `*Creator Team*: ${creatorTeam || "—"}`;
  } else {
    const requestor = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.REQUESTOR_NAME) || "").trim() || "—";
    const priority = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PRIORITY) || "").trim();
    const deadline = formatDate(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.DEADLINE));
    const tdp = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.TDP) || "").trim();

    const meta = [number ? `#${number}` : null, globalId ? `GID: ${globalId}` : null].filter(Boolean).join("  •  ");
    const metaLine = meta ? `${meta}\n` : "";
    const creatorLine = buildCreatorLine(creatorName, creatorTeam);
    const linksLine = buildLinksLine(rowData, headerMap);
    const webAppUrl = getWebAppUrl();
    const actionLine = webAppUrl ? `<${webAppUrl}|Review and Approve here>\n` : "";

    receivedMsg =
      `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.IE_RECEIVED} (based on request)\n` +
      metaLine +
      `*Final Demo Title*: ${finalDemoTitle || suggestedTitle || "—"}\n` +
      creatorLine +
      `> *Requestor*: ${requestor}\n` +
      `> *Priority*: ${priority || "—"}\n` +
      `> *Deadline*: ${deadline || "—"}\n` +
      `> *TDP*: ${tdp || "—"}\n` +
      linksLine +
      actionLine;
  }

  return postToSlack(receivedMsg, null);
}

/* =========================
   STATUS PROCESSORS
========================= */

function processRequestApproved(context, requestThreadTs) {
  const { sheet, headerMap, rowNumber } = context;

  const finalSentColumn = headerMap[ENHANCED_CONFIG.COLUMNS.FINAL_SENT];
  if (finalSentColumn == null) {
    console.log(`Skipping "Request Approved" Slack reply: missing column "${ENHANCED_CONFIG.COLUMNS.FINAL_SENT}"`);
    return { rowNumber, threadTs: requestThreadTs, posted: "skipped_missing_column" };
  }

  let postedApprovedReply = false;
  let postedCreatorChannel = false;

  if (!isStatusSent(sheet, finalSentColumn, rowNumber)) {
    const reply = `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.REQUEST_APPROVED}\n`;
    postToSlack(reply, requestThreadTs);
    markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.FINAL_SENT);
    postedApprovedReply = true;
  }

  const creatorChannelSentColumn = headerMap[ENHANCED_CONFIG.COLUMNS.CREATOR_CHANNEL_SENT];
  if (creatorChannelSentColumn != null && !isStatusSent(sheet, creatorChannelSentColumn, rowNumber)) {
    postCreatorApprovedRequest(context);
    markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.CREATOR_CHANNEL_SENT);
    postedCreatorChannel = true;
  }

  const posted = postedApprovedReply && postedCreatorChannel
    ? "approved_reply_and_creator_channel_posted"
    : postedApprovedReply
      ? "approved_reply"
      : postedCreatorChannel
        ? "creator_channel_posted"
        : "already_sent";

  return { rowNumber, threadTs: requestThreadTs, posted };
}

function processIEReceived(context, lifecycleThreadTs) {
  const { sheet, headerMap, rowNumber, receivedThreadTs } = context;

  if (receivedThreadTs) {
    const receivedSentColumn = headerMap[ENHANCED_CONFIG.COLUMNS.RECEIVED_SENT];
    if (receivedSentColumn != null && !isStatusSent(sheet, receivedSentColumn, rowNumber)) {
      markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.RECEIVED_SENT);
    }
    return { rowNumber, threadTs: receivedThreadTs, posted: "received_parent_exists_no_overwrite" };
  }

  const receivedSentColumn = headerMap[ENHANCED_CONFIG.COLUMNS.RECEIVED_SENT];
  if (receivedSentColumn == null) {
    console.log(`Skipping "IE Received" Slack: missing column "${ENHANCED_CONFIG.COLUMNS.RECEIVED_SENT}"`);
    return { rowNumber, threadTs: lifecycleThreadTs, posted: "skipped_missing_column" };
  }

  if (!isStatusSent(sheet, receivedSentColumn, rowNumber)) {
    updateRequestDocumentWithCreatorData(context);

    const newLifecycleParentTs = createIEReceivedThread(context);

    const receivedThreadTsColumn = headerMap[ENHANCED_CONFIG.COLUMNS.RECEIVED_THREAD_TS];
    if (receivedThreadTsColumn != null) {
      sheet.getRange(rowNumber, receivedThreadTsColumn + 1).setValue("'" + newLifecycleParentTs);
    }

    markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.RECEIVED_SENT);

    return {
      rowNumber,
      threadTs: newLifecycleParentTs,
      posted: context.originType === ENHANCED_CONFIG.ORIGIN_TYPES.CREATOR_ONLY
        ? "creator_only_received_parent_created"
        : "received_lifecycle_parent_created"
    };
  }

  return { rowNumber, threadTs: lifecycleThreadTs, posted: "already_sent" };
}

function processIEReviewed(context, lifecycleThreadTs) {
  console.log(`📝 Processing IE Reviewed status for row ${context.rowNumber}`);

  const { sheet, headerMap, rowNumber, rowData } = context;

  const prodLinkColumnIndex = headerMap[ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK];
  const prodLink = prodLinkColumnIndex != null
    ? String(sheet.getRange(rowNumber, prodLinkColumnIndex + 1).getValue() || "").trim()
    : String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK) || "").trim();

  const prodSentColumn = headerMap[ENHANCED_CONFIG.COLUMNS.PROD_SENT];
  const reviewedSentColumn = headerMap[ENHANCED_CONFIG.COLUMNS.REVIEWED_SENT];

  let didAnything = false;

  if (!prodLink) {
    if (reviewedSentColumn != null && !isStatusSent(sheet, reviewedSentColumn, rowNumber)) {
      const reply =
        `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.IE_REVIEWED}\n` +
        `<@${ENHANCED_CONFIG.SLACK.USER_IDS.ROHAN}> <@${ENHANCED_CONFIG.SLACK.USER_IDS.BRANDON}> ` +
        `Please add the Prod link when you get a chance.`;

      postToSlack(reply, lifecycleThreadTs);
      markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.REVIEWED_SENT);
      didAnything = true;
    }
  } else {
    if (reviewedSentColumn != null && !isStatusSent(sheet, reviewedSentColumn, rowNumber)) {
      markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.REVIEWED_SENT);
    }
  }

  let prodPosted = false;

  if (prodLink && prodSentColumn != null && !isStatusSent(sheet, prodSentColumn, rowNumber)) {
    const reply =
      `${ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.PROD_LINK_ADDED}\n` +
      `<${prodLink}|View Prod Arcade Demo>\n` +
      `<@${ENHANCED_CONFIG.SLACK.USER_IDS.LANDING_PAGE_ADMIN}> ready for you to add to the landing page!`;

    try {
      postToSlack(reply, lifecycleThreadTs);
      markStatusAsSent(sheet, headerMap, rowNumber, ENHANCED_CONFIG.COLUMNS.PROD_SENT);
      prodPosted = true;
    } catch (error) {
      console.error(`❌ Failed to post prod link message:`, error);
    }
  }

  const resultType = didAnything && prodPosted
    ? "reviewed_reply_and_prodlink_reply"
    : didAnything
      ? "reviewed_reply"
      : prodPosted
        ? "prodlink_reply"
        : "reviewed_noop";

  return { rowNumber, threadTs: lifecycleThreadTs, posted: resultType };
}

function processIEPublished(context, lifecycleThreadTs) {
  return processSimpleStatusReply(
    context,
    lifecycleThreadTs,
    ENHANCED_CONFIG.COLUMNS.PUBLISHED_SENT,
    ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.IE_PUBLISHED,
    "published_reply"
  );
}

function processIERetired(context, lifecycleThreadTs) {
  return processSimpleStatusReply(
    context,
    lifecycleThreadTs,
    ENHANCED_CONFIG.COLUMNS.RETIRED_SENT,
    ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.IE_RETIRED,
    "retired_reply"
  );
}

function processClosed(context, requestThreadTs) {
  return processSimpleStatusReply(
    context,
    requestThreadTs,
    ENHANCED_CONFIG.COLUMNS.CLOSED_SENT,
    ENHANCED_CONFIG.SLACK.MESSAGE_TEMPLATES.CLOSED,
    "closed_reply"
  );
}

/* =========================
   HELPERS
========================= */

function processSimpleStatusReply(context, threadTs, sentColumn, messageTemplate, successType) {
  const { sheet, headerMap, rowNumber } = context;

  const sentColumnIndex = headerMap[sentColumn];
  if (sentColumnIndex == null) {
    console.log(`Skipping "${messageTemplate}" Slack reply: missing column "${sentColumn}"`);
    return { rowNumber, threadTs, posted: "skipped_missing_column" };
  }

  if (!isStatusSent(sheet, sentColumnIndex, rowNumber)) {
    const reply = `${messageTemplate}\n`;
    postToSlack(reply, threadTs);
    markStatusAsSent(sheet, headerMap, rowNumber, sentColumn);
    return { rowNumber, threadTs, posted: successType };
  }

  return { rowNumber, threadTs, posted: "already_sent" };
}

function isStatusSent(sheet, columnIndex, rowNumber) {
  if (columnIndex == null) return false;
  return String(sheet.getRange(rowNumber, columnIndex + 1).getValue() || "").trim() === "✅";
}

function markStatusAsSent(sheet, headerMap, rowNumber, columnName) {
  const columnIndex = headerMap[columnName];
  if (columnIndex != null) {
    sheet.getRange(rowNumber, columnIndex + 1).setValue("✅");
  }
}

function buildCreatorLine(creatorName, creatorTeam) {
  let line = "";
  if (creatorName) line += `*Creator*: ${creatorName}\n`;
  if (creatorTeam) line += `*Creator Team*: ${creatorTeam}\n`;
  return line;
}

function buildLinksLine(rowData, headerMap) {
  const creationLink = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_LINK) || "").trim();
  const requestDocUrl = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL) || "").trim();

  const parts = [];
  if (creationLink) parts.push(`<${creationLink}|Creation Link>`);
  if (requestDocUrl) parts.push(`<${requestDocUrl}|Creation Brief Doc>`);
  return parts.length ? parts.join("  |  ") + "\n" : "";
}

function updateRequestDocumentWithCreatorData(context) {
  const { rowData, headerMap } = context;

  const requestDocUrl = String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_BRIEF_DOC_URL) || "").trim();
  if (!requestDocUrl) return;

  const creatorTs = safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_SUBMITTED_TS);
  const creatorData = {
    creatorTimestamp: formatDate(creatorTs),
    creatorName: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_NAME) || "").trim(),
    creatorEmail: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_EMAIL) || "").trim(),
    creatorTeam: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_TEAM) || "").trim(),
    finalDemoTitle: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE) || "").trim(),
    creationLink: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATION_LINK) || "").trim(),
    quarter: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.QUARTER) || "").trim(),
    demoDescription: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.DEMO_DESCRIPTION) || "").trim(),
    language: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.LANGUAGE) || "").trim(),
    syntheticVoice: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.SYNTHETIC_VOICE) || "").trim(),
    translation: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.TRANSLATION) || "").trim(),
    mobileFriendly: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.MOBILE_FRIENDLY) || "").trim(),
    seoWords: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.SEO_WORDS) || "").trim(),
    ctaLink: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CTA_LINK) || "").trim(),
    group: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.GROUP) || "").trim(),
    creatorEmployeeAdvocacy: String(safeGetByName(rowData, headerMap, ENHANCED_CONFIG.COLUMNS.CREATOR_EMPLOYEE_ADVOC) || "").trim()
  };

  updateDocumentTokens(requestDocUrl, creatorData);
}

/* =========================
   LOGGING
========================= */

function logWorkflowEvent(eventType, details = {}) {
  const event = {
    type: eventType,
    timestamp: new Date().toISOString(),
    details
  };

  console.log(`[WORKFLOW_EVENT] ${JSON.stringify(event)}`);

  if (typeof publishEvent === "function") {
    publishEvent(event);
  }
}

/* =========================
   LIMITED COMPATIBILITY
========================= */

function rmPostToSlack_(message, threadTs, replyBroadcast) {
  return postToSlack(message, threadTs, replyBroadcast);
}

function rmLookupSlackUserIdByEmail_(email) {
  return lookupSlackUserByEmail(email);
}

function rmMentionByEmail_(email) {
  return createSlackMention(email);
}

function createGoogleDoc_(data) {
  return createDocumentFromTemplate(data);
}

function rmUpdateRequestDocWithCreator_(requestDocUrl, fields) {
  return updateDocumentTokens(requestDocUrl, fields);
}