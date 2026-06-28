// Считаем сколько всего офферов в кабинете ЯМ.
const API_KEY = process.env.YM_API_KEY;
const BUSINESS_ID = process.env.YM_BUSINESS_ID;
const BASE = 'https://api.partner.market.yandex.ru';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchPage(pageToken, attempt = 1) {
  const url = new URL(`${BASE}/businesses/${BUSINESS_ID}/offer-mappings`);
  url.searchParams.set('limit', '200');
  if (pageToken) url.searchParams.set('page_token', pageToken);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Api-Key': API_KEY, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(30000),
    });
    if (res.status === 429 || res.status >= 500) {
      if (attempt > 5) throw new Error(`HTTP ${res.status} after 5 attempts`);
      const wait = 1000 * 2 ** attempt;
      console.log(`\nHTTP ${res.status}, ретрай через ${wait}ms (попытка ${attempt})`);
      await sleep(wait);
      return fetchPage(pageToken, attempt + 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  } catch (e) {
    if (attempt > 5) throw e;
    const wait = 1000 * 2 ** attempt;
    console.log(`\nОшибка сети: ${e.message}, ретрай через ${wait}ms (попытка ${attempt})`);
    await sleep(wait);
    return fetchPage(pageToken, attempt + 1);
  }
}

let total = 0;
let pageToken;
let pages = 0;
const t0 = Date.now();
do {
  const data = await fetchPage(pageToken);
  const offers = data?.result?.offerMappings ?? [];
  total += offers.length;
  pages++;
  pageToken = data?.result?.paging?.nextPageToken;
  console.log(`страниц: ${pages}, офферов: ${total}`);
  if (pageToken) await sleep(250);
} while (pageToken);
console.log(`ИТОГО: ${total} офферов за ${pages} страниц(ы), ${((Date.now() - t0) / 1000).toFixed(1)} с`);
