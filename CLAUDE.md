# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All scripts assume Node **22+** (uses native `node:sqlite`) and load `.env` via `--env-file`.

```
npm install
npm start                # Express server on http://localhost:${PORT:-3000}
npm run sync             # one-off full YM sync (offers → prices → stocks → commissions)
npm run test:ym          # probe 4 YM endpoints — smoke test API key/IDs
npm run count            # count offers in the YM cabinet
npm run import:supplier  # stream YML feed from SUPPLIER_FEED_URL into SQLite
npm run import:sales     # import YM orders (default: last 365 days)
```

One-off maintenance scripts live in `scripts/` and are run directly, e.g. `node --env-file=.env scripts/backfill-fee-percent.mjs`, `scripts/fill-missing-commissions.mjs`, `scripts/sync-one-page.mjs` (useful for debugging a single page instead of a full sync).

There is **no test suite, no linter, no build step** — the server runs the `.mjs` sources directly.

## Environment

Required in `.env` (see `.env.example`):
- `YM_API_KEY`, `YM_BUSINESS_ID`, `YM_CAMPAIGN_ID` — Yandex.Market Partner API credentials. `src/ym/client.mjs` throws at import time if any is missing, so *any* script that touches YM will refuse to start without them.
- `SUPPLIER_FEED_URL` — YML/XML supplier feed (http(s) or `file://`).
- `PORT` — HTTP port (default 3000; README uses 3030 locally; docker-compose maps `127.0.0.1:8091 → 3000`).
- `SYNC_CRON` (optional) — if set, `src/server.mjs` schedules `runSync()` via `node-cron`.

## Architecture

Small monolith: one Express process, one SQLite file (`data/stutzen.db`), five static HTML pages served from `public/`. No framework on the frontend — vanilla JS + Tabulator loaded from CDN. All UI text, comments, and log messages are in Russian; money is RUB throughout.

### Data flow (the important picture)

```
YM API ──iterOfferMappings──▶ offers        ┐
       ──getPrices──────────▶ prices        │
       ──getStocks──────────▶ stocks        ├─ src/ym/sync.mjs
       ──calculateTariffs──▶ commissions   ┘   (per page, in txns)

YML feed ──sax stream──▶ supplier_offers + supplier_categories   (src/supplier/import.mjs)

YM /stats/orders ──▶ sales_orders + sales_items                  (src/sales/import.mjs)

markup_rules + supplier.purchase_price + commissions.fee_percent + commissions.middle_mile_amount
    └─▶ src/pricing/calculator.mjs → proposed prices → POST /businesses/.../offer-prices/updates
```

The DB is the join point for every UI query — no live YM calls from request handlers, only from the sync/import jobs.

### Key modules

- **`src/db.mjs`** — opens the SQLite DB (WAL + `foreign_keys=ON`), defines the full schema inline, runs *idempotent* migrations as `try { ALTER TABLE … } catch {}` (this is the pattern for adding columns — do not introduce a migration framework), and exports typed upsert helpers + `inTx(fn)`. Ensures a `markup_rules` row with `scope='global'` exists on boot.
- **`src/ym/client.mjs`** — the only place that talks to `api.partner.market.yandex.ru`. Global 250ms throttle between requests (`MIN_INTERVAL_MS`) and exponential backoff on 429/5xx up to 6 attempts. Exposes async iterators for paginated endpoints (`iterOfferMappings`, `iterOrders`) and batch helpers (`getPrices`, `getStocks`, `calculateTariffs`, `updatePrices`).
- **`src/ym/sync.mjs`** — the sync orchestrator. Processes one page of offers at a time and, for each page, upserts offers → refreshes prices → fully **replaces** stocks for those offer IDs (deletes then inserts so vanished warehouses don't linger) → recalculates commissions. Tariff calls that 400 are split in half recursively (`calcWithFallback`), so a single bad offer can't kill a whole batch. `sync_runs` tracks per-run counts and partial-error status.
- **`src/pricing/calculator.mjs`** — target-price math. Encodes hard-coded YM tariff rules (see file header): `PAYMENT_TRANSFER 3.30%`, `DELIVERY_TO_CUSTOMER 5% capped at 1000₽ (kicks in above ~20000₽ price)`, `AGENCY_COMMISSION 0.12₽`. Solves for a price such that `price − Σ costs ≥ purchase × (1 + margin%)`; tries the uncapped delivery formula first and falls back to the capped one when the result would exceed 20000₽. If you touch this file, understand *why* both formulas exist before "simplifying".
- **`src/server.mjs`** — one long Express file (~950 lines) with all routes. Concurrency is tracked by top-level booleans (`syncInProgress`, `supplierImportInProgress`, `salesImportInProgress`, `pricesSendInProgress`); jobs return 409 if already running and run async in the background after responding. Frontend pages under `public/` map 1:1 to route groups: `index.html`→`/api/offers`, `supplier.html`→`/api/supplier/*`, `markup.html`→`/api/markup-rules`, `price-sync.html`→`/api/price-proposals` + `/api/ym/update-prices`, `sales.html`→`/api/sales/*`, `cancellations.html`→`/api/cancellations/*`.
- **`src/supplier/import.mjs`** — streams a 100+ MB YML feed with `sax`, batches upserts (500 offers per tx, 200 categories). Handles both HTTP and `file://` URLs.

### Guardrails in the price-push flow

`POST /api/ym/update-prices` is the only endpoint that writes to YM. It **skips** any offer whose new price falls below the supplier's `purchase_price`, and skips (unless `confirmBigChanges: true` is in the body) any change larger than ±30%. Every attempt — sent, failed, or skipped — is logged to `price_updates`. Don't remove these checks without explicit direction.

### Categories: two independent trees

There are **two** category tables that are not linked:
- `offers.category_id` / `offers.category_name` — from YM's `marketCategoryId` (marketplace category).
- `supplier_categories` — from the YML feed's own tree.

Joins between supplier and YM data are always done by `offer_id` (the shop SKU), never by category. Markup rules are keyed on the YM category.

## Deployment

`docker-compose.yml` builds from the local `Dockerfile` (`node:22-alpine`, `npm ci --omit=dev`), mounts `./data` as a volume, and exposes port 3000 only on `127.0.0.1:8091` (assumes a reverse proxy in front). The `.github/workflows/deploy.yml` pipeline SSHes to the server on every push to `main` and runs `git pull && docker compose build && docker compose up -d`. There is no staging environment.
