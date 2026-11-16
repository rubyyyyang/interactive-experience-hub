const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'discovery.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'discovery_css.html'), 'utf8');

console.log('=== PACKAGE 2A NAVIGATION DESTINATION TESTS ===\n');
let passed = 0, failed = 0;
function test(name, cond) { if(cond){console.log(`✓ ${name}`);passed++;}else{console.log(`✗ ${name}`);failed++;} }

test('User Guide → GitHub user-guide.md', html.includes('github.com/rubyyyyang/interactive-experience-intake'));
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
test('EXPLORE & ANALYZE section has desktopOnly', html.match(/EXPLORE & ANALYZE[\s\S]*?desktopOnly/));
test('Feedback has desktopOnly', html.includes('navDropdownButton desktopOnly'));
test('Ask in Slack visible on mobile (no desktopOnly on item)', !html.match(/desktopOnly[^>]*>\s*Ask in Slack/));
test('CSS hides desktopOnly on mobile', css.includes('.desktopOnly') && css.includes('display: none'));
test('More Resources has mobileOnly class', html.includes('mobileOnly'));
test('CSS shows mobileOnly on mobile', css.includes('.mobileOnly') && css.includes('display: block'));

// Verify Resources structure: 3 sections with proper labels
test('Resources has GUIDES & DOCUMENTATION section', html.includes('GUIDES & DOCUMENTATION'));
test('Resources has EXPLORE & ANALYZE section (desktop only)', html.includes('EXPLORE & ANALYZE'));
test('Resources has HELP & FEEDBACK section', html.includes('HELP & FEEDBACK'));

const moreMatch = html.match(/data-section="More Resources"[\s\S]{300,800}/);
const moreItems = moreMatch ? (moreMatch[0].match(/navDropdownItem/g) || []).length : 0;
test('More Resources has 3 items (Public IE, Analytics, Feedback)', moreItems === 3);

console.log(`\n=== SUMMARY ===\nTotal: ${passed+failed}\nPassed: ${passed}\nFailed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
