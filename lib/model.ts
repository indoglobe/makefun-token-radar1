// The token radar's core valuation model: one snapshot of the protocol universe in, one ranked board out.
//
// Pre-token protocols (where mcap_usd, gecko_id, and symbol are all null) are the radar's primary targets.
// Implied intrinsic future token value follows from robust protocol fundamentals:
//
//   1. Base Value:          tvl_usd x BASE_MULTIPLE (0.25)
//   2. Growth Percentage:   clamp(change_7d, GROWTH_FLOOR (-60), GROWTH_CAP (+120))
//   3. Growth Multiplier:   1 + (growth_pct / 100) x GROWTH_WEIGHT (0.50)
//   4. Age Resolution:      If listed_at is null, explicitly defaults to UNKNOWN_AGE_DAYS (365).
//   5. Maturity Multiplier: MATURITY_FLOOR (0.60) + (min(age_days, MATURITY_DAYS (1095)) / MATURITY_DAYS) x MATURITY_RANGE (0.40)
//   6. Volatility Proxy:    Universe change_7d standard deviation dispersion factor scaled by volatility_weight (0.05).
//   7. Implied USD:         max(1, round(base_usd x growth_mult x maturity_mult x volatility_mult))
//
// The constants score every row deterministically. No protocol name or category is special-cased.

/** The snapshot protocol entry: exactly the ten fields carried by the sealed input. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The complete snapshot document structure. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Model scoring constants and parameter configurations. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  volatility_weight: number;
}

/** Default active model parameters. */
export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
  volatility_weight: 0.05,
};

/** Valuation model version identifier. */
export const MODEL_VERSION = 'radar-1';

/** Number of pre-token protocols below the watchlist floor included in the early radar, ordered by TVL. */
export const EARLY_ROWS = 160;

/** Number of live-token protocols included in the live token view, ordered by market cap. */
export const LIVE_ROWS = 24;

/** Structure representing a single farm action step. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One ranked row in board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    volatility_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** Compact dashboard view of a scored row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  volatility_multiplier: number;
  farm_steps: string[];
}

/** Live-token protocol entry (publicly traded, market cap present). */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Complete payload required by the terminal dashboard. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  volatility_std_dev: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Custom error thrown when snapshot parsing or structural validation fails. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Calculates protocol age in days from listed_at date to the snapshot date.
 * Explicitly handles null listed_at values.
 */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null || typeof listedAt !== 'string' || listedAt.trim() === '') return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * Calculates volatility proxy (standard deviation and dispersion of change_7d across all protocols).
 * Explicitly handles null/edge cases for change_7d distribution.
 */
export function volatilityProxy(protocols: SnapshotProtocol[]): { stdDev: number; meanChange: number } {
  const changes = protocols
    .map(p => p.change_7d)
    .filter((v): v is number => v !== null && Number.isFinite(v));
  if (changes.length === 0) return { stdDev: 0, meanChange: 0 };
  const sum = changes.reduce((acc, val) => acc + val, 0);
  const meanChange = sum / changes.length;
  const variance = changes.reduce((acc, val) => acc + Math.pow(val - meanChange, 2), 0) / changes.length;
  const stdDev = Math.sqrt(variance);
  return { stdDev: round4(stdDev), meanChange: round4(meanChange) };
}

