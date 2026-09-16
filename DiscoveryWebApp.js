/***************************************
 * Arcade Finder - Enhanced Version
 * Original discovery system + Email & Analytics
 * 
 * INSTRUCTIONS: Add these functions to your existing Google Apps Script
 * Your existing code remains unchanged - these are additional functions
 ***************************************/

// =============================================================================
// YOUR EXISTING CODE STAYS EXACTLY THE SAME
// (Keep all your current functions: doGet, getDiscoveryBootstrap, etc.)
// =============================================================================

/***************************************
 * Arcade Finder
 * Flat paginated results
 * Same spreadsheet, same Request_Master
 ***************************************/

// Discovery cache schema version
// Increment this when cached Discovery payload semantics or dependencies change
// (e.g., changes to filter detection, record normalization, facet structure, or bundle shape)
// to intentionally invalidate existing cache entries.
const DISCOVERY_CACHE_SCHEMA_VERSION = 2;

const DISCOVERY_WEBAPP_CONFIG = {
  MASTER_SHEET: "Request_Master",
  HEADER_ROW: 1,
  EDITORS_PROP_KEY: "EDITORS",
  PAGE_SIZE: 20,
  FILTER_OPTIONS_CACHE_SECONDS: 900,
  LIST_CACHE_SECONDS: 300,
  INDEX_CACHE_SECONDS: 1800,
  MAX_EMAIL_TEXT_LENGTH: 4000,
  MAX_SELECTED_RECORDS_EMAIL: 100,
  MAX_REQUESTS_PER_WINDOW: 5,
  RATE_LIMIT_WINDOW_SECONDS: 300,
  ALLOWED_EMAIL_DOMAINS: ["redhat.com"],
};


const DISCOVERY_RUNTIME_MEMO = {
  versionKey: "",
  bundle: null,
};

// Search tuning: keep this small and focused so list/search stays fast.
const DISCOVERY_SEARCH_SYNONYMS = {
  "k8s": ["kubernetes"],
  "kube": ["kubernetes"],
  "ocp": ["openshift", "openshift container platform"],
  "aap": ["ansible automation platform", "ansible"],
  "rhel": ["red hat enterprise linux"],
  "virt": ["virtualization", "openshift virtualization"],
  "multi-layer": ["multilayer", "multilayered", "multi layer"],
  "multi": ["multilayer", "multilayered", "multi layer"],
  "multilayer": ["multi layer", "multi-layer", "multilayered"],
  "multilayered": ["multi layer", "multi-layer", "multilayer"],
};

function getDiscoveryRequiredHeaders_() {
  return [
    ENHANCED_CONFIG.COLUMNS.STATUS,
    ENHANCED_CONFIG.COLUMNS.FINAL_DEMO_TITLE,
    ENHANCED_CONFIG.COLUMNS.SUGGESTED_TITLE,
    ENHANCED_CONFIG.COLUMNS.PRODUCT,
    ENHANCED_CONFIG.COLUMNS.EVENT,
    ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK,
    ENHANCED_CONFIG.COLUMNS.DRUPAL_PAGE_URL,
    ENHANCED_CONFIG.COLUMNS.RHAC_PAGE,
    ENHANCED_CONFIG.COLUMNS.NUMBER,
  ];
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet(e) {
  return HtmlService.createTemplateFromFile("discovery")
    .evaluate()
    .setTitle("The Interact Hub")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function getDiscoveryInitialBootstrap() {
  const me = getActiveEmail_();
  const isEditor = isEditor_(me);

  return {
    me: me || "",
    isEditor,
    initial: listDiscoveryPage_({
      q: "",
      products: [],
      events: [],
      tdps: [],
      marketingPrograms: [],
      salesTactics: [],
      creatorNames: [],
      page: 1,
      pageSize: DISCOVERY_WEBAPP_CONFIG.PAGE_SIZE,
    }),
  };
}

function getDiscoveryFilterOptions() {
  return {
    filterOptions: getDiscoveryFilterOptions_(),
    synonymMap: DISCOVERY_SEARCH_SYNONYMS,
  };
}

function getDiscoveryBootstrap() {
  const me = getActiveEmail_();
  const isEditor = isEditor_(me);

  const sh = getMasterSheet_();
  const versionKey = getDiscoverySheetVersion_(sh);
  const cacheKey = "bootstrap:" + versionKey;

  let dataPayload = getScriptCacheJson_(cacheKey);
  if (!dataPayload) {
    const normalized = normalizeDiscoveryParams_({
      q: "",
      products: [],
      events: [],
      tdps: [],
      marketingPrograms: [],
      salesTactics: [],
      creatorNames: [],
      page: 1,
      pageSize: DISCOVERY_WEBAPP_CONFIG.PAGE_SIZE,
    });

    const bundle = getDiscoveryIndexBundle_();
    dataPayload = {
      initial: buildDiscoveryListResultFromBundle_(bundle, normalized),
      filterOptions: buildDiscoveryFilterOptionsFromBundle_(bundle),
    };
    putScriptCacheJson_(cacheKey, dataPayload, DISCOVERY_WEBAPP_CONFIG.INDEX_CACHE_SECONDS);
  }

  return {
    me: me || "",
    isEditor,
    initial: dataPayload.initial,
    filterOptions: dataPayload.filterOptions,
    synonymMap: DISCOVERY_SEARCH_SYNONYMS,
  };
}

function listDiscoveryPage(params) {
  return listDiscoveryPage_(params || {});
}

function getDiscoveryRecord(recordId) {
  const sh = getMasterSheet_();
  const headerMap = getHeaderMapFromSheet(sh, DISCOVERY_WEBAPP_CONFIG.HEADER_ROW);
  validateRequiredHeaders_(headerMap);

  const rowNumber = Number(recordId);
  if (
    !rowNumber ||
    rowNumber <= DISCOVERY_WEBAPP_CONFIG.HEADER_ROW ||
    rowNumber > sh.getLastRow()
  ) {
    throw new Error("Record not found.");
  }

  const row = sh.getRange(rowNumber, 1, 1, sh.getLastColumn()).getValues()[0];
  return buildDiscoveryRecordFromRow_(row, rowNumber, headerMap, sh);
}

function listDiscoveryPage_(params) {
  const normalized = normalizeDiscoveryParams_(params || {});

  const sh = getMasterSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow <= DISCOVERY_WEBAPP_CONFIG.HEADER_ROW) {
    return {
      totalRows: 0,
      page: normalized.page,
      pageSize: normalized.pageSize,
      totalPages: 0,
      items: [],
      tdpCounts: {},
    };
  }

  const versionKey = getDiscoverySheetVersion_(sh);
  const cacheKey =
    "list:" +
    versionKey +
    ":" +
    hashString_(JSON.stringify(normalized));

  const cached = getScriptCacheJson_(cacheKey);
  if (cached) return cached;

  const result = buildDiscoveryListResultFromBundle_(getDiscoveryIndexBundle_(), normalized);
  putScriptCacheJson_(cacheKey, result, DISCOVERY_WEBAPP_CONFIG.LIST_CACHE_SECONDS);
  return result;
}



function normalizeSearchText_(value) {
  if (value == null) return "";
  return String(value)
    .toLowerCase()
    .replace(/\u00A0/g, " ")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/&/g, " and ")
    .replace(/[\-_\/]+/g, " ")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSearchText_(value) {
  return normalizeSearchText_(value).replace(/[^a-z0-9]+/g, "");
}

function expandSearchTokenGroup_(token) {
  const normalized = normalizeSearchText_(token);
  const group = [];
  const add = function(value) {
    const v = normalizeSearchText_(value);
    if (v && group.indexOf(v) === -1) group.push(v);
  };

  add(normalized);

  const direct = DISCOVERY_SEARCH_SYNONYMS[normalized] || DISCOVERY_SEARCH_SYNONYMS[String(token || "").toLowerCase()];
  if (direct && direct.length) {
    for (let i = 0; i < direct.length; i++) add(direct[i]);
  }

  for (const key in DISCOVERY_SEARCH_SYNONYMS) {
    if (!DISCOVERY_SEARCH_SYNONYMS.hasOwnProperty(key)) continue;
    const values = DISCOVERY_SEARCH_SYNONYMS[key] || [];
    for (let i = 0; i < values.length; i++) {
      if (normalizeSearchText_(values[i]) === normalized) add(key);
    }
  }

  return group;
}

function buildSearchGroups_(tokens) {
  const groups = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    groups.push(expandSearchTokenGroup_(token));
  }
  return groups;
}

