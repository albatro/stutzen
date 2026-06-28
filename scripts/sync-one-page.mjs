// Прогоняем синхронизацию одной страницы (10 офферов) — sanity check схемы.
import { ym } from '../src/ym/client.mjs';
import { db, upsertOffer, upsertPrice, deleteStocksForOffer, insertStock, upsertCommission, inTx } from '../src/db.mjs';

const iter = ym.iterOfferMappings({ pageSize: 10 });
const { value: pageOffers } = await iter.next();
console.log(`Получено ${pageOffers.length} офферов`);

function mapOffer(om) {
  const offer = om.offer ?? {};
  const mapping = om.mapping ?? om.awaitingModerationMapping ?? {};
  const wd = offer.weightDimensions ?? {};
  const pic = (offer.pictures && offer.pictures[0]) ?? null;
  return {
    offer_id: offer.offerId,
    name: offer.name ?? null,
    market_sku: mapping.marketSku ? String(mapping.marketSku) : null,
    category_id: mapping.marketCategoryId ?? null,
    category_name: mapping.marketCategoryName ?? null,
    image_url: pic,
    vendor: offer.vendor ?? null,
    barcode: Array.isArray(offer.barcodes) ? offer.barcodes[0] : null,
    length: wd.length ?? null,
    width: wd.width ?? null,
    height: wd.height ?? null,
    weight: wd.weight ?? null,
    updated_at: new Date().toISOString(),
  };
}

const mapped = pageOffers.map(mapOffer);
inTx(() => { for (const o of mapped) upsertOffer(o); });
console.log('upsert offers OK');

const ids = mapped.map(o => o.offer_id);
const prices = await ym.getPrices(ids);
console.log(`prices: ${prices.length}`);
inTx(() => {
  for (const p of prices) upsertPrice({
    offer_id: p.offerId,
    value: p.price?.value ?? null,
    min_for_bestseller: p.price?.minimumForBestseller ?? null,
    currency: p.price?.currencyId ?? null,
    updated_at: p.price?.updatedAt ?? new Date().toISOString(),
  });
});

const warehouses = await ym.getStocks(ids);
console.log(`warehouses: ${warehouses.length}`);
inTx(() => {
  for (const id of ids) deleteStocksForOffer(id);
  const now = new Date().toISOString();
  for (const wh of warehouses) for (const off of wh.offers ?? []) for (const st of off.stocks ?? []) {
    insertStock({ offer_id: off.offerId, warehouse_id: wh.warehouseId, type: st.type, count: st.count ?? 0, updated_at: off.updatedAt ?? now });
  }
});

const counts = {
  offers: db.prepare('SELECT COUNT(*) AS c FROM offers').get().c,
  prices: db.prepare('SELECT COUNT(*) AS c FROM prices').get().c,
  stocks: db.prepare('SELECT COUNT(*) AS c FROM stocks').get().c,
};
console.log('Счётчики БД:', counts);
console.log('Sanity OK');
