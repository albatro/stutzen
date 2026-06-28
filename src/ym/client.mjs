const BASE = 'https://api.partner.market.yandex.ru';

const API_KEY = process.env.YM_API_KEY;
const BUSINESS_ID = process.env.YM_BUSINESS_ID;
const CAMPAIGN_ID = process.env.YM_CAMPAIGN_ID;

if (!API_KEY || !BUSINESS_ID || !CAMPAIGN_ID) {
  throw new Error('YM_API_KEY / YM_BUSINESS_ID / YM_CAMPAIGN_ID не заданы');
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Минимальная пауза между запросами, чтобы не упереться в rate limit.
const MIN_INTERVAL_MS = 250;
let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = lastRequestAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

export async function ymFetch(method, path, { body, query } = {}, attempt = 1) {
  await throttle();
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));

  try {
    const res = await fetch(url, {
      method,
      headers: {
        'Api-Key': API_KEY,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(45000),
    });

    if (res.status === 429 || res.status >= 500) {
      if (attempt > 6) throw new Error(`HTTP ${res.status} после 6 попыток: ${path}`);
      const wait = Math.min(60000, 1000 * 2 ** attempt);
      console.warn(`[YM] HTTP ${res.status} on ${path}, ретрай через ${wait}ms (попытка ${attempt})`);
      await sleep(wait);
      return ymFetch(method, path, { body, query }, attempt + 1);
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
    console.warn(`[YM] Сетевая ошибка ${path}: ${e.message}, ретрай через ${wait}ms (попытка ${attempt})`);
    await sleep(wait);
    return ymFetch(method, path, { body, query }, attempt + 1);
  }
}

export const ym = {
  businessId: BUSINESS_ID,
  campaignId: CAMPAIGN_ID,

  async *iterOfferMappings({ pageSize = 200 } = {}) {
    let pageToken;
    do {
      const query = { limit: pageSize };
      if (pageToken) query.page_token = pageToken;
      const data = await ymFetch('POST', `/businesses/${BUSINESS_ID}/offer-mappings`, {
        query, body: {},
      });
      const offers = data?.result?.offerMappings ?? [];
      yield offers;
      pageToken = data?.result?.paging?.nextPageToken;
    } while (pageToken);
  },

  async getPrices(offerIds) {
    if (offerIds.length === 0) return [];
    const data = await ymFetch('POST', `/businesses/${BUSINESS_ID}/offer-prices`, {
      body: { offerIds },
    });
    return data?.result?.offers ?? [];
  },

  async getStocks(offerIds) {
    if (offerIds.length === 0) return [];
    const all = [];
    let pageToken;
    do {
      const query = { limit: 200 };
      if (pageToken) query.page_token = pageToken;
      const data = await ymFetch('POST', `/campaigns/${CAMPAIGN_ID}/offers/stocks`, {
        query, body: { withTurnover: false, offerIds },
      });
      const warehouses = data?.result?.warehouses ?? [];
      all.push(...warehouses);
      pageToken = data?.result?.paging?.nextPageToken;
    } while (pageToken);
    return all;
  },

  async calculateTariffs(offers) {
    if (offers.length === 0) return [];
    const data = await ymFetch('POST', `/tariffs/calculate`, {
      body: {
        parameters: { campaignId: Number(CAMPAIGN_ID) },
        offers,
      },
    });
    return data?.result?.offers ?? [];
  },

  // Итерация заказов через /stats/orders. dateFrom/dateTo — YYYY-MM-DD.
  async *iterOrders({ dateFrom, dateTo, pageSize = 200 }) {
    let nextPageToken;
    do {
      const query = { pageSize };
      if (nextPageToken) query.page_token = nextPageToken;
      const data = await ymFetch('POST', `/campaigns/${CAMPAIGN_ID}/stats/orders`, {
        query, body: { dateFrom, dateTo },
      });
      const orders = data?.result?.orders ?? [];
      yield orders;
      nextPageToken = data?.result?.paging?.nextPageToken;
    } while (nextPageToken);
  },

  // offers: [{ offerId, price }] — цена в рублях. ЯМ принимает до 500 за раз.
  async updatePrices(offersList) {
    if (offersList.length === 0) return;
    const payload = {
      offers: offersList.map(o => ({
        offerId: o.offerId,
        price: { value: o.price, currencyId: 'RUR' },
      })),
    };
    await ymFetch('POST', `/businesses/${BUSINESS_ID}/offer-prices/updates`, { body: payload });
  },
};
