# Stutzen — витрина товаров Я.Маркет

Локальный инструмент: тянет карточки/цены/остатки/комиссии из ЯМ в SQLite и показывает таблицу.

## Запуск

```
npm install
npm start        # http://localhost:3030
```

Параллельно можно (или вместо «Обновить» в UI):
```
npm run sync     # разовая синхронизация в консоли
npm run test:ym  # пробник 4 эндпоинтов ЯМ
npm run count    # посчитать кол-во офферов в кабинете
```

## Конфиг `.env`

```
YM_API_KEY=ACMA:xxx:xxx
YM_BUSINESS_ID=000000000
YM_CAMPAIGN_ID=000000000
PORT=3030
# SYNC_CRON=0 * * * *   # раскомментируй чтобы синхронизироваться по расписанию
```

## Что внутри

- `src/db.mjs` — SQLite (`node:sqlite`, файл `data/stutzen.db`), схема.
- `src/ym/client.mjs` — клиент ЯМ API: пагинация, ретраи, троттлинг 250 мс.
- `src/ym/sync.mjs` — синхронизатор: offers → prices → stocks → commissions, постранично.
- `src/server.mjs` — Express: `/api/offers`, `/api/categories`, `/api/stats`, `POST /api/sync`.
- `public/index.html` + `app.js` — таблица на Tabulator с поиском, фильтром по категории, серверной пагинацией/сортировкой.

## Колонки таблицы

фото, SKU, название, категория, цена, мин. для лидера, остаток, комиссия (₽), комиссия (%), обновлено.
