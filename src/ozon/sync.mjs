import { ozon } from './client.mjs';
import {
  upsertOzonProduct, upsertOzonPrice,
  deleteOzonStocksForProduct, insertOzonStock,
  upsertOzonCommission,
  startOzonSyncRun, updateOzonSyncRun, inTx,
} from '../db.mjs';

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);
const INFO_BATCH = 1000;

export async function runOzonSync() {
  const runId = startOzonSyncRun();
  log(`[OZON] Старт синхронизации #${runId}`);

  let productsProcessed = 0, pricesProcessed = 0, stocksProcessed = 0, commissionsProcessed = 0, errors = 0;
  const errorMessages = [];

  try {
    // 1. Собираем все product_id + offer_id.
    const allProductIds = [];
    const offerIdMap = new Map();

    for await (const page of ozon.iterProducts()) {
      for (const item of page) {
        allProductIds.push(item.product_id);
        offerIdMap.set(item.product_id, item.offer_id ?? null);
      }
    }
    log(`[OZON] Найдено ${allProductIds.length} продуктов`);

    const now = new Date().toISOString();

    // 2. Детальная информация (имя, категория, фото) — батчами по INFO_BATCH.
    for (let i = 0; i < allProductIds.length; i += INFO_BATCH) {
      const batch = allProductIds.slice(i, i + INFO_BATCH);
      try {
        const items = await ozon.getProductsInfo(batch);
        inTx(() => {
          for (const item of items) {
            upsertOzonProduct({
              product_id: item.id,
              offer_id: item.offer_id ?? offerIdMap.get(item.id) ?? null,
              name: item.name ?? null,
              category_id: item.category_id ?? item.description_category_id ?? null,
              category_name: item.category_name ?? null,
              image_url: item.primary_image ?? item.images?.[0] ?? null,
              barcode: item.barcode ?? null,
              status: item.status?.state ?? null,
              is_archived: item.is_archived ? 1 : 0,
              updated_at: now,
            });
            productsProcessed++;
          }
        });
      } catch (e) {
        errors++;
        errorMessages.push(`products-info: ${e.message}`);
        log(`! [OZON] Ошибка инфо продуктов: ${e.message}`);
      }
      updateOzonSyncRun(runId, { products_processed: productsProcessed, errors_count: errors });
    }
    log(`[OZON] Продукты сохранены: ${productsProcessed}`);

    // 3. Цены + комиссии (commissions приходят внутри каждого item от /v5/product/info/prices).
    try {
      for await (const page of ozon.iterPrices()) {
        inTx(() => {
          for (const item of page) {
            const p = item.price ?? {};
            upsertOzonPrice({
              product_id: item.product_id,
              price: parseFloat(p.price) || null,
              old_price: parseFloat(p.old_price) || null,
              min_price: parseFloat(p.min_price) || null,
              marketing_price: parseFloat(p.marketing_price) || null,
              currency: 'RUB',
              updated_at: now,
            });
            pricesProcessed++;

            // Комиссии идут вместе с ценами.
            const c = item.commissions;
            if (c) {
              upsertOzonCommission({
                product_id: item.product_id,
                fbo_commission_percent: c.sales_percent_fbo ?? c.sales_percent ?? null,
                fbo_fulfillment_amount: c.fbo_fulfillment_amount ?? null,
                fbo_deliv_amount: c.fbo_deliv_to_customer_amount ?? null,
                fbs_commission_percent: c.sales_percent_fbs ?? c.sales_percent ?? null,
                fbs_first_mile_amount: c.fbs_first_mile_min_amount ?? null,
                fbs_deliv_amount: c.fbs_deliv_to_customer_amount ?? null,
                raw_json: JSON.stringify(c),
                updated_at: now,
              });
              commissionsProcessed++;
            }
          }
        });
        updateOzonSyncRun(runId, { prices_processed: pricesProcessed, commissions_processed: commissionsProcessed });
      }
    } catch (e) {
      errors++;
      errorMessages.push(`prices: ${e.message}`);
      log(`! [OZON] Ошибка цен: ${e.message}`);
    }
    log(`[OZON] Цены: ${pricesProcessed}, комиссии: ${commissionsProcessed}`);

    // 4. Остатки — полная замена.
    try {
      const cleared = new Set();
      for await (const page of ozon.iterStocks()) {
        inTx(() => {
          for (const item of page) {
            if (!cleared.has(item.product_id)) {
              deleteOzonStocksForProduct(item.product_id);
              cleared.add(item.product_id);
            }
            for (const st of item.stocks ?? []) {
              insertOzonStock({
                product_id: item.product_id,
                warehouse_id: st.warehouse_id,
                type: st.type ?? 'fbo',
                present: st.present ?? 0,
                reserved: st.reserved ?? 0,
                warehouse_name: st.warehouse_name ?? null,
                updated_at: now,
              });
              stocksProcessed++;
            }
          }
        });
        updateOzonSyncRun(runId, { stocks_processed: stocksProcessed });
      }
    } catch (e) {
      errors++;
      errorMessages.push(`stocks: ${e.message}`);
      log(`! [OZON] Ошибка остатков: ${e.message}`);
    }
    log(`[OZON] Остатки сохранены: ${stocksProcessed}`);

    updateOzonSyncRun(runId, {
      finished_at: new Date().toISOString(),
      status: errors === 0 ? 'success' : 'partial',
      products_processed: productsProcessed,
      prices_processed: pricesProcessed,
      stocks_processed: stocksProcessed,
      commissions_processed: commissionsProcessed,
      errors_count: errors,
      details: errorMessages.slice(0, 20).join('\n') || null,
    });
    log(`[OZON] Готово #${runId}: products=${productsProcessed} prices=${pricesProcessed} stocks=${stocksProcessed} commissions=${commissionsProcessed} errors=${errors}`);
    return { runId, productsProcessed, pricesProcessed, stocksProcessed, commissionsProcessed, errors };

  } catch (e) {
    updateOzonSyncRun(runId, {
      finished_at: new Date().toISOString(),
      status: 'error',
      error_message: e.message,
      products_processed: productsProcessed,
      prices_processed: pricesProcessed,
      stocks_processed: stocksProcessed,
      commissions_processed: commissionsProcessed,
      errors_count: errors,
    });
    log(`[OZON] Фатал #${runId}: ${e.message}`);
    throw e;
  }
}