function searchGroupMatches_(blob, compactBlob, words, group) {
  for (let i = 0; i < group.length; i++) {
    const term = group[i];
    if (!term) continue;

    if (blob.indexOf(term) !== -1) return true;

    const compactTerm = compactSearchText_(term);
    if (compactTerm.length >= 3 && compactBlob.indexOf(compactTerm) !== -1) return true;

    if (term.length >= 3 && words && words.length) {
      for (let w = 0; w < words.length; w++) {
        if (words[w].indexOf(term) === 0) return true;
      }
    }
  }
  return false;
}


function addSearchIndexValue_(map, key, recordId) {
  key = String(key || "");
  if (!key || !recordId) return;
  if (!map[key]) map[key] = [];
  const id = String(recordId);
  if (map[key].indexOf(id) === -1) map[key].push(id);
}

function addSearchIndexToken_(searchIndex, token, recordId) {
  const normalized = normalizeSearchText_(token);
  if (!normalized || normalized.length < 2) return;

  addSearchIndexValue_(searchIndex.terms, normalized, recordId);

  if (normalized.length >= 3) {
    const maxPrefixLen = Math.min(14, normalized.length);
    for (let len = 3; len <= maxPrefixLen; len++) {
      addSearchIndexValue_(searchIndex.prefixes, normalized.slice(0, len), recordId);
    }
  }

  const compact = compactSearchText_(normalized);
  if (compact && compact !== normalized) {
    addSearchIndexValue_(searchIndex.terms, compact, recordId);
    const maxCompactPrefixLen = Math.min(14, compact.length);
    for (let len = 3; len <= maxCompactPrefixLen; len++) {
      addSearchIndexValue_(searchIndex.prefixes, compact.slice(0, len), recordId);
    }
  }
}

function addRecordToSearchIndex_(searchIndex, item, recordId) {
  if (!searchIndex || !item || !recordId) return;
  const seen = new Set();
  const words = [];
  const addWord = function(value) {
    const v = normalizeSearchText_(value);
    if (!v) return;
    const parts = v.split(/\s+/).filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (!seen.has(parts[i])) {
        seen.add(parts[i]);
        words.push(parts[i]);
      }
    }
  };

  addWord(item.searchBlob);
  addWord(item.titleSearchBlob);
  addWord(item.productSearchBlob);

  for (let i = 0; i < words.length; i++) {
    addSearchIndexToken_(searchIndex, words[i], recordId);
  }
}

function unionIdArrays_(arrays) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < arrays.length; i++) {
    const arr = arrays[i] || [];
    for (let j = 0; j < arr.length; j++) {
      const id = String(arr[j] || "");
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  return out.length ? out : null;
}

function getSearchIndexIdsForSingleToken_(searchIndex, token) {
  if (!searchIndex || !token) return null;
  const normalized = normalizeSearchText_(token);
  if (!normalized) return null;

  const compact = compactSearchText_(normalized);
  const arrays = [];
  if (searchIndex.terms && searchIndex.terms[normalized]) arrays.push(searchIndex.terms[normalized]);
  if (searchIndex.prefixes && searchIndex.prefixes[normalized]) arrays.push(searchIndex.prefixes[normalized]);
  if (compact && compact !== normalized) {
    if (searchIndex.terms && searchIndex.terms[compact]) arrays.push(searchIndex.terms[compact]);
    if (searchIndex.prefixes && searchIndex.prefixes[compact]) arrays.push(searchIndex.prefixes[compact]);
  }
  return unionIdArrays_(arrays);
}

function getSearchIndexIdsForTerm_(searchIndex, term) {
  const normalized = normalizeSearchText_(term);
  if (!normalized) return null;

  const direct = getSearchIndexIdsForSingleToken_(searchIndex, normalized);
  if (direct && direct.length) return direct;

  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return null;

  let ids = null;
  let hasAny = false;
  for (let i = 0; i < words.length; i++) {
    const tokenIds = getSearchIndexIdsForSingleToken_(searchIndex, words[i]);
    if (!tokenIds || !tokenIds.length) return null;
    ids = intersectCandidateIds_(ids, tokenIds);
    hasAny = true;
    if (ids && !ids.length) return [];
  }
  return hasAny ? ids : null;
}

function getSearchCandidateIds_(searchIndex, normalized) {
  if (!normalized || !normalized.q || !searchIndex) return null;

  // Fast path for hyphen/space variants: "multi layer" and "multi-layer" both become "multilayer".
  if (normalized.qCompact && normalized.qCompact.length >= 3) {
    const compactIds = getSearchIndexIdsForSingleToken_(searchIndex, normalized.qCompact);
    if (compactIds && compactIds.length) return compactIds;
  }

  const groups = normalized.qGroups || [];
  if (!groups.length) return null;

  let candidateIds = null;
  let usedAnyGroup = false;

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g] || [];
    const groupArrays = [];

    for (let i = 0; i < group.length; i++) {
      const ids = getSearchIndexIdsForTerm_(searchIndex, group[i]);
      if (ids && ids.length) groupArrays.push(ids);
    }

    const groupIds = unionIdArrays_(groupArrays);
    if (!groupIds || !groupIds.length) {
      // Return null instead of [] so the caller can fall back to the full scan.
      // This preserves substring search behavior for unusual queries.
      return null;
    }

    candidateIds = intersectCandidateIds_(candidateIds, groupIds);
    usedAnyGroup = true;
    if (candidateIds && !candidateIds.length) return [];
  }

  return usedAnyGroup ? candidateIds : null;
}

function matchesSearchQuery_(item, normalized) {
  if (!normalized || !normalized.q) return true;

  const blob = String(item.searchBlob || "");
  const compactBlob = String(item.searchCompact || "");
  const words = item.searchWords || [];
  const q = normalized.q;
  const qCompact = normalized.qCompact || "";

  if (blob.indexOf(q) !== -1) return true;
  if (qCompact.length >= 3 && compactBlob.indexOf(qCompact) !== -1) return true;

  const groups = normalized.qGroups || [];
  for (let g = 0; g < groups.length; g++) {
    if (!searchGroupMatches_(blob, compactBlob, words, groups[g])) return false;
  }
  return true;
}

