// Token Radar Terminal Engine (Node 22, Standard Library Only)
//
// Implied-Value Valuation Model & Execution Pipeline:
//   The radar ranks pre-token protocols by estimating their intrinsic future token value
//   derived from core quantitative fundamentals:
//   1. Base Value:        Total Value Locked (TVL) scaled by base multiple (0.25).
//   2. Growth Adjustment: 7-day TVL change percentage clamped between -60% and +120%,
//                         then weighted by 0.50 to calculate the growth multiplier.
//   3. Maturity Adjustment: Protocol age in days (derived from listed_at) capped at 3 years (1095 days),
//                           mapped from a floor of 0.60 to a ceiling of 1.00. (Null dates default to 365 days).
//   4. Implied Value:     Maximum of 1 USD, rounded from base_usd x growth_mult x maturity_mult.
//
// Pipeline Overview:
//   Reads sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores all pre-token
//   protocols via lib/model.ts, writes ranked board.json and data.js to /output, copies dashboard/
//   and screenshots/, and generates dossier.json for verification.
//
// Environment Override:
//   MAKEFUN_OUTPUT_DIR can be used outside container environments to redirect output.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, MODEL, volatilityProxy } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar error: no snapshot found at ${inputFile}: pass --input <snapshot.json|directory> or mount /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const activeModel = MODEL;
const universeVol = volatilityProxy(snapshot.protocols);
const { board, radar } = buildRadar(snapshot, activeModel);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar validation error: model produced board rejected by gate: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar error: screenshots/ contains ${shots.length} image${shots.length === 1 ? '' : 's'}: exactly 3 required (board, detail view, filtered view)\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar error: screenshots/${name}: invalid filename format (must be alphanumeric, dots, underscores, hyphens, 1-128 chars)\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } })
);

process.stdout.write(
  `\n============================================================\n` +
  ` TOKEN RADAR TERMINAL ENGINE - RUN SUMMARY\n` +
  `============================================================\n` +
  `• Snapshot Source: ${snapshot.source} (As of ${snapshot.as_of})\n` +
  `• Universe Metrics: ${snapshot.protocols.length} total protocols | ${snapshot.watchlist.length} watchlist items\n` +
  `• Scored Board:     ${board.length} rows (${radar.early_size} early-stage protocols, ${radar.live_size} live tokens set aside)\n` +
  `• Model Parameters: base_multiple=${activeModel.base_multiple}, growth_weight=${activeModel.growth_weight}, growth_cap=${activeModel.growth_cap}%, growth_floor=${activeModel.growth_floor}%, maturity_floor=${activeModel.maturity_floor}\n` +
  `• Volatility Proxy: std_dev=${universeVol.stdDev}% dispersion factor (weight=${activeModel.volatility_weight}, mean_change=${universeVol.meanChange}%)\n` +
  `• Output Artifacts: ${join(out, 'board.json')}, ${join(out, 'data.js')}, dashboard/ (3 files), screenshots/ (${shots.length} images), dossier.json\n` +
  `============================================================\n` +
  `SUCCESS: Token Radar execution completed successfully.\n`
);
