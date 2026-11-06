/**
 * Host half of turn-cost-footer.
 *
 * Folds the durable `assistant/message` usage of every Turn into a CNY cost with a
 * local, configurable price table, keeps the most recently completed Turn in memory
 * (and on disk), and serves it to the Client half over a read-only JSON route.
 *
 * Data source: the session log only. `usage.inputTokens` is the uncached input count,
 * `usage.cacheReadTokens` the cache-hit count, `usage.outputTokens` already contains
 * reasoning tokens — adding `reasoningTokens` again would double count.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const STATE_FILE = path.join(DSH_HOME, '.turn-cost-footer.json');
const ROUTE_PATH = '/turn-cost-footer/turn.json';
const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'no-store',
};

/** CNY per million tokens, valley price. Peak = valley * peakMultiplier. */
const DEFAULT_CONFIG = {
  enabled: true,
  showToday: true,
  currency: 'CNY',
  peakHours: [
    [9, 12],
    [14, 18],
  ],
  peakMultiplier: 2,
  weekendValley: true,
  prices: {
    default: { cacheHit: 0.02, cacheMiss: 1, output: 4 },
    'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
  },
  debug: false,
};

function num(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function str(value, fallback) {
  return typeof value === 'string' && value ? value : fallback;
}

function normalizePrices(raw) {
  const prices = { ...DEFAULT_CONFIG.prices };
  if (!raw || typeof raw !== 'object') return prices;
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== 'object') continue;
    const base = prices[key] || prices.default;
    prices[key] = {
      cacheHit: num(value.cacheHit, base.cacheHit),
      cacheMiss: num(value.cacheMiss, base.cacheMiss),
      output: num(value.output, base.output),
    };
  }
  if (!prices.default) prices.default = { ...DEFAULT_CONFIG.prices.default };
  return prices;
}

function normalizeConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const hours = Array.isArray(src.peakHours)
    ? src.peakHours.filter(
        (row) =>
          Array.isArray(row) &&
          row.length === 2 &&
          Number.isFinite(row[0]) &&
          Number.isFinite(row[1]),
      )
    : DEFAULT_CONFIG.peakHours;
  return {
    enabled: src.enabled !== false,
    showToday: src.showToday !== false,
    currency: str(src.currency, DEFAULT_CONFIG.currency),
    peakHours: hours.length > 0 ? hours : DEFAULT_CONFIG.peakHours,
    peakMultiplier: num(src.peakMultiplier, DEFAULT_CONFIG.peakMultiplier),
    weekendValley: src.weekendValley !== false,
    prices: normalizePrices(src.prices),
    debug: src.debug === true,
  };
}

/** Longest matching model-id substring wins; `default` is the fallback. */
function priceFor(model, prices) {
  const id = String(model || '').toLowerCase();
  let bestKey = '';
  for (const key of Object.keys(prices)) {
    if (key === 'default') continue;
    const needle = key.toLowerCase();
    if (needle && id.includes(needle) && needle.length > bestKey.length) bestKey = key;
  }
  return (bestKey ? prices[bestKey] : null) || prices.default;
}

/** Beijing (UTC+8) calendar parts, independent of the host time zone. */
function beijingParts(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return {
    day: d.toISOString().slice(0, 10),
    hour: d.getUTCHours(),
    weekday: d.getUTCDay(),
  };
}

function isPeak(cfg, ts) {
  const { hour, weekday } = beijingParts(ts);
  if (cfg.weekendValley && (weekday === 0 || weekday === 6)) return false;
  return cfg.peakHours.some(([from, to]) => hour >= from && hour < to);
}

function costOf(usage, model, cfg, ts) {
  const price = priceFor(model, cfg.prices);
  if (!price) return null;
  const factor = isPeak(cfg, ts) ? cfg.peakMultiplier : 1;
  const hit = (num(usage.cacheReadTokens, 0) / 1e6) * price.cacheHit * factor;
  const miss = (num(usage.inputTokens, 0) / 1e6) * price.cacheMiss * factor;
  const out = (num(usage.outputTokens, 0) / 1e6) * price.output * factor;
  const amount = hit + miss + out;
  return Number.isFinite(amount) ? amount : null;
}

function emptyState() {
  return { seq: 0, last: null, todayDay: '', todayAmount: 0 };
}

function loadState() {
  const state = emptyState();
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    if (raw && typeof raw === 'object') {
      state.seq = num(raw.seq, 0);
      if (raw.last && typeof raw.last === 'object' && Number.isFinite(raw.last.amount)) {
        state.last = {
          sessionId: str(raw.last.sessionId, ''),
          turn: num(raw.last.turn, null),
          amount: raw.last.amount,
          tokens: num(raw.last.tokens, null),
          model: str(raw.last.model, null),
          ts: num(raw.last.ts, null),
        };
      }
      state.todayDay = str(raw.todayDay, '');
      state.todayAmount = num(raw.todayAmount, 0);
    }
  } catch {
    // No state yet, or an unreadable file: start clean without failing the plugin.
  }
  return state;
}

