// ==== CONFIG ====
var FORM_SHEET_NAME = 'lifecycle_raw_updates';
var QUEUE_SHEET_NAME = 'Response_Queue';
var MASTER_SHEET_NAME = 'Request_Master';
var RESPONSE_STATUS_AFTER_FORM = 'Submitted';
var ADMIN_REVIEW_AFTER_FORM = 'Pending review';

// NOTE: onOpen() menu is now in RM_AdminMenu.js to avoid duplicate onOpen() functions

function promptForCreator() {
  var ui = SpreadsheetApp.getUi();
  var result = ui.prompt(
    'Select Creator',
    'Enter the Assigned Creator Name (look at column Assigned):',
    ui.ButtonSet.OK_CANCEL
  );

  if (result.getSelectedButton() == ui.Button.OK) {
    var creatorName = result.getResponseText().trim();
    if (creatorName !== '') {
      generateDraftForCreator(creatorName);
    } else {
      ui.alert('Please enter a valid name.');
    }
  }
}

function buildHeaderMap(headers) {
  var map = {};
  for (var i = 0; i < headers.length; i++) {
    var key = headers[i] ? headers[i].toString().trim().toLowerCase() : '';
    if (key && map[key] === undefined) {
      map[key] = i;
    }
  }
  return map;
}

function getRequiredCol(headerMap, headerName) {
  var idx = headerMap[headerName.toLowerCase()];
  if (idx === undefined) {
    throw new Error('Missing required column header: "' + headerName + '"');
  }
  return idx;
}

function getOptionalCol(headerMap, headerNames) {
  for (var i = 0; i < headerNames.length; i++) {
    var idx = headerMap[headerNames[i].toLowerCase()];
    if (idx !== undefined) return idx;
  }
  return -1;
}

function findAssigneeEmail(ss, creatorName) {
  var nameLower = creatorName.toLowerCase();
  var emails = {};

  var master = ss.getSheetByName(MASTER_SHEET_NAME);
  if (master) {
    var data = master.getDataRange().getValues();
    if (data.length > 1) {
      var headers = buildHeaderMap(data[0]);
      var assignedCol = getOptionalCol(headers, ['Assigned']);
      var emailCol = getOptionalCol(headers, ['Creator Email']);
      var creatorNameCol = getOptionalCol(headers, ['Creator Name']);

      for (var i = 1; i < data.length; i++) {
        var assigned = assignedCol >= 0 && data[i][assignedCol]
          ? String(data[i][assignedCol]).trim()
          : '';
        var cName = creatorNameCol >= 0 && data[i][creatorNameCol]
          ? String(data[i][creatorNameCol]).trim()
          : '';

        var matchesAssigned = assigned && assigned.toLowerCase().indexOf(nameLower) !== -1;
        var matchesCreator = cName && cName.toLowerCase().indexOf(nameLower) !== -1;

        if (matchesAssigned || matchesCreator) {
          if (emailCol >= 0 && data[i][emailCol]) {
            var em = String(data[i][emailCol]).trim();
            if (em) emails[em.toLowerCase()] = em;
          }
        }
      }
    }
  }

  var queue = ss.getSheetByName(QUEUE_SHEET_NAME);
  if (queue) {
    var qData = queue.getDataRange().getValues();
    if (qData.length > 1) {
      var qHeaders = buildHeaderMap(qData[0]);
      var qAssigned = getOptionalCol(qHeaders, ['Assigned']);
      var qEmail = getOptionalCol(qHeaders, ['email', 'Email']);

      for (var q = 1; q < qData.length; q++) {
        var qName = qAssigned >= 0 && qData[q][qAssigned]
          ? String(qData[q][qAssigned]).trim()
          : '';
        if (qName && qName.toLowerCase().indexOf(nameLower) !== -1) {
          if (qEmail >= 0 && qData[q][qEmail]) {
            var qEm = String(qData[q][qEmail]).trim();
            if (qEm) emails[qEm.toLowerCase()] = qEm;
          }
        }
      }
    }
  }

  var list = Object.keys(emails).map(function(k) { return emails[k]; });
  return list.length ? list[0] : '';
}

