import { ym } from './client.mjs';
import {
  db, upsertOffer, upsertPrice, deleteStocksForOffer, insertStock, upsertCommission,
  startSyncRun, updateSyncRun, inTx,
} from '../db.mjs';

function mapOffer(om) {
  const offer = om.offer ?? {};
  const mapping = om.mapping ?? om.awaitingModerationMapping ?? {};
  const wd = offer.weightDimensions ?? {};
  const pic = (offer.pictures && offer.pictures[0]) ?? mapping.pictures?.[0] ?? null;
  return {
    offer_id: offer.offerId,
    name: offer.name ?? mapping.marketModelName ?? null,
    market_sku: mapping.marketSku ? String(mapping.marketSku) : null,
    category_id: mapping.marketCategoryId ?? null,
    category_name: mapping.marketCategoryName ?? null,
    image_url: pic ?? null,
    vendor: offer.vendor ?? null,
    barcode: Array.isArray(offer.barcodes) ? offer.barcodes[0] : null,
    length: wd.length ?? null,
    width: wd.width ?? null,
    height: wd.height ?? null,
    weight: wd.weight ?? null,
    updated_at: new Date().toISOString(),
    _category_id: mapping.marketCategoryId ?? null,
    _wd: wd,
  };
}

function mapPrice(p) {
  return {
    offer_id: p.offerId,
    value: p.price?.value ?? null,
    min_for_bestseller: p.price?.minimumForBestseller ?? null,
    currency: p.price?.currencyId ?? null,
    updated_at: p.price?.updatedAt ?? new Date().toISOString(),
  };
}

function aggregateTariffs(tariffsArr) {
  const s = {
    FEE: 0, FEE_PERCENT: null, AGENCY_COMMISSION: 0, PAYMENT_TRANSFER: 0,
    DELIVERY_TO_CUSTOMER: 0, MIDDLE_MILE: 0,
    LOGISTICS: 0, other: 0, total: 0,
  };
  for (const t of tariffsArr ?? []) {
    const amt = Number(t.amount) || 0;
    s.total += amt;
    if (t.type === 'FEE') {
      s.FEE += amt;
      const vt = t.parameters?.find(p => p.name === 'valueType')?.value;
      if (vt === 'relative') {
        const v = Number(t.parameters?.find(p => p.name === 'value')?.value);
        if (!Number.isNaN(v)) s.FEE_PERCENT = v;
      }
    }
    else if (t.type === 'AGENCY_COMMISSION') s.AGENCY_COMMISSION += amt;
    else if (t.type === 'PAYMENT_TRANSFER') s.PAYMENT_TRANSFER += amt;
    else if (t.type === 'DELIVERY_TO_CUSTOMER') { s.DELIVERY_TO_CUSTOMER += amt; s.LOGISTICS += amt; }
    else if (t.type === 'MIDDLE_MILE') { s.MIDDLE_MILE += amt; s.LOGISTICS += amt; }
    else s.other += amt;
  }
  return s;
}

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