function saveState(state) {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), 'utf8');
  } catch {
    // Persistence is best effort; the live in-memory value stays authoritative.
  }
}

export function apply(ctx, rawConfig) {
  const cfg = normalizeConfig(rawConfig);
  const state = loadState();
  /** sessionId -> in-progress Turn aggregate */
  const aggs = new Map();
  /** sessionId -> last completed Turn (per session, so a background session cannot hijack another) */
  const lastBySession = new Map();
  /** Subagent sessions: their Turns are real spend but must never drive the visible footer. */
  const subagentSessions = new Set();
  const log = (...args) => {
    if (cfg.debug) console.log('[turn-cost-footer]', ...args);
  };

  function addToday(amount, ts) {
    const day = beijingParts(ts).day;
    if (state.todayDay !== day) {
      state.todayDay = day;
      state.todayAmount = 0;
    }
    state.todayAmount += amount;
  }

  function finalizeTurn(sessionId, reason, subagent) {
    const agg = aggs.get(sessionId);
    if (!agg) return;
    aggs.delete(sessionId);
    const record = {
      sessionId,
      turn: agg.turn,
      amount: agg.amount,
      tokens: agg.tokens,
      model: agg.model,
      ts: agg.ts,
      reason: (reason && reason.kind) || null,
    };
    lastBySession.set(sessionId, record);
    addToday(record.amount, record.ts);
    if (subagent) {
      // Real spend for the day total, but never the footer of the conversation on screen.
      saveState(state);
      return;
    }
    state.last = record;
    state.seq += 1;
    saveState(state);
    log('turn end', record.turn, record.amount.toFixed(4), record.model, record.reason);
  }

  function onSessionEvent(session, event) {
    const sid = session && session.id;
    if (!sid || !event) return;
    const type = event.type;
    const data = event.data || {};
    if (type === 'assistant/message') {
      const usage = data.usage;
      if (!usage || typeof usage !== 'object') return;
      const turn = num(data.turn, null);
      if (turn === null) return;
      const model = (data.message && data.message.source && data.message.source.model) || null;
      const ts = num(event.time, Date.now());
      const amount = costOf(usage, model, cfg, ts);
      if (amount === null) return;
      const tokens =
        num(usage.inputTokens, 0) + num(usage.cacheReadTokens, 0) + num(usage.outputTokens, 0);
      let agg = aggs.get(sid);
      if (!agg || agg.turn !== turn) {
        agg = { turn, amount: 0, tokens: 0, model, ts };
        aggs.set(sid, agg);
      }
      agg.amount += amount;
      agg.tokens += tokens;
      agg.ts = ts;
      if (model) agg.model = model;
      return;
    }
    if (type === 'turn/end') {
      finalizeTurn(sid, data.reason, isSubagent(session, sid));
    }
  }

  function isSubagent(session, sid) {
    if (subagentSessions.has(sid)) return true;
    const header = session && session.header;
    return Boolean(header && header.origin === 'subagent');
  }

  function payloadFor(req) {
    let sessionId = '';
    try {
      const url = new URL(req.url || '/', 'http://127.0.0.1');
      sessionId = url.searchParams.get('session') || '';
    } catch {
      sessionId = '';
    }
    const record = (sessionId && lastBySession.get(sessionId)) || state.last;
    const today =
      state.todayDay === beijingParts(Date.now()).day ? state.todayAmount : 0;
    return {
      ok: true,
      seq: state.seq,
      enabled: cfg.enabled,
      showToday: cfg.showToday,
      currency: cfg.currency,
      turn: record ? record.turn : null,
      amount: record ? record.amount : null,
      tokens: record ? record.tokens : null,
      model: record ? record.model : null,
      ts: record ? record.ts : null,
      todayUsage: cfg.showToday ? today : null,
      // Diagnostics: tells whether the patch row's `config:` block reached `apply`.
      config: {
        source: rawConfig && typeof rawConfig === 'object' ? 'patch' : 'defaults',
        keys: rawConfig && typeof rawConfig === 'object' ? Object.keys(rawConfig) : [],
      },
    };
  }

  ctx.inject(['webServer'], (inner) => {
    inner.effect(() =>
      inner.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: (req, res) => {
          try {
            res.writeHead(200, JSON_HEADERS);
            res.end(JSON.stringify(payloadFor(req)));
          } catch (error) {
            res.writeHead(500, JSON_HEADERS);
            res.end(JSON.stringify({ ok: false, error: String(error && error.message) }));
          }
        },
      }),
    );
    inner.on('session/event', onSessionEvent);
    inner.on('subagent/start', (info) => {
      if (info && info.id) subagentSessions.add(info.id);
    });
    inner.on('subagent/end', (info) => {
      if (info && info.id) subagentSessions.delete(info.id);
    });
    inner.on('session/disposed', (session) => {
      if (session && session.id) {
        aggs.delete(session.id);
        lastBySession.delete(session.id);
        subagentSessions.delete(session.id);
      }
    });
    log('route ready', ROUTE_PATH, 'enabled=' + cfg.enabled);
  });
}

export default { name: 'turn-cost-footer', apply };
