// Импортируем YML-фид поставщика → SQLite. Парсим стримом sax (122+ МБ файла).
import sax from 'sax';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { db, inTx, upsertSupplierOffer, upsertSupplierCategory, startSupplierImport, updateSupplierImport } from '../db.mjs';

const log = (...a) => console.log(`[${new Date().toLocaleTimeString()}]`, ...a);

/** Открывает HTTP-стрим. Если задан file://путь — читает локально. */
async function openFeed(url) {
  if (url.startsWith('http://') || url.startsWith('https://')) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return Readable.fromWeb(res.body);
  }
  if (url.startsWith('file://')) {
    const { createReadStream } = await import('node:fs');
    return createReadStream(new URL(url));
  }
  throw new Error(`Неизвестный URL: ${url}`);
}

export async function runSupplierImport({ url, batchSize = 500 } = {}) {
  const feedUrl = url ?? process.env.SUPPLIER_FEED_URL;
  if (!feedUrl) throw new Error('SUPPLIER_FEED_URL не задан');

  const importId = startSupplierImport();
  log(`Старт импорта поставщика #${importId} из ${feedUrl}`);

  let offersBuf = [];
  let categoriesBuf = [];
  let offersTotal = 0, categoriesTotal = 0;

  const flushOffers = () => {
    if (offersBuf.length === 0) return;
    inTx(() => { for (const o of offersBuf) upsertSupplierOffer(o); });
    offersTotal += offersBuf.length;
    offersBuf = [];
    if (offersTotal % 5000 === 0) {
      log(`offers=${offersTotal} categories=${categoriesTotal}`);
      updateSupplierImport(importId, { offers_processed: offersTotal, categories_processed: categoriesTotal });
    }
  };

  const flushCategories = () => {
    if (categoriesBuf.length === 0) return;
    inTx(() => { for (const c of categoriesBuf) upsertSupplierCategory(c); });
    categoriesTotal += categoriesBuf.length;
    categoriesBuf = [];
  };

  try {
    await new Promise(async (resolve, reject) => {
      const parser = sax.createStream(true, { lowercase: false, trim: false });

      let cur = null;          // текущий <offer> объект
      let curCategory = null;  // текущая <category>
      let lastTag = null;      // имя последнего открытого тега внутри offer
      const now = new Date().toISOString();

      parser.on('opentag', (node) => {
        if (node.name === 'offer') {
          cur = {
            offer_id: node.attributes.id ?? null,
            available: node.attributes.available === 'true' ? 1 : (node.attributes.available === 'false' ? 0 : null),
            currency: 'RUB',
            updated_at: now,
          };
          lastTag = null;
          return;
        }
        if (node.name === 'category') {
          curCategory = {
            id: Number(node.attributes.id),
            parent_id: node.attributes.parentId ? Number(node.attributes.parentId) : null,
            name: '',
          };
          lastTag = 'category';
          return;
        }
        if (cur) {
          lastTag = node.name;
        }
      });

      parser.on('text', (text) => {
        if (curCategory && lastTag === 'category') {
          curCategory.name += text;
          return;
        }
        if (!cur || !lastTag) return;
        const trimmed = text;
        switch (lastTag) {
          case 'price': cur.price = parseFloat(trimmed); break;
          case 'purchase_price': cur.purchase_price = parseFloat(trimmed); break;
          case 'minimum_price_for_bestseller': cur.min_for_bestseller = parseFloat(trimmed); break;
          case 'currencyId': cur.currency = trimmed.trim() || cur.currency; break;
          case 'categoryId': cur.supplier_category_id = parseInt(trimmed, 10); break;
          case 'picture': cur.picture = (cur.picture ? cur.picture : '') + trimmed; break;
          case 'name': cur.name = (cur.name ?? '') + trimmed; break;
          case 'vendor': cur.vendor = (cur.vendor ?? '') + trimmed; break;
          case 'vendorCode': cur.vendor_code = (cur.vendor_code ?? '') + trimmed; break;
          case 'description': cur.description = (cur.description ?? '') + trimmed; break;
          case 'url': cur.url = (cur.url ?? '') + trimmed; break;
          case 'sales_notes': cur.sales_notes = (cur.sales_notes ?? '') + trimmed; break;
          case 'count': cur.count = parseInt(trimmed, 10); break;
          case 'weight': cur.weight = parseFloat(trimmed); break;
          case 'country_of_origin': cur.country = (cur.country ?? '') + trimmed; break;
          case 'dimensions': cur.dimensions = (cur.dimensions ?? '') + trimmed; break;
        }
      });

      parser.on('cdata', (text) => {
        if (!cur || !lastTag) return;
        // То же что и text, но из CDATA.
        parser.emit('text', text);
      });

      parser.on('closetag', (name) => {
        if (name === 'category' && curCategory) {
          curCategory.name = curCategory.name.trim();
          categoriesBuf.push(curCategory);
          if (categoriesBuf.length >= 200) flushCategories();
          curCategory = null;
          lastTag = null;
          return;
        }
        if (name === 'offer' && cur) {
          if (cur.offer_id) {
            for (const k of ['name', 'vendor', 'vendor_code', 'description', 'url', 'picture', 'country', 'dimensions', 'sales_notes']) {
              if (typeof cur[k] === 'string') cur[k] = cur[k].trim();
            }
            offersBuf.push(cur);
            if (offersBuf.length >= batchSize) flushOffers();
          }
          cur = null;
          lastTag = null;
          return;
        }
        if (cur && name === lastTag) {
          lastTag = null;
        }
      });

      parser.on('error', (e) => {
        parser._parser.error = null;
        parser._parser.resume();
        console.warn('XML error:', e.message);
      });

      parser.on('end', () => {
        flushCategories();
        flushOffers();
        resolve();
      });

      try {
        const stream = await openFeed(feedUrl);
        stream.on('error', reject);
        stream.pipe(parser);
      } catch (e) {
        reject(e);
      }
    });

    updateSupplierImport(importId, {
      finished_at: new Date().toISOString(),
      status: 'success',
      offers_processed: offersTotal,
      categories_processed: categoriesTotal,
    });
    log(`Готово #${importId}: offers=${offersTotal} categories=${categoriesTotal}`);
    return { importId, offersTotal, categoriesTotal };
  } catch (e) {
    updateSupplierImport(importId, {
      finished_at: new Date().toISOString(),
      status: 'error',
      offers_processed: offersTotal,
      categories_processed: categoriesTotal,
      error_message: e.message,
    });
    throw e;
  }
}