function generateDraftForCreator(creatorName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MASTER_SHEET_NAME) || ss.getActiveSheet();
  var data = sheet.getDataRange().getValues();
  var ui = SpreadsheetApp.getUi();

  if (data.length < 2) {
    ui.alert('No data rows found on sheet: ' + sheet.getName());
    return;
  }

  var headerMap = buildHeaderMap(data[0]);

  var numberCol = getRequiredCol(headerMap, 'Number');
  var titleCol = getRequiredCol(headerMap, 'Final Demo Title');
  var priorityCol = getRequiredCol(headerMap, 'Action Priority');
  var reasonCol = getRequiredCol(headerMap, 'Recommended action reason');
  var assignedCol = getRequiredCol(headerMap, 'Assigned');

  var flagsCol = getOptionalCol(headerMap, ['Performance Signals', 'Performance Flags']);
  var locationCol = getOptionalCol(headerMap, [
    'Public Site Link',
    'RHAC page',
    'Drupal Page URL'
  ]);
  var receivedCol = getOptionalCol(headerMap, ['Status Received Timestamp']);

  var highPriority = [];
  var mediumPriority = [];
  var lowPriority = [];

  var today = new Date();
  var deadline = new Date(today.setDate(today.getDate() + 14));
  var deadlineString = Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'MMMM d, yyyy');

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var assignedPerson = row[assignedCol] ? row[assignedCol].toString().trim() : '';

    if (assignedPerson.toLowerCase().indexOf(creatorName.toLowerCase()) !== -1) {
      var locationValue = '';
      if (locationCol >= 0 && row[locationCol]) {
        locationValue = row[locationCol].toString().trim();
      }

      var item = {
        number: row[numberCol],
        title: row[titleCol],
        location: locationValue,
        metrics: cleanMetricsText(flagsCol >= 0 ? row[flagsCol] : ''),
        reason: cleanReasonText(row[reasonCol]),
        recommendation: getPrescription(row[reasonCol]),
        received: formatReceivedAge(receivedCol >= 0 ? row[receivedCol] : '')
      };

      var priority = row[priorityCol] ? row[priorityCol].toString().toLowerCase() : '';
      if (priority.indexOf('high') !== -1) {
        highPriority.push(item);
      } else if (priority.indexOf('medium') !== -1) {
        mediumPriority.push(item);
      } else {
        lowPriority.push(item);
      }
    }
  }

  if (!highPriority.length && !mediumPriority.length && !lowPriority.length) {
    ui.alert('No records found for assigned creator: ' + creatorName);
    return;
  }

  var htmlBody = '<p>Please review the categorized demos below and reply by <strong>' + deadlineString + '</strong>.</p>';

  if (highPriority.length) {
    htmlBody += '<h2>High Priority</h2><ul>';
    highPriority.forEach(function(item) {
      htmlBody += formatDemoItemHTML(item, creatorName);
    });
    htmlBody += '</ul>';
  }

  if (mediumPriority.length) {
    htmlBody += '<h2>Medium Priority</h2><ul>';
    mediumPriority.forEach(function(item) {
      htmlBody += formatDemoItemHTML(item, creatorName);
    });
    htmlBody += '</ul>';
  }

  if (lowPriority.length) {
    htmlBody += '<h2>Low Priority</h2><ul>';
    lowPriority.forEach(function(item) {
      htmlBody += formatDemoItemHTML(item, creatorName);
    });
    htmlBody += '</ul>';
  }

  htmlBody += '<h3>Required Next Steps</h3>';
  htmlBody += '<p>Please click the update link for each demo above within <strong>TWO WEEKS (by ' + deadlineString + ')</strong> to let us know if they:</p>';
  htmlBody += '<ul><li>Have been updated</li><li>Are planned for an upcoming update (include target date)</li><li>Should be retired</li></ul>';

  htmlBody += '<p>To support your review, the following resources are available:</p>';
  htmlBody += '<ul>';
  htmlBody += '<li>Best Practices and Quality Checklist: <a href="https://docs.google.com/document/d/13njLj4SYUbvaUwd0zoyt1Racpz8vR4Zz8H43IqkalLU/edit?tab=t.al8fi58zysxv#bookmark=kix.p74enmitkcn">Link</a></li>';
  htmlBody += '<li>Brand and Templates: <a href="https://docs.google.com/document/d/13njLj4SYUbvaUwd0zoyt1Racpz8vR4Zz8H43IqkalLU/edit?tab=t.al8fi58zysxv#heading=h.bdtr8ys3e5mf">Link</a></li>';
  htmlBody += '<li>Submission Checklist and CTAs: <a href="https://docs.google.com/document/d/13njLj4SYUbvaUwd0zoyt1Racpz8vR4Zz8H43IqkalLU/edit?tab=t.al8fi58zysxv#bookmark=kix.2tj5yrs6hx4q">Link</a></li>';
  htmlBody += '<li>Additional recommended resource: <a href="https://source.redhat.com/departments/products_and_global_engineering/interactive_experiences">The Source</a></li>';
  htmlBody += '<li>Office hours: <a href="https://docs.google.com/document/d/1QMTwz56E9ivB1qKamOBN1Cntcr9HUo5rOdQiqqQNq4I/edit?tab=t.0#heading=h.66y4kqbj468a">Schedule</a> - join us to discuss the feedback, ask questions, or get support with your updates</li>';
  htmlBody += '</ul>';

  htmlBody += '<p>Please share an update as soon as you can. We will check in again in <strong>TWO WEEKS</strong>. Where we do not receive confirmation of an update or a clear plan, we may need to retire the affected assets to ensure customers continue to receive accurate and dependable content.</p>';

  htmlBody += '<p>Thank you for helping us maintain a robust and valuable <a href="https://script.google.com/a/macros/redhat.com/s/AKfycbw-i5dNh9DOHOyGuo9-pbfrQCazwImd48wfxTDD8wecsg4tk5h6yXGy25OJFx1F5COgsw/exec">interactive demo library</a> and <a href="https://www.redhat.com/en/interactive-experiences">external site</a>.</p>';

  htmlBody += '<p>Best regards,<br>';
  htmlBody += 'Rohan Venkatram<br>';
  htmlBody += 'Interactive Experiences<br>';
  htmlBody += 'Red Hat Demo Platform</p>';

  var recipient = findAssigneeEmail(ss, creatorName);
  var subject = 'ACTION NEEDED: Interactive Demo Performance Review - ' + creatorName;

  GmailApp.createDraft(recipient || '', subject, '', {
    htmlBody: htmlBody
  });

  if (recipient) {
    ui.alert('Draft created for ' + creatorName + '\nTo: ' + recipient + '\nSubject: ' + subject);
  } else {
    ui.alert(
      'Draft created for ' + creatorName + '\n\n' +
      'No email found for this Assigned name in Creator Email / Response_Queue.\n' +
      'Open the draft and fill in the To field manually.\n\nSubject: ' + subject
    );
  }
}

