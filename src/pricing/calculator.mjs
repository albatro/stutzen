// Расчёт целевой цены на основе закупочной + правил наценки + комиссий ЯМ.
// Стоимости ЯМ для нашего кабинета (по факту из commissions.raw_json):
//   FEE          — relative, % зависит от категории, берём из БД (commissions.fee_percent)
//   PAYMENT_TRANSFER — relative, всегда 3.30%
//   DELIVERY_TO_CUSTOMER — relative 5% с потолком 1000₽ (срабатывает при цене > 20000₽)
//   AGENCY_COMMISSION — absolute 0.12₽
//   MIDDLE_MILE   — absolute, зависит от категории/габаритов, берём из commissions.middle_mile_amount

const PAYMENT_PCT = 3.30;
const DELIVERY_PCT = 5.00;
const DELIVERY_CAP = 1000;
const AGENCY_FIXED = 0.12;

/**
 * Считает целевую цену так, чтобы (цена - все комиссии ЯМ) = закупочная * (1 + margin/100).
 * Возвращает { price, payout, expected_margin, expected_margin_percent } или null если рассчитать нельзя.
 */
export function calcTargetPrice({ purchase_price, fee_percent, middle_mile_amount, margin_percent, min_margin_amount }) {
  if (!purchase_price || purchase_price <= 0) return null;
  if (fee_percent == null) return null;

  const fixed = (middle_mile_amount ?? 0) + AGENCY_FIXED;

  const requiredPayout = Math.max(
    purchase_price * (1 + (margin_percent ?? 0) / 100),
    purchase_price + (min_margin_amount ?? 0),
  );

  // Без потолка: price * (1 - (FEE + 3.3 + 5)/100) - fixed = payout
  const sumPctLow = fee_percent + PAYMENT_PCT + DELIVERY_PCT;
  const denomLow = 1 - sumPctLow / 100;
  if (denomLow > 0) {
    const priceLow = (requiredPayout + fixed) / denomLow;
    if (priceLow <= 20000) return packResult(priceLow, purchase_price, fee_percent, middle_mile_amount);
  }

  // С потолком доставки: price * (1 - (FEE + 3.3)/100) - fixed - 1000 = payout
  const sumPctHigh = fee_percent + PAYMENT_PCT;
  const denomHigh = 1 - sumPctHigh / 100;
  if (denomHigh <= 0) return null; // не существует решения
  const priceHigh = (requiredPayout + fixed + DELIVERY_CAP) / denomHigh;
  return packResult(priceHigh, purchase_price, fee_percent, middle_mile_amount);
}

function packResult(rawPrice, purchase, feePct, middleMile) {
  const price = Math.round(rawPrice); // округление до рубля (по требованию)
  const delivery = Math.min(price * DELIVERY_PCT / 100, DELIVERY_CAP);
  const fee = price * feePct / 100;
  const payment = price * PAYMENT_PCT / 100;
  const totalCosts = fee + payment + delivery + (middleMile ?? 0) + AGENCY_FIXED;
  const payout = price - totalCosts;
  const margin = payout - purchase;
  const marginPct = purchase > 0 ? margin / purchase * 100 : null;
  return {
    price,
    payout: round2(payout),
    expected_costs: round2(totalCosts),
    expected_margin: round2(margin),
    expected_margin_percent: marginPct == null ? null : round1(marginPct),
  };
}

const round2 = (x) => Math.round(x * 100) / 100;
const round1 = (x) => Math.round(x * 10) / 10;