/**
 * Calculates implied future token value and constituent growth, maturity, and volatility multipliers
 * with explicit clamping of negative 7d growth and fallback handling for null listed_at.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  universeStdDev: number = 25.0,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; volatilityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  
  // Explicit clamping of growth percentage between floor (-60%) and cap (+120%)
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = Math.max(0.1, 1 + (growthPct / 100) * model.growth_weight);

  // Explicit handling for null listed_at: default to unknown_age_days
  const ageForModel = age !== null && age >= 0 ? age : model.unknown_age_days;
  const boundedAge = Math.min(Math.max(ageForModel, 0), model.maturity_days);
  const maturityMult = Math.max(
    model.maturity_floor,
    model.maturity_range > 0 
      ? model.maturity_floor + (boundedAge / model.maturity_days) * model.maturity_range 
      : model.maturity_floor
  );

  // Volatility proxy adjustment factor (bounded between 0.85 and 1.15 based on distance from mean volatility)
  const volDeviation = Math.abs(rawGrowth);
  const denom = universeStdDev > 0 ? universeStdDev : 30.0;
  const volatilityMult = round4(Math.min(1.15, Math.max(0.85, 1.0 + (volDeviation / denom) * (model.volatility_weight ?? 0.05))));

  const baseTvl = Math.max(0, finite(protocol.tvl_usd, 0));
  const baseUsd = baseTvl * model.base_multiple;
  const rawImplied = baseUsd * growthMult * maturityMult * volatilityMult;
  const implied = Math.max(1, Math.round(rawImplied));

  return { implied, growthPct, growthMult, maturityMult, volatilityMult, age };
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Determines if a protocol is pre-token (no market cap, no gecko ID, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Determines if a protocol is rankable on the pre-token radar. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Formats a farm step string, ensuring character length complies with [20, 600] constraints. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep position active on mainnet.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} USDC collateral into ${name} money market on ${chain} and borrow stablecoins to create dual active positions.`;
  }
  if (c.includes('dex') || c.includes('yield') || c.includes('farm')) {
    return `Provide $${capital} depth liquidity to ${name}'s core pool on ${chain} and stake the resulting LP tokens in active yield gauges.`;
  }
  if (c.includes('bridge')) {
    return `Perform cross-chain liquidity transfers totaling $${capital} through ${name} to ${chain} and complete round-trip routing.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} worth of native assets on ${name} on ${chain} and maintain liquid receipt tokens in a holding contract.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option')) {
    return `Deposit $${capital} collateral into ${name} perpetual DEX on ${chain} and execute hedge trades to generate protocol trading volume.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${name} prediction platform and open active positions across active governance or macro market pairs.`;
  }
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault')) {
    return `Deposit $${capital} into ${name}'s automated strategy vault on ${chain} to accrue yield strategy allocation points.`;
  }
  if (c.includes('stable') || c.includes('rwa')) {
    return `Mint $${capital} of ${name}'s asset backing product on ${chain} and lock it in the protocol's rewards distribution module.`;
  }
  if (c.includes('insurance')) {
    return `Purchase $${capital} of protocol coverage on ${name} on ${chain} or underwrite insurance pools to earn fee yields.`;
  }
  return `Deposit $${capital} USDC into ${name} smart contracts on ${chain} and maintain verifiable protocol interaction records.`;
}

/** Generates a structured 6-step actionable farming plan for a given protocol. */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const gasEst = capital >= 150 ? 8 : 4;
  const isMultiChain = p.chains.length > 1;

  return [
    {
      text: `Setup a dedicated clean farm wallet for ${p.name} on ${chain}${isMultiChain ? ` (and prepare secondary chains: ${p.chains.slice(1, 3).join(', ')})` : ''} with gas funds.`,
      cost: `~$${gasEst} native gas token`,
      time: '10 minutes',
    },
    {
      text: action,
      cost: `$${capital} capital plus ~$${gasEst} execution gas`,
      time: '15 minutes setup',
    },
    {
      text: `Execute recurring interaction on ${p.name} (swaps, rebalancing, or claim operations) every 7 to 10 days to maintain active cohort status.`,
      cost: `~$2-$4 gas per weekly tx`,
      time: '10 minutes weekly',
    },
    {
      text: `Maintain the protocol position continuously for at least ${hold} days across multiple snapshot epochs.`,
      cost: `$${capital} capital locked`,
      time: `${hold} days retention`,
    },
    {
      text: `Join ${p.name} Discord and complete Guild/Snapshot governance verifications to tie wallet address to community participation metrics.`,
      cost: '$0 zero cost',
      time: '15 minutes',
    },
    {
      text: `Log wallet address, transaction hashes, and target points tally in your offline farm log for systematic claims tracking.`,
      cost: '$0 zero cost',
      time: '5 minutes',
    },
  ];
}

/** Builds the ranked board from snapshot protocols and model parameters. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const universeVol = volatilityProxy(snapshot.protocols);
  const scored = [...chosen.values()].map((p) => {
    const { implied, growthPct, growthMult, maturityMult, volatilityMult, age } = impliedValue(p, snapshot.as_of, model, universeVol.stdDev);
    return { p, implied, growthPct, growthMult, maturityMult, volatilityMult, age };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      volatility_multiplier: round4(s.volatilityMult),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age).map(stepText),
  }));
}

/** Extracts live-token protocols ordered by market cap. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Converts a board row into a compact dashboard radar row. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    volatility_multiplier: row.model.volatility_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Assembles the complete radar dataset combining board rows and live tokens. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const vol = volatilityProxy(snapshot.protocols);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    volatility_std_dev: vol.stdDev,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parses and validates snapshot JSON text. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no valid as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source string');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no valid floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no valid watchlist array');
  
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks slug, name, or valid TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Validates board integrity against snapshot requirements. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** Generates the embedded data.js script string assigning window.RADAR. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