function scoreSearchMatch_(item, normalized) {
  if (!normalized || !normalized.q) return 0;

  const titleBlob = String(item.titleSearchBlob || normalizeSearchText_(item.title || ""));
  const productBlob = String(item.productSearchBlob || normalizeSearchText_(item.product || ""));
  const allBlob = String(item.searchBlob || "");
  const compactTitle = compactSearchText_(titleBlob);
  const compactProduct = compactSearchText_(productBlob);
  const compactAll = String(item.searchCompact || "");
  const groups = normalized.qGroups || [];
  let score = 0;

  for (let g = 0; g < groups.length; g++) {
    const group = groups[g];
    let best = 0;

    for (let i = 0; i < group.length; i++) {
      const term = group[i];
      const compactTerm = compactSearchText_(term);

      if (titleBlob.indexOf(term) !== -1) best = Math.max(best, 20);
      else if (compactTerm.length >= 3 && compactTitle.indexOf(compactTerm) !== -1) best = Math.max(best, 18);

      if (productBlob.indexOf(term) !== -1) best = Math.max(best, 10);
      else if (compactTerm.length >= 3 && compactProduct.indexOf(compactTerm) !== -1) best = Math.max(best, 8);

      if (allBlob.indexOf(term) !== -1) best = Math.max(best, 4);
      else if (compactTerm.length >= 3 && compactAll.indexOf(compactTerm) !== -1) best = Math.max(best, 3);
    }

    score += best;
  }

  if (normalized.q && titleBlob.indexOf(normalized.q) !== -1) score += 25;
  if (normalized.qCompact && normalized.qCompact.length >= 3 && compactTitle.indexOf(normalized.qCompact) !== -1) score += 18;

  return score;
}

function stripDiscoveryInternalFields_(item) {
  const out = {};
  for (const key in item) {
    if (!item.hasOwnProperty(key)) continue;
    if (
      key === "searchBlob" ||
      key === "searchCompact" ||
      key === "searchWords" ||
      key === "titleSearchBlob" ||
      key === "productSearchBlob" ||
      key === "_relevanceScore"
    ) {
      continue;
    }
    out[key] = item[key];
  }
  return out;
}

function buildDiscoveryFilterOptionsFromBundle_(bundle) {
  const index = (bundle && bundle.index) || [];
  const sets = {
    products: new Set(),
    events: new Set(),
    tdps: new Set(),
    marketingPrograms: new Set(),
    salesTactics: new Set(),
    creatorNames: new Set(),
    formats: new Set(),
  };

  for (let i = 0; i < index.length; i++) {
    const item = index[i];
    addIf_(sets.products, item.product);
    addIf_(sets.events, item.event);
    addIf_(sets.tdps, item.tdp);
    addIf_(sets.marketingPrograms, item.marketingProgram);
    addIf_(sets.salesTactics, item.salesTactic);
    addIf_(sets.creatorNames, item.creatorNameClean);
    addIf_(sets.formats, item.format);
  }

  return {
    products: [...sets.products].sort(),
    events: [...sets.events].sort(),
    tdps: [...sets.tdps].sort(),
    marketingPrograms: [...sets.marketingPrograms].sort(),
    salesTactics: [...sets.salesTactics].sort(),
    creatorNames: [...sets.creatorNames].sort(),
    formats: [...sets.formats].sort(),
  };
}

function buildDiscoveryListResultFromBundle_(bundle, normalized) {
  const q = normalized.q;
  const products = normalized.products;
  const events = normalized.events;
  const tdps = normalized.tdps;
  const marketingPrograms = normalized.marketingPrograms;
  const salesTactics = normalized.salesTactics;
  const creatorNames = normalized.creatorNames;
  const formats = normalized.formats;
  const page = normalized.page;
  const pageSize = normalized.pageSize;

  const facetMaps = (bundle && bundle.facetMaps) || {};
  const recordMap = (bundle && bundle.recordMap) || {};
  const sortedRecordIds = (bundle && bundle.sortedRecordIds) || [];
  const searchIndex = (bundle && bundle.searchIndex) || null;

  let candidateIds = null;
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.products, products));
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.events, events));
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.tdps, tdps));
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.marketingPrograms, marketingPrograms));
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.salesTactics, salesTactics));
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.creatorNames, creatorNames));
  candidateIds = intersectCandidateIds_(candidateIds, getFacetRecordIds_(facetMaps.formats, formats));

  if (q) {
    const searchCandidateIds = getSearchCandidateIds_(searchIndex, normalized);
    candidateIds = intersectCandidateIds_(candidateIds, searchCandidateIds);
  }

  const candidateRecordIds = candidateIds ? candidateIds : sortedRecordIds;
  const matched = [];

  for (let i = 0; i < candidateRecordIds.length; i++) {
    const recordId = String(candidateRecordIds[i] || "");
    if (!recordId) continue;

    const item = recordMap[recordId];
    if (!item) continue;
    if (q && !matchesSearchQuery_(item, normalized)) continue;

    matched.push(item);
  }

  if (q) {
    for (let i = 0; i < matched.length; i++) {
      matched[i]._relevanceScore = scoreSearchMatch_(matched[i], normalized);
    }
    matched.sort(function(a, b) {
      const ar = Number(a._relevanceScore || 0);
      const br = Number(b._relevanceScore || 0);
      if (ar !== br) return br - ar;
      const ap = Number(a.sortPriority || 99);
      const bp = Number(b.sortPriority || 99);
      if (ap !== bp) return ap - bp;
      var ta = a.sortTs ? new Date(a.sortTs).getTime() : 0;
      var tb = b.sortTs ? new Date(b.sortTs).getTime() : 0;
      if (ta || tb) return (tb || 0) - (ta || 0);
      return (Number(b.number) || 0) - (Number(a.number) || 0);
    });
  }

  const tdpCounts = {};
  for (let i = 0; i < matched.length; i++) {
    const key = matched[i].tdp || "Other";
    tdpCounts[key] = (tdpCounts[key] || 0) + 1;
  }

  const totalRows = matched.length;
  const totalPages = Math.ceil(totalRows / pageSize);
  const start = (page - 1) * pageSize;
  const items = matched.slice(start, start + pageSize).map(stripDiscoveryInternalFields_);

  return {
    totalRows,
    page,
    pageSize,
    totalPages,
    items,
    tdpCounts,
  };
}

function getFacetRecordIds_(facetMap, selectedValues) {
  if (!selectedValues || !selectedValues.length) return null;
  const merged = new Set();
  for (let i = 0; i < selectedValues.length; i++) {
    const key = normalizeText_(selectedValues[i]);
    const ids = facetMap && facetMap[key] ? facetMap[key] : [];
    for (let j = 0; j < ids.length; j++) merged.add(String(ids[j]));
  }
  return [...merged];
}

function intersectCandidateIds_(baseIds, nextIds) {
  if (!nextIds) return baseIds;
  if (!baseIds) return nextIds;
  const nextSet = new Set(nextIds.map(String));
  const out = [];
  for (let i = 0; i < baseIds.length; i++) {
    const id = String(baseIds[i]);
    if (nextSet.has(id)) out.push(id);
  }
  return out;
}

function getDiscoveryFilterOptions_(bundleOpt) {
  const sh = getMasterSheet_();
  const versionKey = getDiscoverySheetVersion_(sh);
  const cacheKey = "filterOptions:" + versionKey;
  const cached = getScriptCacheJson_(cacheKey);
  if (cached) return cached;

  const bundle = bundleOpt || getDiscoveryIndexBundle_();
  const result = buildDiscoveryFilterOptionsFromBundle_(bundle);
  putScriptCacheJson_(cacheKey, result, DISCOVERY_WEBAPP_CONFIG.FILTER_OPTIONS_CACHE_SECONDS);
  return result;
}

function combineUniqueProducts_(primaryProduct, relatedProducts) {
  const seen = new Set();
  const merged = [];

  [primaryProduct, relatedProducts]
    .filter(Boolean)
    .forEach(value => {
      String(value)
        .split(",")
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(item => {
          const key = item.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(item);
          }
        });
    });

  return merged.join(", ");
}

