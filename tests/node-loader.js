/**
 * node-loader.js
 * Minimal loader for Apps Script .js files in Node.js test environment
 * Adapted from arcade-intake-app pattern
 */

const fs = require('fs');
const path = require('path');

function loadAppsScriptFile(filePath) {
  const fullPath = path.resolve(filePath);
  const source = fs.readFileSync(fullPath, 'utf8');

  // Create isolated scope with minimal globals
  const exports = {};
  const module = { exports };

  // Wrap in function to avoid polluting global scope
  const wrappedSource = `
    (function(exports, module) {
      ${source}

      // Export functions that don't have trailing underscore or are explicitly public
      const exported = {};
      if (typeof normalizeSearchText_ !== 'undefined') exported.normalizeSearchText_ = normalizeSearchText_;
      if (typeof expandSearchTokenGroup_ !== 'undefined') exported.expandSearchTokenGroup_ = expandSearchTokenGroup_;
      if (typeof normalizeStatusCanonical !== 'undefined') exported.normalizeStatusCanonical = normalizeStatusCanonical;
      if (typeof isFinalStatus !== 'undefined') exported.isFinalStatus = isFinalStatus;
      if (typeof computeIsReadyToUse_ !== 'undefined') exported.computeIsReadyToUse_ = computeIsReadyToUse_;
      if (typeof computeIsDiscoverable_ !== 'undefined') exported.computeIsDiscoverable_ = computeIsDiscoverable_;
      if (typeof ENHANCED_CONFIG !== 'undefined') exported.ENHANCED_CONFIG = ENHANCED_CONFIG;
      if (typeof DISCOVERY_SEARCH_SYNONYMS !== 'undefined') exported.DISCOVERY_SEARCH_SYNONYMS = DISCOVERY_SEARCH_SYNONYMS;
      if (typeof DISCOVERY_WEBAPP_CONFIG !== 'undefined') exported.DISCOVERY_WEBAPP_CONFIG = DISCOVERY_WEBAPP_CONFIG;

      return exported;
    })
  `;

  try {
    const fn = eval(wrappedSource);
    return fn(exports, module);
  } catch (error) {
    console.error(`Failed to load ${filePath}: ${error.message}`);
    throw error;
  }
}

module.exports = { loadAppsScriptFile };
