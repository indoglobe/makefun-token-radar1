import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const boardPath = join(outDir, 'board.json');
const dossierPath = join(outDir, 'dossier.json');
const dataPath = join(outDir, 'data.js');
const dashDir = join(outDir, 'dashboard');
const shotsDir = join(outDir, 'screenshots');

console.log('Validating output at:', outDir);

if (!existsSync(boardPath)) {
  console.error('FAIL: board.json missing');
  process.exit(1);
}
if (!existsSync(dataPath)) {
  console.error('FAIL: data.js missing');
  process.exit(1);
}
if (!existsSync(dossierPath)) {
  console.error('FAIL: dossier.json missing');
  process.exit(1);
}
if (!existsSync(dashDir)) {
  console.error('FAIL: dashboard/ missing');
  process.exit(1);
}
if (!existsSync(shotsDir)) {
  console.error('FAIL: screenshots/ missing');
  process.exit(1);
}

const boardData = JSON.parse(readFileSync(boardPath, 'utf8'));
const rows = boardData.rows;
if (!Array.isArray(rows)) {
  console.error('FAIL: board.json does not have rows array');
  process.exit(1);
}

console.log(`Board rows count: ${rows.length}`);
if (rows.length < 100 || rows.length > 4000) {
  console.error(`FAIL: rows count ${rows.length} not in 100-4000 range`);
  process.exit(1);
}

// Check ranks 1..N
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (r.rank !== i + 1) {
    console.error(`FAIL: row index ${i} has rank ${r.rank}, expected ${i + 1}`);
    process.exit(1);
  }
  if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
    console.error(`FAIL: row ${r.slug} implied_value_usd invalid: ${r.implied_value_usd}`);
    process.exit(1);
  }
  if (i > 0 && rows[i].implied_value_usd > rows[i - 1].implied_value_usd) {
    console.error(`FAIL: row ${i} implied_value (${rows[i].implied_value_usd}) > row ${i-1} implied_value (${rows[i-1].implied_value_usd})`);
    process.exit(1);
  }
  const steps = r.farm_steps;
  if (!Array.isArray(steps) || steps.length < 3 || steps.length > 12) {
    console.error(`FAIL: row ${r.slug} has ${steps?.length} farm steps (expected 3-12)`);
    process.exit(1);
  }
  for (const s of steps) {
    if (typeof s !== 'string' || s.length < 20 || s.length > 600) {
      console.error(`FAIL: row ${r.slug} farm step length invalid: ${s?.length}`);
      process.exit(1);
    }
  }
}

// Check non-all-equal
const firstVal = rows[0].implied_value_usd;
const allEqual = rows.every(r => r.implied_value_usd === firstVal);
if (allEqual) {
  console.error('FAIL: all rows have identical implied value');
  process.exit(1);
}

// Check watchlist coverage
const snapshot = JSON.parse(readFileSync('/input/snapshot.json', 'utf8'));
const slugs = new Set(rows.map(r => r.slug));
const missingWatchlist = snapshot.watchlist.filter((s: string) => !slugs.has(s));
if (missingWatchlist.length > 0) {
  console.error(`FAIL: missing watchlist slugs: ${missingWatchlist.join(', ')}`);
  process.exit(1);
}

// Check dashboard offline rule: no http:// or https:// in dashboard files
const dashboardFilesList = ['index.html', 'app.css', 'app.js'];
for (const file of dashboardFilesList) {
  const content = readFileSync(join(dashDir, file), 'utf8');
  if (/https?:\/\//i.test(content)) {
    console.error(`FAIL: dashboard/${file} contains http:// or https://`);
    process.exit(1);
  }
}

console.log('SUCCESS: All validation checks passed successfully!');