/**
 * Formats each demo item.
 * Per feedback: show Location only (no separate View Demo / production link).
 */
function formatDemoItemHTML(item, creatorName) {
  var html = '<li><strong>' + item.title + '</strong><ul>';

  if (item.location) {
    html += '<li><strong>Location:</strong> <a href="' + item.location + '">' + item.location + '</a></li>';
  }

  if (item.received) {
    html += '<li><strong>Received:</strong> ' + item.received + '</li>';
  }

  if (item.metrics) {
    html += '<li><strong>Metrics:</strong> ' + item.metrics + '</li>';
  }

  html += '<li><strong>Status:</strong> ' + item.reason + '</li>';
  html += '<li><strong>Recommended Action:</strong> ' + item.recommendation + '</li>';

  var formBaseUrl = 'https://docs.google.com/forms/d/e/1FAIpQLSfSTtLnUQ-UjwNATMSF5ZSyDzRHzPGguRvWKwEztoh7dSA9NA/viewform?usp=pp_url';
  var updateLink =
    formBaseUrl +
    '&entry.943736744=' + encodeURIComponent(item.number) +
    '&entry.162017008=' + encodeURIComponent(item.title) +
    '&entry.1847784177=' + encodeURIComponent(creatorName);

  html += '<li><strong><a href="' + updateLink + '">Submit Update Plan for this Demo</a></strong></li>';
  html += '</ul></li>';
  return html;
}

