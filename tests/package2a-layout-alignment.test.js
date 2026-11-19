const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'discovery.html'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'discovery_css.html'), 'utf8');

console.log('=== PACKAGE 2A LAYOUT ALIGNMENT TESTS ===\n');
let passed = 0, failed = 0;
function test(name, cond) { if(cond){console.log(`✓ ${name}`);passed++;}else{console.log(`✗ ${name}`);failed++;} }

// Test that Global Header is outside .wrap (full viewport width)
test('Global Header is outside .wrap container',
  html.indexOf('<!-- Global Header -->') < html.indexOf('<div class="wrap">'));

// Test consistent 1600px max-width alignment
const headerContainerMaxWidth = css.match(/\.headerContainer\s*{[^}]*max-width:\s*(\d+)px/);
const pageSubtitleMaxWidth = css.match(/\.pageSubtitle\s*{[^}]*max-width:\s*(\d+)px/);
const wrapMaxWidth = css.match(/\.wrap\s*{[^}]*max-width:\s*(\d+)px/);

test('Header container uses 1600px max-width', headerContainerMaxWidth && headerContainerMaxWidth[1] === '1600');
test('Page subtitle uses 1600px max-width', pageSubtitleMaxWidth && pageSubtitleMaxWidth[1] === '1600');
test('.wrap uses 1600px max-width', wrapMaxWidth && wrapMaxWidth[1] === '1600');

// Test consistent 16px horizontal padding
const headerContainerPadding = css.match(/\.headerContainer\s*{[^}]*padding:\s*12px\s+16px/);
const pageSubtitlePadding = css.match(/\.pageSubtitle\s*{[^}]*padding:\s*20px\s+16px\s+16px\s+16px/);
const wrapPadding = css.match(/\.wrap\s*{[^}]*padding:\s*0\s+16px\s+40px/);

test('Header container uses 16px horizontal padding', headerContainerPadding !== null);
test('Page subtitle uses 16px horizontal padding', pageSubtitlePadding !== null);
test('.wrap uses 16px horizontal padding', wrapPadding !== null);

// Test that Header background spans full viewport (no max-width on .globalHeader)
const globalHeaderMaxWidth = css.match(/\.globalHeader\s*{[^}]*max-width:/);
test('Global Header has no max-width constraint (full viewport)', globalHeaderMaxWidth === null);

// Test sticky Header behavior preserved
test('Global Header sticky positioning preserved', /position:\s*sticky/.test(css) && /top:\s*0/.test(css));

// Test .wrap has no top padding (Header outside, spacing in .pageSubtitle)
test('.wrap has 0 top padding (Header moved outside)', /\.wrap\s*{[^}]*padding:\s*0\s+16px/.test(css));

console.log(`\n=== SUMMARY ===\nTotal: ${passed+failed}\nPassed: ${passed}\nFailed: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
