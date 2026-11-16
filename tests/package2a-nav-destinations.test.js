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
test('Slack → C07HQMHFWQG', html.includes('slack.com/archives/C07HQMHFWQG'));
test('Send Feedback → openFeedbackModal()', html.includes('openFeedbackModal(); closeAllDropdowns();'));
test('Send Feedback closes mobile menu', html.includes('toggleMobileMenu();'));
test('Saved Demos closes mobile on <=768px', html.includes('if (window.innerWidth <= 768) toggleMobileMenu()'));
test('Analytics has desktopOnly in Docs', html.includes('class="navDropdownItem desktopOnly"') && html.includes('Analytics Dashboard'));
test('Public IE has desktopOnly', html.match(/desktopOnly[^>]*>\s*Public Interactive Experiences/));
test('Feedback has desktopOnly', html.includes('navDropdownButton desktopOnly'));
test('Slack has desktopOnly', html.match(/desktopOnly[^>]*>\s*Need Help/));
test('CSS hides desktopOnly on mobile', css.includes('.desktopOnly') && css.includes('display: none'));
test('More Resources has mobileOnly class', html.includes('mobileOnly'));
test('CSS shows mobileOnly on mobile', css.includes('.mobileOnly') && css.includes('display: block'));

const docsMatch = html.match(/id="docsDropdown"[\s\S]{300,1500}/);
const desktopOnlyCount = docsMatch ? (docsMatch[0].match(/desktopOnly/g) || []).length : 0;
test('Docs has >=4 desktopOnly items (resources hidden on mobile)', desktopOnlyCount >= 4);

const moreMatch = html.match(/data-section="More Resources"[\s\S]{300,800}/);
const moreItems = moreMatch ? (moreMatch[0].match(/navDropdownItem/g) || []).length : 0;
test('More Resources has 4 items', moreItems === 4);

console.log(`\n=== SUMMARY ===\nTotal: ${passed+failed}\nPassed: ${passed}\nFailed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
