/************************************************************
 * Enhanced_Config.gs - Centralized Configuration Management
 *
 * WHAT THIS FILE DOES (For Maintenance):
 * This is the centralized settings file for the entire system.
 *
 * CONFIG STRATEGY:
 * - Script Properties are the override layer
 * - Code-defined DEFAULT values are the project baseline
 * - If a Script Property is not set, the corresponding DEFAULT is used
 ************************************************************/

/* =========================
   CORE CONFIGURATION
========================= */
const ENHANCED_CONFIG = {

  /* =========================
     GOOGLE DRIVE
  ========================= */
  DRIVE: {
    TEMPLATE_ID_DEFAULT: "1Pzgn5aorUi_mLYV8vqNDczXy7qvr5spMji5_Yfa9jOw",
    OUTPUT_FOLDER_ID_DEFAULT: "1e-cd1nFMmmw7JtN5QHVd3ZOms2KjiC4I",
    REQUEST_DOCS_FOLDER_ID_DEFAULT: "1e-cd1nFMmmw7JtN5QHVd3ZOms2KjiC4I"
  },

  /* =========================
     SLACK
  ========================= */
  SLACK: {
    CHANNEL_ID_DEFAULT: "C0A3VFAJFD2", // proj-ie-request C0A3VFAJFD2
    CHANNEL_ID_TEST: "C08S15BN5PG", // proj-ie-test C08S15BN5PG
    CREATOR_CHANNEL_ID_DEFAULT: "C0AT27JRPB7", //test  C0AG5ATLT0U
    USER_IDS: {
      ROHAN: "U02UWAPRMM5",
      BRANDON: "U08SXER0D9T",
      RICARDO: "U05HB3S1EHF",
      RUBY: "U054Q340C9Z",
      LANDING_PAGE_ADMIN: "U054Q340C9Z" // Ruby Yang (deprecated, use RUBY)
    },
    MESSAGE_TEMPLATES: {
      REQUEST_OPEN: "🆕 *New Demo Request Open*",
      REQUEST_APPROVED: "✅ *Request Approved*",
      DEMO_RECEIVED: "📥 *Demo Received*",
      DEMO_REVIEWED: "📝 *Demo Reviewed*",
      DEMO_PUBLISHED: "🚀 *Published on the landing page*",
      DEMO_RETIRED: "📦 *Retired*",
      CLOSED: "🛑 *Closed*",
      PROD_LINK_ADDED: "✅ *Prod link added!*",
      CREATOR_CHANNEL_NEW_REQUEST: "🆕 *New Demo Request*"
    }
  },

  /* =========================
     SHEETS
  ========================= */
  SHEETS: {
    MASTER_NAME_DEFAULT: "Request_Master",
    VERSION_NAME_DEFAULT: "Version",
    CREATOR_FORM_NAME_DEFAULT: "Creator_Form_Raw",
    REQUEST_FORM_NAME_DEFAULT: "Request_Form_Raw",
    HEADER_ROW: 1
  },

  /* =========================
     WORKFLOW STATUS
  ========================= */
  STATUS: {
    REQUEST_OPEN: "Request Open",
    REQUEST_APPROVED: "Request Approved",
    DEMO_RECEIVED: "Demo Received",
    DEMO_REVIEWED: "Demo Reviewed",
    DEMO_PUBLISHED: "Published",
    DEMO_RETIRED: "Retired",
    CLOSED: "Closed"
  },

  STATUS_LIFECYCLE_ORDER: [
    "Request Open", "Request Approved", "Demo Received",
    "Demo Reviewed", "Published", "Retired", "Closed"
  ],

  /* =========================
     ORIGIN TYPES
  ========================= */
  ORIGIN_TYPES: {
    REQUEST_FORM: "Request Form",
    CREATOR_ONLY: "Creator Intake Form (no request)"
  },

  /* =========================
     COLUMN DEFINITIONS
  ========================= */
  COLUMNS: {
    // Core identification
    NUMBER: "Number",
    STATUS: "Status",
    PUBLISH_STATES: "Publish states",
    GLOBAL_ID: "Global ID",
    ORIGIN_TYPE: "Origin Type",

    // Slack threads
    THREAD_TS: "thread_ts",
    RECEIVED_THREAD_TS: "received_thread_ts",

    // Sent flags (Slack notifications)
    RECEIVED_SENT: "Received sent?",
    REVIEWED_SENT: "Reviewed sent?",
    PUBLISHED_SENT: "Published sent?",
    FINAL_SENT: "Approved sent?",
    RETIRED_SENT: "Retired sent?",
    CLOSED_SENT: "Closed sent?",
    PROD_SENT: "Prod sent?",
    CREATOR_CHANNEL_SENT: "Creator channel sent?",

    // Creator email sent flags (independent from Slack)
    CREATOR_SUBMISSION_EMAIL_SENT: "Creator Submission Email Sent?",
    CREATOR_PUBLISHED_EMAIL_SENT: "Creator Published Email Sent?",
    CREATOR_RETIRED_EMAIL_SENT: "Creator Retired Email Sent?",

    // Request fields
    CREATION_BRIEF_DOC_URL: "Creation Brief Doc URL",
    REQUEST_SUBMITTED_TS: "Request Submitted Timestamp",
    REQUESTOR_NAME: "Requestor Name",
    REQUESTOR_EMAIL: "Requestor Email",
    REQUESTOR_TEAM: "Requestor Team",
    SUGGESTED_TITLE: "Suggested Demo Title",
    PRIMARY_PRODUCT: "Primary Product",
    PRODUCT: "Product",
    PRIMARY_TOPIC: "Primary Topic",
    TOPIC: "Topic",
    CONTENT_TYPE: "Content Type",
    PRIORITY: "Priority",
    DEADLINE: "Deadline",
    CONTACTED_BU: "Contacted BU",
    CHECKED_DEMO: "Checked Existing Demo",
    MARKETING_PROGRAM: "Marketing Program",
    TDP: "TDP",
    SALES_TACTIC: "Sales Tactic",
    VERTICALS: "Verticals",
    EVENT: "Event",
    PRIMARY_AUDIENCE: "Primary Audience",
    PERSONAS: "Personas",
    PAIN_POINTS: "Pain Points",
    DESTINATION: "Destination Channels",
    CONTEXT_DESC: "Context Description",
    REQUEST_LINKS: "Relevant Links / CTAs",
    REQUEST_EMPLOYEE_ADVOC: "Request Employee Advocacy Link",

    // Creator fields
    CREATOR_NAME: "Creator Name",
    CREATOR_TEAM: "Creator Team",
    CREATOR_EMAIL: "Creator Email",
    FINAL_DEMO_TITLE: "Final Demo Title",
    CREATION_LINK: "Creation Link",
    CREATOR_SUBMITTED_TS: "Creator Submitted Timestamp",
    QUARTER: "Quarter",
    DEMO_DESCRIPTION: "Demo Description",
    LANGUAGE: "Language",
    SEO_WORDS: "SEOWords",
    SYNTHETIC_VOICE: "Synthetic Voice Used?",
    TRANSLATION: "Translation Used?",
    MOBILE_FRIENDLY: "Mobile-friendly design considered?",
    CTA_LINK: "CTALink",
    GROUP: "Group",
    CREATOR_EMPLOYEE_ADVOC: "Creator Employee Advocacy Link",
    DURATION: "Duration",
    DESCRIPTION_FOR_SEO: "Description for SEO",

    // Production
    PROD_ARCADE_LINK: "Production Link",

    // Discovery / publish window
    FEATURED_START_DATE: "Featured Start Date",
    FEATURED_END_DATE: "Featured End Date",
    LATEST_START_DATE: "Latest Start Date",
    LATEST_END_DATE: "Latest End Date",

    // Misc
    DRUPAL_PAGE_URL: "Drupal Page URL",
    JIRA_TICKET_URL: "Jira Ticket URL",
    RHAC_PAGE: "RHAC page",
    NOTE: "Note",
    METADATA: "Metadata",

    // Status timestamps
    STATUS_OPEN_TS: "Status Open Timestamp",
    STATUS_RECEIVED_TS: "Status Received Timestamp",
    STATUS_REVIEWED_TS: "Status Reviewed Timestamp",
    STATUS_APPROVED_TS: "Status Approved Timestamp",
    STATUS_PUBLISHED_TS: "Status Published Timestamp",
    STATUS_RETIRED_TS: "Status Retired Timestamp",
    STATUS_CLOSED_TS: "Status Closed Timestamp"
  },

  /* =========================
     WEB APP
  ========================= */
  WEB_APP: {
    URL_DEFAULT: "https://docs.google.com/spreadsheets/d/1t7TJtTL-jbUaCVKVLMMOahbKcL5b1IyCf3uUSCmQo4A/edit?gid=1123598561#gid=1123598561"
  },

  /* =========================
     PERFORMANCE
  ========================= */
  PERFORMANCE: {
    CACHE_TTL_MINUTES: 5,
    DEBOUNCE_DELAY_MS: 1200,
    MAX_BATCH_SIZE: 1000,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_BASE_MS: 1000
  },

  /* =========================
     DATABRICKS
  ========================= */
DATABRICKS: {
  HOST_DEFAULT: "",
  CATALOG_DEFAULT: "dev",
  SCHEMA_DEFAULT: "arcade_demo",
  WAREHOUSE_ID_DEFAULT: "",
  REQUEST_MASTER_TABLE: "request_master",
  VERSION_TABLE: "version",
  VIEWS: {
    ENGAGEMENT: "v_arcade_name_month_v2",
    SALES_PAGE: "m_arcade_sales_page_month_reporting"
  }
},

  /* =========================
     METRICS
  ========================= */
  METRICS: {
    TREND_THRESHOLD: 0.10,
    TREND_MONTHS: 3
  }
};