function combineUniqueTopics_(primaryTopic, relatedTopics) {
  const seen = new Set();
  const merged = [];

  [primaryTopic, relatedTopics]
    .filter(Boolean)
    .forEach(value => {
      String(value)
        .split(",")
        .map(v => v.trim())
        .filter(Boolean)
        .forEach(item => {
          const key = item.toLowerCase();
          if (!seen.has(key)) {
            seen.add(key);
            merged.push(item);
          }
        });
    });

  return merged.join(", ");
}
function buildDiscoveryRecordFromRow_(row, rowNumber, headerMap, sheetOrLinkContext) {
  const get = (name) => {
    const idx = headerMap[name];
    return idx == null ? "" : normalizeValueForUi_(row[idx]);
  };

  const getUrl = (name) => {
    const idx = headerMap[name];
    if (idx == null) return "";

    if (sheetOrLinkContext && typeof sheetOrLinkContext.getRange === "function") {
      return extractUrlFromCell_(sheetOrLinkContext.getRange(rowNumber, idx + 1));
    }

    if (sheetOrLinkContext && sheetOrLinkContext.linkOverrides) {
      const override = sheetOrLinkContext.linkOverrides[idx];
      if (override) return ensureHttps_(override);
    }

    return ensureHttps_(normalizeValueForUi_(row[idx]));
  };

  const COL = ENHANCED_CONFIG.COLUMNS;

  const status = normalizeStatusCanonical(get(COL.STATUS));
  const publishStates = get(COL.PUBLISH_STATES);

  const finalTitle = get(COL.FINAL_DEMO_TITLE);
  const suggestedTitle = get(COL.SUGGESTED_TITLE);
  const title = finalTitle || suggestedTitle || get("Video Title") || "Untitled";

  const primaryProduct = get(COL.PRIMARY_PRODUCT);
  const relatedProducts = get(COL.PRODUCT);
  const combinedProducts = combineUniqueProducts_(primaryProduct, relatedProducts);

  const primaryTopic = get(COL.PRIMARY_TOPIC);
  const relatedTopics = get(COL.TOPIC);
  const combinedTopics = combineUniqueTopics_(primaryTopic, relatedTopics);

  const eventName = get(COL.EVENT);
  const tdp = get(COL.TDP);
  const marketingProgram = get(COL.MARKETING_PROGRAM);
  const salesTactic = get(COL.SALES_TACTIC);
  const description = get(COL.DEMO_DESCRIPTION) || get(COL.CONTEXT_DESC);
  const personas = get(COL.PERSONAS);
  const language = get(COL.LANGUAGE);
  const duration = get(COL.DURATION);
  const creatorName = get(COL.CREATOR_NAME);
  const creatorTeam = get(COL.CREATOR_TEAM);
  const creatorEmail = get(COL.CREATOR_EMAIL);
  const globalId = get(COL.GLOBAL_ID);
  const verticals = get(COL.VERTICALS);
  const originType = get(COL.ORIGIN_TYPE);
  const itemNumber = Number(get(COL.NUMBER)) || 0;

  const productionLink = ensureHttps_(extractLastLine_(get(COL.PROD_ARCADE_LINK)));
  const drupalPageUrl = getUrl(COL.DRUPAL_PAGE_URL);
  const rhacPage = getUrl(COL.RHAC_PAGE);
  const ctaLink = getUrl(COL.CTA_LINK);
  const creationLink = ensureHttps_(extractLastLine_(get(COL.CREATION_LINK))) || (get("YouTube Video ID") ? 'https://www.youtube.com/watch?v=' + get("YouTube Video ID") : '');

  const _linkBlob = (productionLink + ' ' + creationLink).toLowerCase();
  const format = /youtu\.be|youtube\.com/.test(_linkBlob) ? 'Video Demo'
    : /interact\.redhat\.com|app\.arcade\.software/.test(_linkBlob) ? 'Interactive Demo'
    : /interactive[\-\s]?lab|demo\.redhat\.com/.test(_linkBlob) ? 'Lab'
    : '';

  const featuredStart = parseDateSafe_(get(COL.FEATURED_START_DATE));
  const featuredEnd = parseDateSafe_(get(COL.FEATURED_END_DATE));
  const latestStart = parseDateSafe_(get(COL.LATEST_START_DATE));
  const latestEnd = parseDateSafe_(get(COL.LATEST_END_DATE));

  const isReadyToUse = computeIsReadyToUse_(
    status,
    productionLink,
    drupalPageUrl,
    rhacPage
  );

  const isDiscoverable = computeIsDiscoverable_(status, isReadyToUse);

  const discoverStatus = computeDiscoverStatus_(
    status,
    publishStates,
    featuredStart,
    featuredEnd,
    latestStart,
    latestEnd,
    new Date()
  );

  const searchText = [
    title,
    combinedProducts,
    eventName,
    tdp,
    marketingProgram,
    salesTactic,
    description,
    personas,
    language,
    creatorName,
    creatorTeam,
    globalId,
    verticals,
  ]
    .filter(Boolean)
    .join(" | ");

  const creatorNameClean = cleanCreatorName_(creatorName);
  const rawSearchBlob = [
    title,
    combinedProducts,
    eventName,
    tdp,
    marketingProgram,
    salesTactic,
    description,
    personas,
    language,
    creatorName,
    creatorTeam,
    globalId,
    verticals,
    searchText,
  ]
    .filter(Boolean)
    .join(" ");

  const searchBlob = normalizeSearchText_(rawSearchBlob);
  const searchCompact = compactSearchText_(rawSearchBlob);
  const searchWords = searchBlob.split(/\s+/).filter(Boolean);
  const titleSearchBlob = normalizeSearchText_(title);
  const productSearchBlob = normalizeSearchText_(combinedProducts);

  const sortPriority = getDiscoverySortPriority_(discoverStatus);
  const sortTs = get(COL.STATUS_PUBLISHED_TS) || get(COL.STATUS_RECEIVED_TS) || '';

  return {
    recordId: String(rowNumber),
    number: itemNumber,
    sortTs,
    title,
    discoverStatus,
    isDiscoverable,
    isReadyToUse,

    // Keep these for flexibility
    primaryProduct,
    secondaryProduct: relatedProducts,
    primaryTopic,
    secondaryTopic: relatedTopics,

    // Keep "product" as the combined display/search value
    product: combinedProducts,
    topic: combinedTopics,

    event: eventName,
    tdp,
    marketingProgram,
    salesTactic,
    description,
    personas,
    language,
    creatorName,
    creatorNameClean,
    creatorTeam,
    creatorEmail,
    globalId,
    productionLink,
    drupalPageUrl,
    rhacPage,
    ctaLink,
    creationLink,
    verticals,
    duration,
    format,
    searchText,
    searchBlob,
    searchCompact,
    searchWords,
    titleSearchBlob,
    productSearchBlob,
    sortPriority,
  };
}

/* helpers */

function getMasterSheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    DISCOVERY_WEBAPP_CONFIG.MASTER_SHEET
  );
  if (!sh) {
    throw new Error(`Sheet "${DISCOVERY_WEBAPP_CONFIG.MASTER_SHEET}" not found.`);
  }
  return sh;
}
function getDiscoveryIndex_() {
  return getDiscoveryIndexBundle_().index;
}

function getDiscoveryFacetMaps_() {
  return getDiscoveryIndexBundle_().facetMaps;
}

