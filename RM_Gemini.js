/************************************************************
 * RM_Gemini.gs - Gemini API Integration
 *
 * WHAT THIS FILE DOES:
 * Wraps calls to the Gemini API for AI-powered analysis.
 *
 * SETUP:
 * Add GEMINI_API_KEY to Script Properties.
 ************************************************************/

var GEMINI_MODEL_ID = 'gemini-2.5-flash';

function callGemini(prompt) {
  var apiKey = getConfigProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY in Script Properties.');

  var url = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + GEMINI_MODEL_ID + ':generateContent?key=' + apiKey;

  var payload = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 65536,
      responseMimeType: 'application/json'
    }
  };

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var status = response.getResponseCode();
  var body = response.getContentText();

  if (status !== 200) {
    throw new Error('Gemini API error ' + status + ': ' + body);
  }

  var result = JSON.parse(body);
  var content = result.candidates && result.candidates[0] &&
    result.candidates[0].content && result.candidates[0].content.parts &&
    result.candidates[0].content.parts[0] && result.candidates[0].content.parts[0].text;

  if (!content) throw new Error('Gemini returned empty content.');

  return JSON.parse(content);
}

function testGeminiConnection() {
  var result = callGemini('Return only valid JSON: {"status":"ok"}');
  Logger.log(result);
  return result;
}