/* =========================
   CONFIG ACCESS
========================= */

function getConfigProperty(key, defaultValue = null) {
  try {
    const value = PropertiesService.getScriptProperties().getProperty(key);
    return value !== null ? value : defaultValue;
  } catch (e) {
    console.error(`Failed to get property ${key}: ${e.message}`);
    return defaultValue;
  }
}

function getSlackChannelId() {
  const isTestMode = getConfigProperty("ENVIRONMENT") === "test";
  const defaultChannel = isTestMode
    ? ENHANCED_CONFIG.SLACK.CHANNEL_ID_TEST
    : ENHANCED_CONFIG.SLACK.CHANNEL_ID_DEFAULT;

  return getConfigProperty("SLACK_CHANNEL_ID", defaultChannel);
}

function getCreatorSlackChannelId() {
  const isTestMode = getConfigProperty("ENVIRONMENT") === "test";
  const defaultChannel = isTestMode
    ? ENHANCED_CONFIG.SLACK.CHANNEL_ID_TEST
    : ENHANCED_CONFIG.SLACK.CREATOR_CHANNEL_ID_DEFAULT;

  return getConfigProperty("CREATOR_SLACK_CHANNEL_ID", defaultChannel);
}

function getTemplateId() {
  return getConfigProperty("TEMPLATE_ID", ENHANCED_CONFIG.DRIVE.TEMPLATE_ID_DEFAULT);
}

