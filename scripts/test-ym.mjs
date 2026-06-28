// Пробник API Я.Маркета: проверяем 4 эндпоинта на реальном кабинете.
// Запуск: npm run test:ym

const API_KEY = process.env.YM_API_KEY;
const BUSINESS_ID = process.env.YM_BUSINESS_ID;
const CAMPAIGN_ID = process.env.YM_CAMPAIGN_ID;
const BASE = 'https://api.partner.market.yandex.ru';

if (!API_KEY || !BUSINESS_ID || !CAMPAIGN_ID) {
  console.error('Не заданы YM_API_KEY / YM_BUSINESS_ID / YM_CAMPAIGN_ID в .env');
  process.exit(1);
}

async function ym(method, path, { body, query } = {}) {
  const url = new URL(BASE + path);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, {
    method,
    headers: {
      'Api-Key': API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

function preview(obj, max = 1500) {
  const s = typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2);
  return s.length > max ? s.slice(0, max) + `\n…(обрезано, всего ${s.length} символов)` : s;
}

async function step(title, fn) {
  console.log(`\n===== ${title} =====`);
  try {
    const r = await fn();
    if (!r.ok) {
      console.log(`HTTP ${r.status}`);
      console.log(preview(r.data));
      return null;
    }
    console.log(`HTTP ${r.status} OK`);
    return r.data;
  } catch (e) {
    console.log('Исключение:', e.message);
    return null;
  }
}

async function main() {
  // 1. Список товаров (первые 10)
  const mappings = await step('1. offer-mappings (первые 10)', () =>
    ym('POST', `/businesses/${BUSINESS_ID}/offer-mappings`, {
      query: { limit: 10 },
      body: {},
    })
  );
  const offers = mappings?.result?.offerMappings ?? [];
  console.log(`Получено офферов: ${offers.length}`);
  console.log(`nextPageToken: ${mappings?.result?.paging?.nextPageToken ?? '—'}`);
  for (const om of offers.slice(0, 5)) {
    console.log(`  • ${om.offer?.offerId} | ${om.offer?.name?.slice(0, 60) ?? ''}`);
  }
  if (offers.length === 0) {
    console.log('Дальше тестировать нечего.');
    return;
  }

  const offerIds = offers.map(o => o.offer?.offerId).filter(Boolean);

  // 2. Цены
  const prices = await step('2. offer-prices', () =>
    ym('POST', `/businesses/${BUSINESS_ID}/offer-prices`, {
      body: { offerIds },
    })
  );
  console.log(preview(prices));

  // 3. Остатки
  const stocks = await step('3. offers/stocks (по кампании)', () =>
    ym('POST', `/campaigns/${CAMPAIGN_ID}/offers/stocks`, {
      body: { offerIds },
    })
  );
  console.log(preview(stocks));

  // 4. Комиссии (tariffs/calculate)
  // Нужно: categoryId + price. categoryId берём из mapping, цену — из prices ответа,
  // если не нашли — ставим заглушку 1000, чтобы хотя бы проверить отклик API.
  const priceByOfferId = new Map();
  const priceList = prices?.result?.offers ?? [];
  for (const p of priceList) {
    const v = p.price?.value ?? p.price?.basicPrice?.value;
    if (p.offerId && v != null) priceByOfferId.set(p.offerId, Number(v));
  }
  const tariffOffers = offers.slice(0, 5).map(om => {
    const id = om.offer?.offerId;
    const categoryId = om.mapping?.marketCategoryId ?? om.awaitingModerationMapping?.marketCategoryId;
    const price = priceByOfferId.get(id) ?? 1000;
    const wd = om.offer?.weightDimensions;
    if (!categoryId || !wd) return null;
    return {
      categoryId,
      price,
      length: wd.length,
      width: wd.width,
      height: wd.height,
      weight: wd.weight,
    };
  }).filter(Boolean);

  if (tariffOffers.length === 0) {
    console.log('\n===== 4. tariffs/calculate =====');
    console.log('Не нашёл categoryId ни у одного оффера — пропускаю расчёт комиссий.');
  } else {
    const tariffs = await step('4. tariffs/calculate', () =>
      ym('POST', '/tariffs/calculate', {
        body: {
          parameters: { campaignId: Number(CAMPAIGN_ID) },
          offers: tariffOffers,
        },
      })
    );
    console.log(preview(tariffs));
  }

  console.log('\n=== Готово ===');
}

main().catch(e => { console.error(e); process.exit(1); });