function getDiscoveryIndexBundle_() {
  const sh = getMasterSheet_();
  const lastRow = sh.getLastRow();
  if (lastRow <= DISCOVERY_WEBAPP_CONFIG.HEADER_ROW) {
    return {
      index: [],
      facetMaps: {
        products: {},
        events: {},
        tdps: {},
        marketingPrograms: {},
        salesTactics: {},
        creatorNames: {},
        formats: {},
      },
      recordMap: {},
      sortedRecordIds: [],
      searchIndex: {
        terms: {},
        prefixes: {},
      },
    };
  }

  const versionKey = getDiscoverySheetVersion_(sh);
  try {
    var cache = CacheService.getScriptCache();
    if (cache.get("DISCOVERY_DIRTY")) {
      cache.remove("DISCOVERY_DIRTY");
      DISCOVERY_RUNTIME_MEMO.versionKey = "";
      DISCOVERY_RUNTIME_MEMO.bundle = null;
    }
  } catch (err) {}
  if (DISCOVERY_RUNTIME_MEMO.versionKey === versionKey && DISCOVERY_RUNTIME_MEMO.bundle) {
    return DISCOVERY_RUNTIME_MEMO.bundle;
  }

  const headerMap = getHeaderMapFromSheet(sh, DISCOVERY_WEBAPP_CONFIG.HEADER_ROW);
  validateRequiredHeaders_(headerMap);
  const lastCol = sh.getLastColumn();
  const rowCount = lastRow - DISCOVERY_WEBAPP_CONFIG.HEADER_ROW;
  const range = sh.getRange(
    DISCOVERY_WEBAPP_CONFIG.HEADER_ROW + 1,
    1,
    rowCount,
    lastCol
  );
  const data = range.getDisplayValues();
  const linkOverridesByRow = getDiscoveryLinkOverridesForRange_(range, headerMap, data);

  var statusColIdx = headerMap[ENHANCED_CONFIG.COLUMNS.STATUS];
  var validRowSet = null;
  if (statusColIdx !== undefined && statusColIdx !== null) {
    validRowSet = new Set();
    for (var si = 0; si < data.length; si++) {
      var rawStatus = String(data[si][statusColIdx] || "").trim().toLowerCase().replace(/\s+/g, " ");
      if (rawStatus === "published" || rawStatus === "demo published" || rawStatus === "ie published" || rawStatus === "demo reviewed" || rawStatus === "ie reviewed") {
        validRowSet.add(si);
      }
    }
  }

  const index = [];
  const recordMap = {};
  const facetMaps = {
    products: {},
    events: {},
    tdps: {},
    marketingPrograms: {},
    salesTactics: {},
    creatorNames: {},
    formats: {},
  };
  const searchIndex = {
    terms: {},
    prefixes: {},
  };

  for (let i = 0; i < data.length; i++) {
    if (validRowSet && !validRowSet.has(i)) continue;
    const rowNumber = DISCOVERY_WEBAPP_CONFIG.HEADER_ROW + 1 + i;
    const item = buildDiscoveryRecordFromRow_(data[i], rowNumber, headerMap, {
      linkOverrides: linkOverridesByRow[i] || {},
    });
    if (!item.isDiscoverable) continue;

    index.push(item);
    const recordId = String(item.recordId || "");
    recordMap[recordId] = item;
    addRecordToFacetMap_(facetMaps.products, item.product, recordId);
    addRecordToFacetMap_(facetMaps.events, item.event, recordId);
    addRecordToFacetMap_(facetMaps.tdps, item.tdp, recordId);
    addRecordToFacetMap_(facetMaps.marketingPrograms, item.marketingProgram, recordId);
    addRecordToFacetMap_(facetMaps.salesTactics, item.salesTactic, recordId);
    addRecordToFacetMap_(facetMaps.creatorNames, item.creatorNameClean, recordId);
    addRecordToFacetMap_(facetMaps.formats, item.format, recordId);
    addRecordToSearchIndex_(searchIndex, item, recordId);
  }

  var ytSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("YouTube_Responses");
  if (ytSheet && ytSheet.getLastRow() > 1) {
    var ytHeaderMap = getHeaderMapFromSheet(ytSheet, 1);
    var ytLastRow = ytSheet.getLastRow();
    var ytLastCol = ytSheet.getLastColumn();
    var ytData = ytSheet.getRange(2, 1, ytLastRow - 1, ytLastCol).getDisplayValues();
    var ytStatusIdx = ytHeaderMap[ENHANCED_CONFIG.COLUMNS.STATUS];

    for (var yi = 0; yi < ytData.length; yi++) {
      if (ytStatusIdx != null) {
        var ytStatus = String(ytData[yi][ytStatusIdx] || "").trim().toLowerCase().replace(/\s+/g, " ");
        if (ytStatus !== "published" && ytStatus !== "demo published" && ytStatus !== "demo reviewed") continue;
      }
      var ytRowNumber = 2 + yi;
      var ytItem = buildDiscoveryRecordFromRow_(ytData[yi], ytRowNumber, ytHeaderMap, { linkOverrides: {} });
      if (!ytItem.productionLink && ytItem.creationLink) {
        ytItem.productionLink = ytItem.creationLink;
        ytItem.isReadyToUse = true;
        ytItem.isDiscoverable = true;
      }
      if (!ytItem.isDiscoverable) continue;

      var ytRecordId = "yt-" + ytRowNumber;
      ytItem.recordId = ytRecordId;
      index.push(ytItem);
      recordMap[ytRecordId] = ytItem;
      addRecordToFacetMap_(facetMaps.products, ytItem.product, ytRecordId);
      addRecordToFacetMap_(facetMaps.events, ytItem.event, ytRecordId);
      addRecordToFacetMap_(facetMaps.tdps, ytItem.tdp, ytRecordId);
      addRecordToFacetMap_(facetMaps.marketingPrograms, ytItem.marketingProgram, ytRecordId);
      addRecordToFacetMap_(facetMaps.salesTactics, ytItem.salesTactic, ytRecordId);
      addRecordToFacetMap_(facetMaps.creatorNames, ytItem.creatorNameClean, ytRecordId);
      addRecordToFacetMap_(facetMaps.formats, ytItem.format, ytRecordId);
      addRecordToSearchIndex_(searchIndex, ytItem, ytRecordId);
    }
  }

  index.sort(compareDiscoveryItems_);

  const bundle = {
    index,
    facetMaps,
    recordMap,
    sortedRecordIds: index.map(function(item) {
      return String(item.recordId || "");
    }),
    searchIndex,
  };

  DISCOVERY_RUNTIME_MEMO.versionKey = versionKey;
  DISCOVERY_RUNTIME_MEMO.bundle = bundle;
  return bundle;
}

function addRecordToFacetMap_(facetMap, rawValue, recordId) {
  const key = normalizeText_(rawValue);
  if (!key || !recordId) return;
  if (!facetMap[key]) facetMap[key] = [];
  facetMap[key].push(String(recordId));
}

function getDiscoverySheetVersion_(sheet) {
  const props = PropertiesService.getDocumentProperties();
  const version = props.getProperty("DISCOVERY_DATA_VERSION") || "1";
  var ytRows = 0;
  try {
    var yt = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("YouTube_Responses");
    if (yt) ytRows = yt.getLastRow();
  } catch (_) {}
  return [DISCOVERY_CACHE_SCHEMA_VERSION, sheet.getSheetId(), sheet.getLastRow(), sheet.getLastColumn(), version, ytRows].join(":");
}

function bumpDiscoveryDataVersion_() {
  PropertiesService.getDocumentProperties().setProperty(
    "DISCOVERY_DATA_VERSION",
    String(Date.now())
  );
}