export async function runSync({ pageSize = 100, priceBatch = 200, tariffBatch = 100 } = {}) {
  const runId = startSyncRun();
  log(`Старт синхронизации #${runId}`);

  let offersProcessed = 0, pricesProcessed = 0, stocksProcessed = 0, commissionsProcessed = 0, errors = 0;
  const errorMessages = [];

  try {
    for await (const pageOffers of ym.iterOfferMappings({ pageSize })) {
      if (pageOffers.length === 0) break;

      const mapped = pageOffers.map(mapOffer).filter(o => o.offer_id);

      // 1. Сохраняем офферы.
      inTx(() => { for (const o of mapped) upsertOffer(o); });
      offersProcessed += mapped.length;

      const offerIds = mapped.map(o => o.offer_id);

      // 2. Цены.
      try {
        for (let i = 0; i < offerIds.length; i += priceBatch) {
          const batch = offerIds.slice(i, i + priceBatch);
          const prices = await ym.getPrices(batch);
          inTx(() => { for (const p of prices) if (p.offerId) upsertPrice(mapPrice(p)); });
          pricesProcessed += prices.length;
        }
      } catch (e) {
        errors++;
        errorMessages.push(`prices: ${e.message}`);
        log(`! Ошибка цен: ${e.message}`);
      }

      // 3. Остатки. Удаляем старые записи по этим офферам и пишем новые,
      //    чтобы исчезнувшие остатки не висели в БД.
      try {
        inTx(() => { for (const id of offerIds) deleteStocksForOffer(id); });
        for (let i = 0; i < offerIds.length; i += priceBatch) {
          const batch = offerIds.slice(i, i + priceBatch);
          const warehouses = await ym.getStocks(batch);
          inTx(() => {
            const now = new Date().toISOString();
            for (const wh of warehouses) {
              for (const offer of wh.offers ?? []) {
                for (const st of offer.stocks ?? []) {
                  insertStock({
                    offer_id: offer.offerId,
                    warehouse_id: wh.warehouseId,
                    type: st.type,
                    count: st.count ?? 0,
                    updated_at: offer.updatedAt ?? now,
                  });
                  stocksProcessed++;
                }
              }
            }
          });
        }
      } catch (e) {
        errors++;
        errorMessages.push(`stocks: ${e.message}`);
        log(`! Ошибка остатков: ${e.message}`);
      }

      // 4. Комиссии: нужны категория, цена, габариты, вес. Цены берём свежие из БД.
      try {
        const priceMap = new Map();
        const rows = db.prepare(`SELECT offer_id, value FROM prices WHERE offer_id IN (${offerIds.map(() => '?').join(',')})`).all(...offerIds);
        for (const r of rows) priceMap.set(r.offer_id, r.value);

        const tariffEligible = mapped.map(o => {
          const price = priceMap.get(o.offer_id);
          const wd = o._wd;
          if (!o._category_id || !price || price <= 0 || !wd) return null;
          if (!(wd.length > 0) || !(wd.width > 0) || !(wd.height > 0) || !(wd.weight > 0)) return null;
          return {
            _offer_id: o.offer_id,
            _price: price,
            payload: {
              categoryId: o._category_id,
              price,
              length: wd.length,
              width: wd.width,
              height: wd.height,
              weight: wd.weight,
            },
          };
        }).filter(Boolean);

        const calcWithFallback = async (batch) => {
          try {
            return await ym.calculateTariffs(batch.map(b => b.payload));
          } catch (e) {
            if (e.status !== 400 || batch.length === 1) throw e;
            const mid = Math.floor(batch.length / 2);
            const [a, b] = [batch.slice(0, mid), batch.slice(mid)];
            const ra = await calcWithFallback(a).catch(err => { errors++; errorMessages.push(`tariff-half: ${err.message}`); return []; });
            const rb = await calcWithFallback(b).catch(err => { errors++; errorMessages.push(`tariff-half: ${err.message}`); return []; });
            return [...ra, ...rb];
          }
        };

        for (let i = 0; i < tariffEligible.length; i += tariffBatch) {
          const batch = tariffEligible.slice(i, i + tariffBatch);
          // result параллелен input по индексу; при fallback мы делим батч и склеиваем
          // результаты в исходном порядке, так что индексация остаётся валидной.
          const result = await calcWithFallback(batch);
          inTx(() => {
            const now = new Date().toISOString();
            for (let j = 0; j < result.length && j < batch.length; j++) {
              const r = result[j];
              const meta = batch[j];
              if (!meta || !r) continue;
              const sums = aggregateTariffs(r.tariffs);
              upsertCommission({
                offer_id: meta._offer_id,
                fee_amount: sums.FEE,
                fee_percent: sums.FEE_PERCENT,
                agency_amount: sums.AGENCY_COMMISSION,
                payment_amount: sums.PAYMENT_TRANSFER,
                delivery_amount: sums.DELIVERY_TO_CUSTOMER,
                middle_mile_amount: sums.MIDDLE_MILE,
                logistics_amount: sums.LOGISTICS,
                other_amount: sums.other,
                total_amount: sums.total,
                calculated_for_price: meta._price,
                raw_json: JSON.stringify(r.tariffs ?? []),
                updated_at: now,
              });
              commissionsProcessed++;
            }
          });
        }
      } catch (e) {
        errors++;
        errorMessages.push(`commissions: ${e.message}`);
        log(`! Ошибка комиссий: ${e.message}`);
      }

      log(`offers=${offersProcessed} prices=${pricesProcessed} stocks=${stocksProcessed} commissions=${commissionsProcessed} errors=${errors}`);

      updateSyncRun(runId, {
        offers_processed: offersProcessed,
        prices_processed: pricesProcessed,
        stocks_processed: stocksProcessed,
        commissions_processed: commissionsProcessed,
        errors_count: errors,
      });
    }

    updateSyncRun(runId, {
      finished_at: new Date().toISOString(),
      status: errors === 0 ? 'success' : 'partial',
      offers_processed: offersProcessed,
      prices_processed: pricesProcessed,
      stocks_processed: stocksProcessed,
      commissions_processed: commissionsProcessed,
      errors_count: errors,
      details: errorMessages.slice(0, 20).join('\n') || null,
    });
    log(`Готово #${runId}: offers=${offersProcessed} prices=${pricesProcessed} stocks=${stocksProcessed} commissions=${commissionsProcessed} errors=${errors}`);
    return { runId, offersProcessed, pricesProcessed, stocksProcessed, commissionsProcessed, errors };
  } catch (e) {
    updateSyncRun(runId, {
      finished_at: new Date().toISOString(),
      status: 'error',
      error_message: e.message,
      offers_processed: offersProcessed,
      prices_processed: pricesProcessed,
      stocks_processed: stocksProcessed,
      commissions_processed: commissionsProcessed,
      errors_count: errors,
    });
    log(`Фатал #${runId}: ${e.message}`);
    throw e;
  }
}
