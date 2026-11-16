const fs = require('fs');
const path = require('path');
const discoveryPath = path.join(__dirname, '..', 'discovery.html');
const html = fs.readFileSync(discoveryPath, 'utf8');

console.log('=== PACKAGE 2A NAVIGATION DESTINATION TESTS ===\n');

let passed = 0, failed = 0;
function test(name, condition) {
  if (condition) { console.log(`✓ ${name}`); passed++; }
  else { console.log(`✗ ${name}`); failed++; }
}

test('User Guide → GitHub user-guide.md',
  html.includes('github.com/rubyyyyyang/interactive-experience-intake/blob/main/docs/user-guide.md'));
test('Best Practices Guide → Google Doc',
  html.match(/Best Practices Guide[\s\S]{0,50}13njLj4SYUbvaUwd0zoyt1Racpz8vR4Zz8H43IqkalLU/));
test('The Source → source.redhat.com',
  html.includes('source.redhat.com/groups/private/arcade_demo_platform'));
test('Analytics Dashboard → Superset (in Docs)',
  html.match(/id="docsDropdown"[\s\S]*?analytics\.infra\.demo\.redhat\.com\/superset\/dashboard\/101/));
test('Public Interactive Experiences → redhat.com (in Docs)',
  html.match(/id="docsDropdown"[\s\S]*?www\.redhat\.com\/en\/interactive-experiences/));
test('Need Help? (Slack) → C07HQMHFWQG',
  html.includes('slack.com/archives/C07HQMHFWQG'));
test('Send Feedback → openFeedbackModal()',
  html.includes('openFeedbackModal(); closeAllDropdowns();'));
test('Saved Demos closes mobile menu',
  html.includes('if (window.innerWidth <= 768) toggleMobileMenu();'));
test('More Resources has mobileOnly class',
  html.match(/More Resources[\s\S]{0,200}mobileOnly/));

console.log(`\n=== SUMMARY ===\nTotal: ${passed+failed}\nPassed: ${passed}\nFailed: ${failed}\n`);
if (failed === 0) { console.log('✓ All passed\n'); process.exit(0); }
else { console.log('✗ Some failed\n'); process.exit(1); }
