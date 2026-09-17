/**
 * Lilay Workbench — Google Apps Script backend (deploy as a Web App).
 *
 * Deploy: Extensions > Apps Script > paste this > Deploy > New deployment >
 * type "Web app" > Execute as "Me" > Who has access "Anyone" > Deploy.
 * Each VA has their own deployment; set SHEET_ID below to that VA's sheet.
 *
 * What changed vs. the old script (and why the web app kept saying
 * "Refreshing failed"):
 *  - Header cells are coerced with String(...) before .trim(), so a new column
 *    whose header is a number, a date, or blank no longer throws (that thrown
 *    error used to make doGet return an HTML error page, which the web app
 *    could not parse as JSON -> "Refreshing failed").
 *  - Blank/invalid header columns are skipped instead of creating junk keys.
 *  - Everything runs inside try/catch and always returns JSON, never an HTML
 *    error page.
 *  - New batch mode: ?sheets=Accounts,Caption,Reply returns
 *    { Accounts: [...], Caption: [...], Reply: [...] } in ONE request, so the
 *    app makes a single call per refresh instead of one per sheet (this is the
 *    Apps Script rate-limit workaround). ?sheet=Name still works for one sheet.
 */

var SHEET_ID = '19giadC-eWHfatPy7P5Au1usZ3C3I3KmDrzMXNPTwsDE'; // per-deployment: set to this VA's sheet

function doGet(e) {
  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var params = (e && e.parameter) ? e.parameter : {};

    // Batch mode: ?sheets=Accounts,Caption,Reply
    if (params.sheets) {
      var names = params.sheets.split(',').map(function (n) { return n.trim(); }).filter(String);
      var result = {};
      names.forEach(function (name) { result[name] = readSheet(ss, name); });
      return json(result);
    }

    // Single mode: ?sheet=Accounts
    if (params.sheet) {
      return json(readSheet(ss, params.sheet));
    }

    return json({ error: 'Missing sheet parameter' });
  } catch (error) {
    return json({ error: String(error && error.message ? error.message : error) });
  }
}

function readSheet(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (!data.length) return [];

  var headers = data.shift().map(function (key) {
    return String(key == null ? '' : key).trim();
  });

  return data.map(function (row) {
    var rowObject = {};
    headers.forEach(function (key, index) {
      if (!key) return; // skip blank / invalid header columns
      rowObject[key] = row[index];
    });
    return rowObject;
  });
}

function doPost(e) {
  try {
    var params = e.parameter; // FormData fields
    if (params.action === 'updateSecret') {
      var sheet = SpreadsheetApp.openById(SHEET_ID).getSheetByName('Accounts');
      var data = sheet.getDataRange().getValues();
      for (var i = 1; i < data.length; i++) {
        if (String(data[i][3]) === String(params.container)) { // Column D = container
          sheet.getRange(i + 1, 8).setValue(params.secret);    // Column H = secret
          return json({ success: true });
        }
      }
      return json({ success: false, message: 'Container not found' });
    }
    return json({ success: false, message: 'Invalid action' });
  } catch (error) {
    return json({ success: false, message: String(error && error.message ? error.message : error) });
  }
}

function json(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