function getOutputFolderId() {
  return getConfigProperty("OUTPUT_FOLDER_ID")
    || getConfigProperty("REQUEST_DOCS_FOLDER_ID")
    || ENHANCED_CONFIG.DRIVE.OUTPUT_FOLDER_ID_DEFAULT;
}

function getWebAppUrl() {
  return getConfigProperty("WEB_APP_URL", ENHANCED_CONFIG.WEB_APP.URL_DEFAULT);
}

function getMasterSheetName() {
  return getConfigProperty("MASTER_SHEET_NAME", ENHANCED_CONFIG.SHEETS.MASTER_NAME_DEFAULT);
}

function getVersionSheetName() {
  return getConfigProperty("VERSION_SHEET_NAME", ENHANCED_CONFIG.SHEETS.VERSION_NAME_DEFAULT);
}

function getCreatorFormSheetName() {
  return getConfigProperty("CREATOR_FORM_SHEET_NAME", ENHANCED_CONFIG.SHEETS.CREATOR_FORM_NAME_DEFAULT);
}

function getStatusToTimestampMapping() {
  return {
    [ENHANCED_CONFIG.STATUS.REQUEST_OPEN]: ENHANCED_CONFIG.COLUMNS.STATUS_OPEN_TS,
    [ENHANCED_CONFIG.STATUS.REQUEST_APPROVED]: ENHANCED_CONFIG.COLUMNS.STATUS_APPROVED_TS,
    [ENHANCED_CONFIG.STATUS.DEMO_RECEIVED]: ENHANCED_CONFIG.COLUMNS.STATUS_RECEIVED_TS,
    [ENHANCED_CONFIG.STATUS.DEMO_REVIEWED]: ENHANCED_CONFIG.COLUMNS.STATUS_REVIEWED_TS,
    [ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED]: ENHANCED_CONFIG.COLUMNS.STATUS_PUBLISHED_TS,
    [ENHANCED_CONFIG.STATUS.DEMO_RETIRED]: ENHANCED_CONFIG.COLUMNS.STATUS_RETIRED_TS,
    [ENHANCED_CONFIG.STATUS.CLOSED]: ENHANCED_CONFIG.COLUMNS.STATUS_CLOSED_TS
  };
}

function getDatabricksConfig() {
  return {
    host: getConfigProperty("DATABRICKS_HOST", ENHANCED_CONFIG.DATABRICKS.HOST_DEFAULT),
    token: getConfigProperty("DATABRICKS_TOKEN"),
    warehouseId: getConfigProperty("WAREHOUSE_ID", ENHANCED_CONFIG.DATABRICKS.WAREHOUSE_ID_DEFAULT),
    catalog: getConfigProperty("DBX_CATALOG", ENHANCED_CONFIG.DATABRICKS.CATALOG_DEFAULT),
    schema: getConfigProperty("DBX_SCHEMA", ENHANCED_CONFIG.DATABRICKS.SCHEMA_DEFAULT)
  };
}

function validateConfiguration() {
  const required = [
    "SLACK_BOT_TOKEN"
  ];

  const missing = [];
  for (const key of required) {
    if (!getConfigProperty(key)) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  return true;
}

function notifyConfigurationChange(key, oldValue, newValue) {
  const event = {
    type: "configuration_change",
    key,
    oldValue,
    newValue,
    timestamp: new Date()
  };

  if (typeof publishEvent === "function") {
    publishEvent(event);
  }
}


if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ENHANCED_CONFIG,
    getConfigProperty,
    validateConfiguration
  };
}