function forceInvalidateDiscoveryCache() {
  bumpDiscoveryDataVersion_();
  try { CacheService.getScriptCache().remove("DISCOVERY_DIRTY"); } catch (_) {}
  DISCOVERY_RUNTIME_MEMO.versionKey = "";
  DISCOVERY_RUNTIME_MEMO.bundle = null;
  console.log("Discovery cache invalidated");
}

function getDiscoveryLinkOverridesForRange_(range, headerMap, displayData) {
  const rowCount = range.getNumRows();
  const overrides = Array.from({ length: rowCount }, () => ({}));
  const linkHeaders = [
    ENHANCED_CONFIG.COLUMNS.PROD_ARCADE_LINK,
    ENHANCED_CONFIG.COLUMNS.DRUPAL_PAGE_URL,
    ENHANCED_CONFIG.COLUMNS.RHAC_PAGE,
    ENHANCED_CONFIG.COLUMNS.CTA_LINK,
  ];

  const linkCols = [];
  for (const header of linkHeaders) {
    const idx = headerMap[header];
    if (idx != null) linkCols.push(idx);
  }
  if (!linkCols.length) return overrides;

  const allFormulas = range.getFormulas();

  for (let r = 0; r < rowCount; r++) {
    for (const idx of linkCols) {
      const formula = allFormulas[r][idx] || "";
      const displayValue = displayData[r][idx] || "";
      let url = "";

      if (formula && /^=HYPERLINK\(/i.test(formula)) {
        const m = formula.match(/^=HYPERLINK\(\s*"([^"]+)"\s*[,;]\s*/i);
        if (m && m[1]) url = m[1];
      } else if (/^https?:\/\//i.test(displayValue) || (!/\s/.test(displayValue) && /\./.test(displayValue))) {
        url = displayValue;
      }

      overrides[r][idx] = ensureHttps_(url);
    }
  }

  return overrides;
}

function normalizeDiscoveryParams_(params) {
  const q = normalizeSearchText_(params.q || "");
  const qTokens = q ? q.split(/\s+/).filter(Boolean) : [];

  return {
    q: q,
    qTokens: qTokens,
    qGroups: buildSearchGroups_(qTokens),
    qCompact: compactSearchText_(q),
    products: normalizeArray_(params.products).sort(),
    events: normalizeArray_(params.events).sort(),
    tdps: normalizeArray_(params.tdps).sort(),
    marketingPrograms: normalizeArray_(params.marketingPrograms).sort(),
    salesTactics: normalizeArray_(params.salesTactics).sort(),
    creatorNames: normalizeArray_(params.creatorNames).sort(),
    formats: normalizeArray_(params.formats).sort(),
    page: Math.max(1, Number(params.page || 1)),
    pageSize: Math.max(1, Number(params.pageSize || DISCOVERY_WEBAPP_CONFIG.PAGE_SIZE)),
  };
}

function getScriptCacheJson_(key) {
  try {
    const raw = CacheService.getScriptCache().get(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function putScriptCacheJson_(key, value, seconds) {
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(value), seconds);
  } catch (e) {}
}

function hashString_(input) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5,
    String(input),
    Utilities.Charset.UTF_8
  );
  return bytes
    .map(function(b) {
      const v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? "0" + v : v;
    })
    .join("");
}

function normalizeArray_(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map(normalizeText_).filter(Boolean);
}

function matchesMultiSelect_(value, selectedValues) {
  if (!selectedValues || !selectedValues.length) return true;
  return selectedValues.includes(normalizeText_(value));
}

function addIf_(setObj, value) {
  const v = normalizeText_(value);
  if (v) setObj.add(v);
}

function normalizeValueForUi_(v) {
  if (v == null) return "";
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(v).trim();
}

function normalizeText_(value) {
  if (value == null) return "";
  return String(value).replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
}

function cleanCreatorName_(value) {
  return normalizeText_(value).replace(/[\n\r\t]+/g, " ").trim();
}


function validateRequiredHeaders_(headerMap) {
  const missing = getDiscoveryRequiredHeaders_().filter((name) => headerMap[name] == null);
  if (missing.length) {
    throw new Error("Missing required sheet columns: " + missing.join(", "));
  }
}

function extractUrlFromCell_(range) {
  if (!range) return "";

  try {
    const rt = range.getRichTextValue();
    if (rt) {
      const whole = rt.getLinkUrl();
      if (whole) return ensureHttps_(whole);

      const runs = rt.getRuns ? rt.getRuns() : [];
      for (const run of runs) {
        const u = run.getLinkUrl && run.getLinkUrl();
        if (u) return ensureHttps_(u);
      }
    }
  } catch (e) {}

  try {
    const formula = range.getFormula();
    if (formula && /^=HYPERLINK\(/i.test(formula)) {
      const m = formula.match(/^=HYPERLINK\(\s*"([^"]+)"\s*[,;]\s*/i);
      if (m && m[1]) return ensureHttps_(m[1]);
    }
  } catch (e) {}

  try {
    const v = range.getValue();
    if (typeof v === "string" && v.trim()) return ensureHttps_(v);
  } catch (e) {}

  try {
    return ensureHttps_(range.getDisplayValue());
  } catch (e) {
    return "";
  }
}

function ensureHttps_(s) {
  const t = normalizeText_(s);
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (!/\s/.test(t) && t.includes(".")) return "https://" + t;
  return t;
}



function computeIsReadyToUse_(status, productionLink, drupalPageUrl, rhacPage) {
  const canonical = normalizeStatusCanonical(status);
  if (canonical !== ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED && canonical !== ENHANCED_CONFIG.STATUS.DEMO_REVIEWED) return false;
  return !!(productionLink || drupalPageUrl || rhacPage);
}

function computeIsDiscoverable_(status, isReadyToUse) {
  const canonical = normalizeStatusCanonical(status);
  return (canonical === ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED || canonical === ENHANCED_CONFIG.STATUS.DEMO_REVIEWED) && !!isReadyToUse;
}

function compareDiscoveryItems_(a, b) {
  const sa = Number(a.sortPriority || 99);
  const sb = Number(b.sortPriority || 99);

  if (sa !== sb) return sa - sb;

  var ta = a.sortTs ? new Date(a.sortTs).getTime() : 0;
  var tb = b.sortTs ? new Date(b.sortTs).getTime() : 0;
  if (ta || tb) return (tb || 0) - (ta || 0);

  return (Number(b.number) || 0) - (Number(a.number) || 0);
}

function getDiscoverySortPriority_(discoverStatus) {
  const order = {
    "Featured + Latest": 1,
    "Featured": 1,
  };
  return order[discoverStatus] || 99;
}
function computeDiscoverStatus_(
  status,
  publishStates,
  featuredStart,
  featuredEnd,
  latestStart,
  latestEnd,
  todayRaw
) {
  const canonical = normalizeStatusCanonical(status);
  if (canonical !== ENHANCED_CONFIG.STATUS.DEMO_PUBLISHED && canonical !== ENHANCED_CONFIG.STATUS.DEMO_REVIEWED) return "";

  const today = stripTime_(todayRaw);
  const inFeatured = isDateInWindow_(today, featuredStart, featuredEnd);
  const inLatest = isDateInWindow_(today, latestStart, latestEnd);

  if (inFeatured && inLatest) return "Featured + Latest";
  if (inFeatured) return "Featured";
  if (inLatest) return "Latest";

  const p = normalizeText_(publishStates).toLowerCase();
  if (p.includes("featured") && p.includes("latest")) return "Featured + Latest";
  if (p.includes("featured")) return "Featured";
  if (p.includes("latest")) return "Latest";

  return "";
}
function parseDateSafe_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return stripTime_(value);

  const text = normalizeText_(value);
  if (!text) return null;

  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (ymd) {
    const y = Number(ymd[1]);
    const m = Number(ymd[2]) - 1;
    const d = Number(ymd[3]);
    const dt = new Date(y, m, d);

    if (dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d) {
      return dt;
    }
  }

  const parsed = new Date(text);
  if (isNaN(parsed.getTime())) return null;
  return stripTime_(parsed);
}

