// Импорт заказов из ЯМ за период.
import { ym } from '../ym/client.mjs';
import {
  db, inTx, upsertSalesOrder, upsertSalesItem, startSalesImport, updateSalesImport,
} from '../db.mjs';

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

function priceOf(prices, type) {
  return prices?.find(p => p.type === type) ?? null;
}

export async function runSalesImport({ dateFrom, dateTo } = {}) {
  const today = new Date();
  if (!dateTo) dateTo = today.toISOString().slice(0, 10);
  if (!dateFrom) {
    const past = new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000);
    dateFrom = past.toISOString().slice(0, 10);
  }

  const importId = startSalesImport(dateFrom, dateTo);
  log(`Старт импорта продаж #${importId} ${dateFrom} → ${dateTo}`);

  let ordersTotal = 0, itemsTotal = 0;
  try {
    for await (const pageOrders of ym.iterOrders({ dateFrom, dateTo, pageSize: 200 })) {
      if (pageOrders.length === 0) break;

      inTx(() => {
        const now = new Date().toISOString();
        for (const o of pageOrders) {
          upsertSalesOrder({
            order_id: o.id,
            status: o.status,
            creation_date: o.creationDate,
            status_update_date: o.statusUpdateDate,
            payment_type: o.paymentType,
            buyer_type: o.buyerType,
            currency: o.currency,
            delivery_region: o.deliveryRegion?.name,
            fake: o.fake,
            imported_at: now,
          });
          for (const it of o.items ?? []) {
            const mp = priceOf(it.prices, 'MARKETPLACE');
            const by = priceOf(it.prices, 'BUYER');
            upsertSalesItem({
              order_id: o.id,
              offer_id: it.shopSku,
              market_sku: it.marketSku ? String(it.marketSku) : null,
              offer_name: it.offerName,
              count: it.count,
              marketplace_price: mp?.costPerItem ?? null,
              buyer_price: by?.costPerItem ?? null,
              marketplace_total: mp?.total ?? null,
              buyer_total: by?.total ?? null,
              warehouse_id: it.warehouse?.id ?? null,
              warehouse_name: it.warehouse?.name ?? null,
            });
            itemsTotal++;
          }
        }
      });
      ordersTotal += pageOrders.length;
      log(`orders=${ordersTotal} items=${itemsTotal}`);
      updateSalesImport(importId, { orders_processed: ordersTotal, items_processed: itemsTotal });
    }

    updateSalesImport(importId, {
      finished_at: new Date().toISOString(),
      status: 'success',
      orders_processed: ordersTotal,
      items_processed: itemsTotal,
    });
    log(`Готово #${importId}: orders=${ordersTotal} items=${itemsTotal}`);
    return { importId, ordersTotal, itemsTotal };
  } catch (e) {
    updateSalesImport(importId, {
      finished_at: new Date().toISOString(),
      status: 'error',
      orders_processed: ordersTotal,
      items_processed: itemsTotal,
      error_message: e.message,
    });
    throw e;
  }
}