function formatReceivedAge(rawValue) {
  if (!rawValue) return '';

  var receivedDate;
  if (Object.prototype.toString.call(rawValue) === '[object Date]' && !isNaN(rawValue)) {
    receivedDate = rawValue;
  } else {
    receivedDate = new Date(rawValue);
  }

  if (isNaN(receivedDate.getTime())) {
    return rawValue.toString().trim();
  }

  var dateString = Utilities.formatDate(receivedDate, Session.getScriptTimeZone(), 'MMMM d, yyyy');

  var now = new Date();
  var months =
    (now.getFullYear() - receivedDate.getFullYear()) * 12 +
    (now.getMonth() - receivedDate.getMonth());

  if (now.getDate() < receivedDate.getDate()) {
    months -= 1;
  }
  if (months < 0) months = 0;

  var ageLabel;
  if (months < 1) {
    ageLabel = 'less than 1 month old';
  } else if (months === 1) {
    ageLabel = '1 month old';
  } else if (months < 12) {
    ageLabel = months + ' months old';
  } else {
    var years = Math.floor(months / 12);
    var remMonths = months % 12;
    if (remMonths === 0) {
      ageLabel = years === 1 ? 'about 1 year old' : 'about ' + years + ' years old';
    } else {
      ageLabel =
        (years === 1 ? 'about 1 year' : 'about ' + years + ' years') +
        ', ' + remMonths + (remMonths === 1 ? ' month old' : ' months old');
    }
  }

  return dateString + ' (' + ageLabel + ')';
}

function getPrescription(reason) {
  var text = reason ? reason.toLowerCase() : '';

  if (text.indexOf('no page') !== -1) {
    return 'Work with web marketing to create a dedicated redhat.com page to capture organic search traffic for this high-performing asset.';
  } else if (text.indexOf('no action needed') !== -1) {
    return 'Demo is performing within target parameters. No creator action required during this cycle.';
  } else if (text.indexOf('retirement') !== -1 || text.indexOf('flagged') !== -1) {
    return 'Confirm retirement OR submit a plan for a major update and new distribution strategy.';
  } else if (text.indexOf('low visibility') !== -1 || text.indexOf('needs distribution') !== -1) {
    return 'Improve visibility and CTAs. Strengthen sales alignment/linking and re-promote on relevant landing pages to drive traffic.';
  } else if (text.indexOf('low sales') !== -1 || text.indexOf('sales impact') !== -1) {
    return 'Optimize conversion. Review end-card CTAs, ensure outbound links to Ansible/sales rep contact pages are working, and align with sales team routing.';
  } else if (
    text.indexOf('10% (low)') !== -1 ||
    text.indexOf('completion rate: 4%') !== -1 ||
    text.indexOf('completion rate: 5%') !== -1
  ) {
    return 'Critical content review. Check for UX friction, confusing prompt instructions, or technical bugs in the early steps.';
  } else if (text.indexOf("don't finish") !== -1 || text.indexOf('start but') !== -1) {
    return 'Streamline the demo flow. Consider reducing total steps, simplifying early instructions, and removing redundant text tooltips to keep players engaged to the end.';
  } else {
    return 'Review content flow and verify tracking links.';
  }
}

function cleanReasonText(rawReason) {
  if (!rawReason) return '';
  return rawReason.toString().trim().split('(')[0].trim();
}

