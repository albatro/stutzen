const BASE = 'https://api-seller.ozon.ru';

const CLIENT_ID = process.env.OZON_CLIENT_ID;
const API_KEY = process.env.OZON_API_KEY;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIN_INTERVAL_MS = 200;
let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export async function ozonFetch(method, path, body, attempt = 1) {
  if (!CLIENT_ID || !API_KEY) throw new Error('OZON_CLIENT_ID / OZON_API_KEY не заданы');
  await throttle();
  const url = new URL(BASE + path);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Client-Id': CLIENT_ID,
        'Api-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });

    if (res.status === 429 || res.status >= 500) {
      if (attempt > 6) throw new Error(`HTTP ${res.status} после 6 попыток: ${path}`);
      const wait = Math.min(60000, 1000 * 2 ** attempt);
      console.warn(`[OZON] HTTP ${res.status} on ${path}, ретрай через ${wait}ms (попытка ${attempt})`);
      await sleep(wait);
      return ozonFetch(method, path, body, attempt + 1);
    }

    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = text; }

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status} ${path}: ${typeof data === 'string' ? data : JSON.stringify(data)}`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  } catch (e) {
    if (e.status) throw e;
    if (attempt > 6) throw e;
    const wait = Math.min(60000, 1000 * 2 ** attempt);
    console.warn(`[OZON] Сетевая ошибка ${path}: ${e.message}, ретрай через ${wait}ms (попытка ${attempt})`);
    await sleep(wait);
    return ozonFetch(method, path, body, attempt + 1);
  }
}

export const ozon = {
  // Список всех продуктов (только product_id + offer_id), пагинация через last_id.
  async *iterProducts({ pageSize = 1000 } = {}) {
    let lastId = '';
    while (true) {
      const data = await ozonFetch('POST', '/v2/product/list', {
        filter: { visibility: 'ALL' },
        last_id: lastId,
        limit: pageSize,
      });
      const items = data?.result?.items ?? [];
      if (items.length === 0) break;
      yield items;
      lastId = data?.result?.last_id ?? '';
      if (!lastId || items.length < pageSize) break;
    }
  },

  // Детальная информация: имя, категория, фото, штрих-код (до 1000 за раз).
  async getProductsInfo(productIds) {
    if (productIds.length === 0) return [];
    const data = await ozonFetch('POST', '/v3/product/info/list', {
      product_id: productIds,
    });
    return data?.result?.items ?? [];
  },

  // Цены (пагинированный).
  async *iterPrices({ pageSize = 1000 } = {}) {
    let lastId = '';
    while (true) {
      const data = await ozonFetch('POST', '/v5/product/info/prices', {
        filter: { visibility: 'ALL' },
        last_id: lastId,
        limit: pageSize,
      });
      const items = data?.result?.items ?? [];
      if (items.length === 0) break;
      yield items;
      lastId = data?.result?.last_id ?? '';
      if (!lastId || items.length < pageSize) break;
    }
  },

  // Остатки по складам (пагинированный).
  async *iterStocks({ pageSize = 1000 } = {}) {
    let lastId = '';
    while (true) {
      const data = await ozonFetch('POST', '/v4/product/info/stocks', {
        filter: { visibility: 'ALL' },
        last_id: lastId,
        limit: pageSize,
      });
      const items = data?.result?.items ?? [];
      if (items.length === 0) break;
      yield items;
      lastId = data?.result?.last_id ?? '';
      if (!lastId || items.length < pageSize) break;
    }
  },

  // Комиссии по списку product_id (до 1000 за раз).
  async getCommissions(productIds) {
    if (productIds.length === 0) return [];
    const data = await ozonFetch('POST', '/v1/product/info/commission', {
      product_id: productIds,
    });
    return data?.result ?? [];
  },
};
