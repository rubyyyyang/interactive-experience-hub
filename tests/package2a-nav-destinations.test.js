const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'discovery.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'discovery_css.html'), 'utf8');

console.log('=== PACKAGE 2A NAVIGATION DESTINATION TESTS ===\n');
let passed = 0, failed = 0;
function test(name, cond) { if(cond){console.log(`✓ ${name}`);passed++;}else{console.log(`✗ ${name}`);failed++;} }

test('Best Practices → Google Doc', html.includes('13njLj4SYUbvaUwd0zoyt1Racpz8vR4Zz8H43IqkalLU'));
test('The Source → source.redhat.com', html.includes('source.redhat.com/groups/private/arcade_demo_platform'));
test('Analytics → Superset', html.includes('analytics.infra.demo.redhat.com/superset/dashboard/101'));
test('Public IE → redhat.com', html.includes('www.redhat.com/en/interactive-experiences'));
test('Slack → C07HQMHFWQG (renamed to "Ask in Slack")', html.includes('slack.com/archives/C07HQMHFWQG') && html.includes('Ask in Slack'));
test('Send Feedback → openFeedbackModal()', html.includes('openFeedbackModal(); closeAllDropdowns();'));
test('Send Feedback closes mobile menu', html.includes('toggleMobileMenu();'));
test('Saved Demos closes mobile on <=768px', html.includes('if (window.innerWidth <= 768) toggleMobileMenu()'));
test('Resources dropdown exists (renamed from Docs)', html.includes('id="resourcesDropdown"'));
test('Section labels present', html.includes('GUIDES & DOCUMENTATION') && html.includes('EXPLORE & ANALYZE') && html.includes('HELP & FEEDBACK'));
test('All sections visible on both desktop and mobile (no section-level desktopOnly)', !html.match(/<div class="navDropdownSection desktopOnly">/));
test('Send Feedback closes mobile menu on <=768px', html.includes('if (window.innerWidth <= 768) toggleMobileMenu()'));
test('No separate More Resources section (consolidated into Resources)', !html.includes('data-section="More Resources"'));
test('User Guide removed from Header Resources', !html.includes('User Guide'));

// Verify 6 Resources items in single unified dropdown (User Guide removed)
const resourcesContent = html.match(/<div class="navDropdownMenu" id="resourcesDropdown"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/);
const resourcesLinks = resourcesContent ? (resourcesContent[1].match(/<a [^>]*class="navDropdownItem"[^>]*>/g) || []).length : 0;
const resourcesButtons = resourcesContent ? (resourcesContent[1].match(/<button [^>]*class="navDropdownItem navDropdownButton"[^>]*>/g) || []).length : 0;
test('Resources has 5 links + 1 button = 6 total items', resourcesLinks === 5 && resourcesButtons === 1);

// Verify Resources structure: 3 sections with proper labels
test('Resources has GUIDES & DOCUMENTATION section', html.includes('GUIDES & DOCUMENTATION'));
test('Resources has EXPLORE & ANALYZE section', html.includes('EXPLORE & ANALYZE'));
test('Resources has HELP & FEEDBACK section', html.includes('HELP & FEEDBACK'));

// Verify item order in Resources dropdown (User Guide removed)
const resourcesOrder = html.match(/id="resourcesDropdown"[\s\S]*?<\/div>\s*<\/div>/);
if (resourcesOrder) {
  const orderText = resourcesOrder[0];
  const bestPracticesPos = orderText.indexOf('Best Practices Guide');
  const publicIEPos = orderText.indexOf('Public Interactive Experiences');
  const slackPos = orderText.indexOf('Ask in Slack');
  const feedbackPos = orderText.indexOf('Send Feedback');
  test('Item order: Best Practices < Public IE < Ask in Slack < Send Feedback',
    bestPracticesPos < publicIEPos && publicIEPos < slackPos && slackPos < feedbackPos);
}

console.log(`\n=== SUMMARY ===\nTotal: ${passed+failed}\nPassed: ${passed}\nFailed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