function cleanMetricsText(rawText) {
  if (!rawText) return '';
  var text = rawText.toString();

  if (text.indexOf('players/mo') !== -1 && text.indexOf('|') !== -1) {
    return text;
  }

  var parts = [];

  var usageMatch = text.match(/Usage:\s*(\d+)\s*ppm\s*\(([^)]+)\)/i);
  if (usageMatch) {
    var usageTier = usageMatch[2].split(' ')[0];
    usageTier = usageTier.charAt(0).toUpperCase() + usageTier.slice(1);
    parts.push(usageMatch[1] + ' players/mo (' + usageTier + ')');
  }

  var crMatch = text.match(/CR:\s*(\d+%)\s*\(([^)]+)\)/i);
  if (crMatch) {
    var crTier = crMatch[2].split(' ')[0];
    if (crTier.toLowerCase() === 'low' || crTier.toLowerCase() === 'below') {
      crTier = 'Below Target';
    } else {
      crTier = crTier.charAt(0).toUpperCase() + crTier.slice(1);
    }
    parts.push(crMatch[1] + ' Completion Rate (' + crTier + ')');
  }

  var mtMatch = text.match(/MT:\s*(\$[\d\w\.]+)\s*(opp|won|none)?\s*\(([^)]+)\)/i);
  if (mtMatch) {
    if (mtMatch[1] === '$0' || mtMatch[2] === 'none') {
      parts.push('$0 Pipeline');
    } else {
      parts.push(mtMatch[1] + ' Pipeline');
    }
  }

  return parts.length ? parts.join(' | ') : text;
}

function syncFormResponsesToQueue() {
  syncFormResponsesToQueue_(false);
}

function onUpdatePlanFormSubmit(e) {
  syncFormResponsesToQueue_(true);
}

