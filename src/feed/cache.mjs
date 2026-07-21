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
  offers: null,          // облегчённый массив офферов, показывается в /feed-view.html
  count: 0,
  skipped_below_purchase: 0,
  skipped_no_rule: 0,
  generated_at: null,
  generating: false,
  last_error: null,
  last_duration_ms: null,
  file_size_bytes: null,
};

// Оставляем только нужные для UI поля, чтобы не держать в памяти ~120МБ вместо ~30МБ.
function projectOfferForCache(o) {
  const image_url = o.image_url ?? o.supplier_picture ?? null;
  const name = o.name ?? o.supplier_name ?? null;
  const vendor = o.vendor ?? o.supplier_vendor ?? null;
  const weight = o.weight ?? o.supplier_weight ?? null;
  const dimensions = o.supplier_dimensions
    ?? (o.length && o.width && o.height ? `${o.length}/${o.width}/${o.height}` : null);
  const margin = (o.new_price != null && o.purchase_price != null)
    ? Math.round((o.new_price - o.purchase_price) * 100) / 100 : null;
  const margin_percent = (margin != null && o.purchase_price > 0)
    ? Math.round(margin / o.purchase_price * 1000) / 10 : null;
  return {
    offer_id: o.offer_id,
    name,
    category_id: o.category_id ?? null,
    category_name: o.category_name ?? null,
    supplier_category_id: o.supplier_category_id ?? null,
    new_price: o.new_price,
    feed_price: Math.round(o.new_price * (o.supplier_step_quantity ?? 1) * 100) / 100,
    min_for_bestseller: Math.round(o.new_price * (o.supplier_step_quantity ?? 1) * 100) / 100,
    purchase_price: o.purchase_price ?? null,
    margin,
    margin_percent,
    image_url,
    vendor,
    vendor_code: o.vendor_code ?? null,
    weight,
    dimensions,
    count: o.supplier_count ?? null,
    feed_count: o.supplier_count != null ? Math.floor(o.supplier_count / (o.supplier_step_quantity ?? 1)) : null,
    step_quantity: o.supplier_step_quantity ?? 1,
    available: o.supplier_available === 0 ? 0 : 1,
    country: o.country ?? null,
    url: o.supplier_url ?? null,
  };
}

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
    state.offers = offers.map(projectOfferForCache);
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

/**
 * Гарантирует, что state.offers заполнен для UI /feed-view.html.
 * После загрузки XML с диска offers[] пуст (не сериализуем в meta), поэтому
 * при первом заходе на страницу докидываем облегчённый снапшот из БД.
 */
export function ensureOffersCache() {
  if (state.offers) return state.offers;
  if (!state.xml || state.generating) return null;
  const { offers } = collectFeedOffers();
  state.offers = offers.map(projectOfferForCache);
  return state.offers;
}

export function scheduleFeedRegeneration(expr = '0 * * * *') {
  cron.schedule(expr, () => {
    regenerateFeed().catch(e => console.error('[feed] cron regen failed:', e));
  });
  console.log(`[feed] regen scheduled: ${expr}`);
}
