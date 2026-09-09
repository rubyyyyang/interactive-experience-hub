/************************************************************
 * RM_AdminMenu.js - Interactive Experience Admin Menu
 *
 * WHAT THIS FILE DOES:
 * Provides the Google Sheets onOpen() menu for admin operations.
 *
 * Menu delegates to:
 * - RM_Metrics.js: pullMetricsFromDatabricks(), clearMetricsData()
 * - RM_Performance.js: runPerformanceLabels(), clearPerformanceLabels()
 * - email_gen.js: promptForCreator(), syncFormResponsesToQueue()
 *
 * USAGE:
 * Installs automatically on spreadsheet open.
 * Apps Script calls this onOpen() on each session start.
 ************************************************************/

/**
 * Apps Script onOpen() handler - creates admin menu
 * Called automatically when the spreadsheet opens
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();

  ui.createMenu('Admin')
    .addItem('Pull Metrics from Databricks', 'pullMetricsFromDatabricks')
    .addItem('Run Performance Labels', 'runPerformanceLabels')
    .addSeparator()
    .addSubMenu(ui.createMenu('Clear Data')
      .addItem('Clear Metrics', 'clearMetricsData')
      .addItem('Clear Performance Labels', 'clearPerformanceLabels'))
    .addToUi();

  ui.createMenu('Email Generator')
    .addItem('Create Email Draft for Creator', 'promptForCreator')
    .addSeparator()
    .addItem('Sync Form Responses to Queue', 'syncFormResponsesToQueue')
    .addToUi();
}
