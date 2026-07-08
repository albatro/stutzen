// Кэш YML-фида: держим XML в памяти + на диске (data/price-feed.xml),
// регенерируем в фоне по крону раз в час и по кнопке в UI.
// На запросы отдаём уже собранный XML — синхронно и быстро.
import fs from 'node:fs/promises';
import path from 'node:path';
import cron from 'node-cron';
import { collectFeedOffers, renderFeedXml } from './generate.mjs';
import { startFeedGeneration, updateFeedGeneration } from '../db.mjs';

const FEED_PATH = path.resolve('data/price-feed.xml');
const META_PATH = path.resolve('data/price-feed.meta.json');
const STALE_MS = 60 * 60 * 1000; // 1 час

const state = {
  xml: null,
  count: 0,
  skipped_below_purchase: 0,
  skipped_no_rule: 0,
  generated_at: null,
  generating: false,
  last_error: null,
  last_duration_ms: null,
  file_size_bytes: null,
};

export function getFeedState() { return state; }

export async function regenerateFeed() {
  if (state.generating) return { skipped: 'already_running' };
  state.generating = true;
  const t0 = Date.now();
  const genId = startFeedGeneration();
  try {
    const { offers, skippedBelowPurchase, skippedNoRule } = collectFeedOffers();
    const xml = renderFeedXml(offers);
    const generated_at = new Date().toISOString();
    const durationMs = Date.now() - t0;
    const fileSizeBytes = Buffer.byteLength(xml, 'utf8');

    state.xml = xml;
    state.count = offers.length;
    state.skipped_below_purchase = skippedBelowPurchase;
    state.skipped_no_rule = skippedNoRule;
    state.generated_at = generated_at;
    state.last_error = null;
    state.last_duration_ms = durationMs;
    state.file_size_bytes = fileSizeBytes;

    await fs.mkdir(path.dirname(FEED_PATH), { recursive: true });
    await fs.writeFile(FEED_PATH, xml, 'utf8');
    await fs.writeFile(META_PATH, JSON.stringify({
      count: state.count,
      skipped_below_purchase: state.skipped_below_purchase,
      skipped_no_rule: state.skipped_no_rule,
      generated_at,
      last_duration_ms: durationMs,
      file_size_bytes: fileSizeBytes,
    }, null, 2));

    updateFeedGeneration(genId, {
      finished_at: generated_at,
      status: 'success',
      count: state.count,
      skipped_below_purchase: skippedBelowPurchase,
      skipped_no_rule: skippedNoRule,
      duration_ms: durationMs,
      file_size_bytes: fileSizeBytes,
    });

    console.log(`[feed] regenerated: offers=${state.count} skipped=${skippedBelowPurchase + skippedNoRule} size=${fileSizeBytes} байт in ${durationMs}ms`);
    return { ok: true, count: state.count, duration_ms: durationMs, file_size_bytes: fileSizeBytes };
  } catch (e) {
    state.last_error = e.message;
    updateFeedGeneration(genId, {
      finished_at: new Date().toISOString(),
      status: 'error',
      duration_ms: Date.now() - t0,
      error_message: e.message,
    });
    console.error('[feed] regen failed:', e);
    return { error: e.message };
  } finally {
    state.generating = false;
  }
}

/** Читаем с диска при старте, чтобы после рестарта фид сразу был доступен. */
export async function loadFeedFromDisk() {
  try {
    const [xml, metaRaw] = await Promise.all([
      fs.readFile(FEED_PATH, 'utf8'),
      fs.readFile(META_PATH, 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw);
    state.xml = xml;
    state.count = meta.count ?? 0;
    state.skipped_below_purchase = meta.skipped_below_purchase ?? 0;
    state.skipped_no_rule = meta.skipped_no_rule ?? 0;
    state.generated_at = meta.generated_at ?? null;
    state.last_duration_ms = meta.last_duration_ms ?? null;
    state.file_size_bytes = meta.file_size_bytes ?? Buffer.byteLength(xml, 'utf8');
    return true;
  } catch { return false; }
}

/** При старте: если на диске нет фида или он старше часа — пересобираем в фоне. */
export async function initFeedCache() {
  const loaded = await loadFeedFromDisk();
  const stale = !loaded
    || !state.generated_at
    || (Date.now() - Date.parse(state.generated_at)) > STALE_MS;
  if (stale) {
    regenerateFeed().catch(e => console.error('[feed] initial regen failed:', e));
  } else {
    console.log(`[feed] loaded from disk: offers=${state.count} generated_at=${state.generated_at}`);
  }
}

export function scheduleFeedRegeneration(expr = '0 * * * *') {
  cron.schedule(expr, () => {
    regenerateFeed().catch(e => console.error('[feed] cron regen failed:', e));
  });
  console.log(`[feed] regen scheduled: ${expr}`);
}