function syncFormResponsesToQueue_(silent) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var formSheet = ss.getSheetByName(FORM_SHEET_NAME);
  var queueSheet = ss.getSheetByName(QUEUE_SHEET_NAME);
  var ui = SpreadsheetApp.getUi();

  if (!formSheet) {
    if (!silent) ui.alert('Form sheet "' + FORM_SHEET_NAME + '" not found.');
    return;
  }
  if (!queueSheet) {
    if (!silent) ui.alert('Missing sheet: ' + QUEUE_SHEET_NAME);
    return;
  }

  var formData = formSheet.getDataRange().getValues();
  var queueData = queueSheet.getDataRange().getValues();

  var headerRowIdx = -1;
  for (var r = 0; r < formData.length; r++) {
    for (var c = 0; c < formData[r].length; c++) {
      var cell = formData[r][c] ? formData[r][c].toString().toLowerCase() : '';
      if (cell.indexOf('demo id') !== -1) {
        headerRowIdx = r;
        break;
      }
    }
    if (headerRowIdx !== -1) break;
  }

  if (headerRowIdx === -1) {
    if (!silent) ui.alert('Could not find a Demo ID header in ' + FORM_SHEET_NAME);
    return;
  }

  if (formData.length <= headerRowIdx + 1 || queueData.length < 2) {
    if (!silent) ui.alert('No data to sync.');
    return;
  }

  var formHeaders = buildHeaderMap(formData[headerRowIdx]);
  var queueHeaders = buildHeaderMap(queueData[0]);

  var demoIdCol = -1;
  for (var h = 0; h < formData[headerRowIdx].length; h++) {
    var header = formData[headerRowIdx][h]
      ? formData[headerRowIdx][h].toString().toLowerCase()
      : '';
    if (header.indexOf('demo id') !== -1) {
      demoIdCol = h;
      break;
    }
  }
  if (demoIdCol === -1) {
    if (!silent) ui.alert('Could not find Demo ID column.');
    return;
  }

  var fTimestamp = getOptionalCol(formHeaders, ['Timestamp']);
  var fEmail = getOptionalCol(formHeaders, ['Email Address']);
  var fTitle = getOptionalCol(formHeaders, ['Demo Title']);
  var fActionTaken = getOptionalCol(formHeaders, ['Action Taken']);
  var fNewLink = getOptionalCol(formHeaders, ['Updated Demo Creation Link']);
  var fTargetDate = getOptionalCol(formHeaders, ['Target Update Date']);
  var fNotes = getOptionalCol(formHeaders, ['Additional Notes or Comments']);

  var qNumber = getOptionalCol(queueHeaders, ['Demo Number']);
  var qTitle = getOptionalCol(queueHeaders, ['Demo Title']);
  var qEmail = getOptionalCol(queueHeaders, ['email']);
  var qResponse = getOptionalCol(queueHeaders, ['Response']);
  var qTimestamp = getOptionalCol(queueHeaders, ['Timestamp']);
  var qActionTaken = getOptionalCol(queueHeaders, ['Action Taken']);
  var qNewLink = getOptionalCol(queueHeaders, ['New Creation Link']);
  var qTargetDate = getOptionalCol(queueHeaders, ['Target Update Date']);
  var qComments = getOptionalCol(queueHeaders, ['Additional Comments']);
  var qAdminReview = getOptionalCol(queueHeaders, ['Admin Review']);

  if (qNumber < 0) {
    if (!silent) ui.alert('Could not find Demo Number column in Response_Queue.');
    return;
  }

  var queueIndexByNumber = {};
  for (var qr = 1; qr < queueData.length; qr++) {
    var num =
      queueData[qr][qNumber] !== '' && queueData[qr][qNumber] != null
        ? String(queueData[qr][qNumber]).trim()
        : '';
    if (num) queueIndexByNumber[num] = qr;
  }

  var latestByDemoId = {};
  for (var i = headerRowIdx + 1; i < formData.length; i++) {
    var demoId =
      formData[i][demoIdCol] !== '' && formData[i][demoIdCol] != null
        ? String(formData[i][demoIdCol]).trim()
        : '';
    if (!demoId) continue;
    latestByDemoId[demoId] = formData[i];
  }

  var updated = 0;
  var missing = [];

  Object.keys(latestByDemoId).forEach(function(demoId) {
    var queueRowIdx = queueIndexByNumber[demoId];
    if (queueRowIdx === undefined) {
      missing.push(demoId);
      return;
    }

    var formRow = latestByDemoId[demoId];
    var sheetRow = queueRowIdx + 1;

    if (qResponse >= 0) {
      queueSheet.getRange(sheetRow, qResponse + 1).setValue(RESPONSE_STATUS_AFTER_FORM);
    }
    if (qAdminReview >= 0) {
      queueSheet.getRange(sheetRow, qAdminReview + 1).setValue(ADMIN_REVIEW_AFTER_FORM);
    }
    if (qTitle >= 0 && fTitle >= 0 && formRow[fTitle]) {
      queueSheet.getRange(sheetRow, qTitle + 1).setValue(formRow[fTitle]);
    }
    if (qEmail >= 0 && fEmail >= 0 && formRow[fEmail]) {
      queueSheet.getRange(sheetRow, qEmail + 1).setValue(formRow[fEmail]);
    }
    if (qTimestamp >= 0 && fTimestamp >= 0 && formRow[fTimestamp]) {
      queueSheet.getRange(sheetRow, qTimestamp + 1).setValue(formRow[fTimestamp]);
    }
    if (qActionTaken >= 0 && fActionTaken >= 0 && formRow[fActionTaken]) {
      queueSheet.getRange(sheetRow, qActionTaken + 1).setValue(formRow[fActionTaken]);
    }
    if (qNewLink >= 0 && fNewLink >= 0 && formRow[fNewLink]) {
      queueSheet.getRange(sheetRow, qNewLink + 1).setValue(formRow[fNewLink]);
    }
    if (qTargetDate >= 0 && fTargetDate >= 0 && formRow[fTargetDate]) {
      queueSheet.getRange(sheetRow, qTargetDate + 1).setValue(formRow[fTargetDate]);
    }
    if (qComments >= 0 && fNotes >= 0 && formRow[fNotes]) {
      queueSheet.getRange(sheetRow, qComments + 1).setValue(formRow[fNotes]);
    }

    updated++;
  });

  formSheet.getRange('B1').setValue(
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'M/d/yyyy H:mm:ss')
  );

  if (!silent) {
    var msg =
      'Synced ' + updated + ' row(s) from ' + FORM_SHEET_NAME + ' to ' + QUEUE_SHEET_NAME + '.\n' +
      'Response = Submitted, Admin Review = Pending review.';
    if (missing.length) {
      msg += '\n\nNo queue match for Demo ID(s): ' + missing.join(', ');
    }
    ui.alert(msg);
  }
}