function stripTime_(dateObj) {
  return new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
}

function isDateInWindow_(dateValue, startDate, endDate) {
  if (!startDate || !endDate) return false;
  return startDate.getTime() <= dateValue.getTime() && dateValue.getTime() <= endDate.getTime();
}

function getActiveEmail_() {
  try {
    return Session.getActiveUser().getEmail() || "";
  } catch (e) {
    return "";
  }
}

function isEditor_(email) {
  const prop =
    PropertiesService.getScriptProperties().getProperty(
      DISCOVERY_WEBAPP_CONFIG.EDITORS_PROP_KEY
    ) || "";

  const allowed = prop
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return !!email && allowed.includes(email.toLowerCase());
}

// =============================================================================
// 🆕 NEW EMAIL & ANALYTICS FUNCTIONS (ADD THESE TO YOUR EXISTING SCRIPT)
// =============================================================================

/**
 * Records analytics events to a Google Sheets analytics sheet
 * Called when users search, select cards, export, etc.
 */
function recordAnalyticsEvent(eventData) {
  try {
    const sheet = getAnalyticsSheet();
    const user = eventData.user || Session.getActiveUser().getEmail() || "";

    var KNOWN_KEYS = {
      timestamp:1, type:1, recordId:1, title:1, product:1,
      tdp:1, creator:1, query:1, sessionId:1, user:1
    };
    var extra = {};
    Object.keys(eventData).forEach(function(k) {
      if (!KNOWN_KEYS[k] && eventData[k] !== "" && eventData[k] !== undefined) {
        extra[k] = eventData[k];
      }
    });
    var details = Object.keys(extra).length ? JSON.stringify(extra) : "";

    sheet.appendRow([
      eventData.timestamp || new Date().toISOString(),
      eventData.type || "unknown",
      eventData.recordId || "",
      eventData.title || "",
      eventData.product || "",
      eventData.tdp || "",
      eventData.creator || "",
      eventData.query || "",
      eventData.sessionId || "",
      user,
      details
    ]);

    return { success: true };
  } catch (error) {
    console.error("Analytics recording failed:", error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Gets or creates the Analytics sheet in the connected spreadsheet
 * Creates headers automatically if sheet doesn't exist
 */
function getAnalyticsSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName("Analytics");
  
  if (!sheet) {
    sheet = spreadsheet.insertSheet("Analytics");
    // Add enhanced headers
    sheet.getRange(1, 1, 1, 11).setValues([[
      "Timestamp", "Event Type", "Record ID", "Arcade Name", "Product",
      "TDP", "Creator", "Search Query",
      "Session ID", "User Email", "Details"
    ]]);

    // Format the header row
    const headerRange = sheet.getRange(1, 1, 1, 11);
    headerRange.setFontWeight("bold");
    headerRange.setBackground("#4285f4");
    headerRange.setFontColor("white");
  }
  
  return sheet;
}
function sanitizeEmailText_(value, maxLen) {
  const text = normalizeText_(value);
  return text ? text.slice(0, maxLen || DISCOVERY_WEBAPP_CONFIG.MAX_EMAIL_TEXT_LENGTH) : "";
}

function sanitizeEmailAddress_(value, { allowBlank = false } = {}) {
  const email = normalizeText_(value).toLowerCase();
  if (!email) {
    if (allowBlank) return "";
    throw new Error("Email is required.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Invalid email format.");
  }

  if (DISCOVERY_WEBAPP_CONFIG.ALLOWED_EMAIL_DOMAINS.length) {
    const domain = email.split("@")[1] || "";
    if (!DISCOVERY_WEBAPP_CONFIG.ALLOWED_EMAIL_DOMAINS.includes(domain)) {
      throw new Error("Email domain is not allowed.");
    }
  }

  return email;
}

function sanitizeRecordsForEmail_(records) {
  const list = Array.isArray(records)
    ? records.slice(0, DISCOVERY_WEBAPP_CONFIG.MAX_SELECTED_RECORDS_EMAIL)
    : [];
  return list.map((record) => ({
    title: sanitizeEmailText_(record && record.title, 200),
    product: sanitizeEmailText_(record && record.product, 120),
    tdp: sanitizeEmailText_(record && record.tdp, 160),
    marketingProgram: sanitizeEmailText_(record && record.marketingProgram, 160),
    salesTactic: sanitizeEmailText_(record && record.salesTactic, 160),
    creatorName: sanitizeEmailText_(record && record.creatorName, 120),
    rhacPage: ensureHttps_(record && record.rhacPage),
    drupalPageUrl: ensureHttps_(record && record.drupalPageUrl),
    productionLink: ensureHttps_(record && record.productionLink),
  }));
}

function enforceRateLimit_(bucket) {
  const cache = CacheService.getScriptCache();
  const email = sanitizeEmailAddress_(getActiveEmail_(), { allowBlank: true }) || "anonymous";
  const key = "ratelimit:" + bucket + ":" + hashString_(email);
  const current = Number(cache.get(key) || 0);
  if (current >= DISCOVERY_WEBAPP_CONFIG.MAX_REQUESTS_PER_WINDOW) {
    throw new Error("Too many requests. Please wait a few minutes and try again.");
  }
  cache.put(key, String(current + 1), DISCOVERY_WEBAPP_CONFIG.RATE_LIMIT_WINDOW_SECONDS);
}


/**
 * Sends event package requests with selected arcades to yunjyang@redhat.com
 * Called when users request an event package with their selected arcades
 */
function sendEventPackageRequest(emailData) {
  try {
    enforceRateLimit_("event_request");

    const eventName = sanitizeEmailText_(emailData && emailData.eventName, 160);
    const eventDateRange = sanitizeEmailText_(emailData && emailData.eventDateRange, 120);
    const contactEmail = sanitizeEmailAddress_(emailData && emailData.contactEmail);
    const contactName = sanitizeEmailText_(emailData && emailData.contactName, 120);
    const eventNotes = sanitizeEmailText_(emailData && emailData.eventNotes, 2000);
    const ccEmail = sanitizeEmailAddress_(emailData && emailData.ccEmail, { allowBlank: true });
    const selectedRecords = sanitizeRecordsForEmail_(emailData && emailData.selectedRecords);

    if (!eventName) throw new Error("Event name is required.");
    if (!eventDateRange) throw new Error("Event date range is required.");
    if (!contactName) throw new Error("Contact name is required.");
    if (!selectedRecords.length) throw new Error("Please select at least one arcade.");

    const subject = `Event Package Request - ${eventName} (${selectedRecords.length} Arcade${selectedRecords.length !== 1 ? "s" : ""})`;
    const arcadeList = selectedRecords.map((record, index) => {
      const primaryLink = record.drupalPageUrl || record.rhacPage || record.productionLink || "";
      return `${index + 1}. ${record.title || "Untitled"}
   Product: ${record.product || "N/A"}
   TDP: ${record.tdp || "N/A"}
   Marketing Program: ${record.marketingProgram || "N/A"}
   Sales Tactic: ${record.salesTactic || "N/A"}
   Creator: ${record.creatorName || "N/A"}
   ${primaryLink ? "Link: " + primaryLink : ""}
`;
    }).join("\n");

    const emailBody = `Hello,

I would like to request an event package with the following details:

Event Information:
- Name: ${eventName}
- Date Range: ${eventDateRange}
- Contact Name: ${contactName}
- Contact Email: ${contactEmail}

Selected Arcades (${selectedRecords.length} total):
${arcadeList}${eventNotes ? `
Additional Notes:
${eventNotes}` : ""}

Thank you for your assistance in creating this event package.

Best regards,
${contactName}

---
Sent via Interactive Demo / Arcade Finder`;

    GmailApp.sendEmail("interactive-experiences@redhat.com", subject, emailBody, {
      cc: ccEmail,
      name: `${contactName} via Event Arcade Finder`,
      replyTo: contactEmail,
    });

    return { success: true };
  } catch (error) {
    console.error("Event request email failed:", error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Shares arcade collections via email
 * Called when users share their saved arcade collections with others
 */
function shareArcadeCollection(emailData) {
  try {
    enforceRateLimit_("share_arcades");

    const toEmail = sanitizeEmailAddress_(emailData && emailData.toEmail);
    const fromName = sanitizeEmailText_(emailData && emailData.fromName, 120);
    const fromEmail = sanitizeEmailAddress_(emailData && emailData.fromEmail);
    const message = sanitizeEmailText_(emailData && emailData.message, 2000);
    const ccEmail = sanitizeEmailAddress_(emailData && emailData.ccEmail, { allowBlank: true });
    const savedRecords = sanitizeRecordsForEmail_(emailData && emailData.savedRecords);

    if (!fromName) throw new Error("Sender name is required.");
    if (!savedRecords.length) throw new Error("No saved arcades to share.");

    const subject = `${fromName} shared arcade demos with you (${savedRecords.length} item${savedRecords.length !== 1 ? "s" : ""})`;
    const arcadeList = savedRecords.map((record, index) => {
      const primaryLink = record.drupalPageUrl || record.rhacPage || record.productionLink || "";
      return `${index + 1}. ${record.title || "Untitled"}
   Product: ${record.product || "N/A"}
   TDP: ${record.tdp || "N/A"}
   Creator: ${record.creatorName || "N/A"}
   ${primaryLink ? "Link: " + primaryLink : ""}
`;
    }).join("\n");

    const emailBody = `Hello,

${fromName} has shared ${savedRecords.length} arcade demo${savedRecords.length !== 1 ? "s" : ""} with you from the Interactive Demo / Arcade Finder.

${message || "I wanted to share these helpful arcade demos with you!"}

Shared Arcade Demos:
${arcadeList}
Best regards,
${fromName}

---
Shared via Interactive Demo / Arcade Finder`;

    GmailApp.sendEmail(toEmail, subject, emailBody, {
      cc: ccEmail,
      name: `${fromName} via Event Arcade Finder`,
      replyTo: fromEmail,
    });

    return { success: true };
  } catch (error) {
    console.error("Share email failed:", error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Submits user feedback via email
 * Called when users submit feedback about the application
 */
function submitFeedback(emailData) {
  try {
    enforceRateLimit_("feedback");

    const feedbackType = sanitizeEmailText_(emailData && emailData.feedbackType, 80);
    const feedbackSubject = sanitizeEmailText_(emailData && emailData.subject, 160);
    const message = sanitizeEmailText_(emailData && emailData.message, 3000);
    const userEmail = sanitizeEmailAddress_(emailData && emailData.email, { allowBlank: true });
    const timestamp = sanitizeEmailText_(emailData && emailData.timestamp, 80);
    const userAgent = sanitizeEmailText_(emailData && emailData.userAgent, 400);
    const url = sanitizeEmailText_(emailData && emailData.url, 400);

    if (!feedbackType) throw new Error("Feedback type is required.");
    if (!feedbackSubject) throw new Error("Feedback subject is required.");
    if (!message) throw new Error("Feedback message is required.");

    const subject = `Feedback: ${feedbackType} - ${feedbackSubject}`;
    const emailBody = `New feedback received from the Interactive Demo / Arcade Finder:

Feedback Type: ${feedbackType}
Subject: ${feedbackSubject}
Contact Email: ${userEmail || "Not provided"}
Submitted: ${timestamp ? new Date(timestamp).toLocaleString() : new Date().toLocaleString()}

Message:
${message}

---
Technical Details:
URL: ${url}
User Agent: ${userAgent}
Timestamp: ${timestamp}

---
Sent via Interactive Demo / Arcade Finder`;

    GmailApp.sendEmail("interactive-experiences@redhat.com", subject, emailBody, {
      replyTo: userEmail || undefined,
      name: "Event Arcade Finder Feedback",
    });

    return { success: true };
  } catch (error) {
    console.error("Feedback submission failed:", error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Test function to verify Google Apps Script setup is working
 * Run this function in Apps Script to test permissions and connectivity
 */
function testSetup() {
  try {
    // Test analytics sheet creation
    const sheet = getAnalyticsSheet();
    console.log("✅ Analytics sheet created/accessed successfully");
    
    // Test email permissions
    const testEmail = GmailApp.getInboxThreads(0, 1);
    console.log("✅ Gmail permissions working");
    
    // Test existing spreadsheet access
    const masterSheet = getMasterSheet_();
    console.log("✅ Master sheet access working");
    
    return { 
      success: true, 
      message: "Setup test completed successfully! All permissions are working.",
      analyticsSheet: sheet.getName(),
      masterSheet: masterSheet.getName(),
      emailPermissions: "OK"
    };
  } catch (error) {
    console.error("❌ Setup test failed:", error);
    return { success: false, error: error.toString() };
  }
}

/**
 * Function to get analytics summary
 * Returns a summary of recent analytics data
 */
function getAnalyticsSummary(days = 7) {
  try {
    const sheet = getAnalyticsSheet();
    const data = sheet.getDataRange().getValues();
    
    if (data.length <= 1) {
      return { totalEvents: 0, summary: "No analytics data yet" };
    }
    
    const headers = data[0];
    const rows = data.slice(1);
    
    // Filter for recent data
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    const recentEvents = rows.filter(row => {
      const timestamp = new Date(row[0]);
      return timestamp >= cutoffDate;
    });
    
    const eventTypes = {};
    recentEvents.forEach(row => {
      const eventType = row[1];
      eventTypes[eventType] = (eventTypes[eventType] || 0) + 1;
    });
    
    return {
      totalEvents: recentEvents.length,
      totalAllTime: rows.length,
      eventTypes: eventTypes,
      daysAnalyzed: days
    };
  } catch (error) {
    console.error("Analytics summary failed:", error);
    return { error: error.toString() };
  }
}

/**
 * Tests email sending functionality specifically
 * Sends a test feedback email to debug delivery issues
 */
function testEmailSending() {
  try {
    console.log("🧪 Testing email sending functionality...");
    
    // Test basic Gmail permissions
    GmailApp.getInboxThreads(0, 1);
    console.log("✅ Gmail API access confirmed");
    
    // Send a test feedback email
    const testEmailData = {
      feedbackType: "test",
      subject: "Test Email from Event Arcade Finder",
      message: "This is a test email to verify email delivery is working correctly.",
      email: "test-user@example.com",
      timestamp: new Date().toISOString(),
      userAgent: "Test Browser",
      url: "https://test.example.com"
    };
    
    console.log("📧 Attempting to send test email...");
    const result = submitFeedback(testEmailData);
    console.log("✅ Test email sent successfully:", result);
    
    return { 
      success: true, 
      message: "Test email sent successfully to yunjyang@redhat.com! Check your inbox.",
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    console.error("❌ Email sending test failed:", error);
    return { success: false, error: error.toString(), message: "Email sending failed - check permissions" };
  }
}