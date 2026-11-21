import { AssetKind, BrokerId, DepositItem, InvestmentsState, PortfolioAsset } from '../types';

export interface BrokerOption {
  id: BrokerId;
  name: string;
  shortName: string;
}

export const BROKER_OPTIONS: BrokerOption[] = [
  { id: 'sber', name: 'Сбербанк / СберИнвестиции', shortName: 'СберИнвестиции' },
  { id: 'tbank', name: 'Т-Банк (Т-Инвестиции)', shortName: 'Т-Банк' },
  { id: 'vtb', name: 'ВТБ Мои Инвестиции', shortName: 'ВТБ' },
  { id: 'alfa', name: 'Альфа-Инвестиции', shortName: 'Альфа' },
  { id: 'bks', name: 'БКС Мир Инвестиций', shortName: 'БКС' },
  { id: 'other', name: 'Другой брокер', shortName: 'Другой' },
];

export const MONTH_SHORT_RU = [
  'Янв',
  'Фев',
  'Мар',
  'Апр',
  'Май',
  'Июн',
  'Июл',
  'Авг',
  'Сен',
  'Окт',
  'Ноя',
  'Дек',
];

export interface MarketInstrument {
  ticker: string;
  name: string;
  kind: 'coupon' | 'dividend';
  moexBoard: 'TQOB' | 'TQBR';
  lotSize: number;
  fallbackPrice: number; // unit price in RUB (offline reserve)
  annualYieldPct: number;
  payoutMonths: number[]; // 1..12
  note: string;
}

// Curated Russian market catalog (OFZ 12-month coupon ladder + top Russian dividend shares)
export const MARKET_INSTRUMENTS: MarketInstrument[] = [
  {
    ticker: 'SU26241RMFS8',
    name: 'ОФЗ 26241',
    kind: 'coupon',
    moexBoard: 'TQOB',
    lotSize: 1,
    fallbackPrice: 765,
    annualYieldPct: 15.7,
    payoutMonths: [1, 7],
    note: 'Гособлигация РФ · купон январь и июль',
  },
  {
    ticker: 'SU26240RMFS0',
    name: 'ОФЗ 26240',
    kind: 'coupon',
    moexBoard: 'TQOB',
    lotSize: 1,
    fallbackPrice: 615,
    annualYieldPct: 15.3,
    payoutMonths: [2, 8],
    note: 'Гособлигация РФ · купон февраль и август',
  },
  {
    ticker: 'SU26244RMFS2',
    name: 'ОФЗ 26244',
    kind: 'coupon',
    moexBoard: 'TQOB',
    lotSize: 1,
    fallbackPrice: 810,
    annualYieldPct: 15.8,
    payoutMonths: [3, 9],
    note: 'Гособлигация РФ · купон март и сентябрь',
  },
  {
    ticker: 'SU26242RMFS6',
    name: 'ОФЗ 26242',
    kind: 'coupon',
    moexBoard: 'TQOB',
    lotSize: 1,
    fallbackPrice: 790,
    annualYieldPct: 15.5,
    payoutMonths: [4, 10],
    note: 'Гособлигация РФ · купон апрель и октябрь',
  },
  {
    ticker: 'SU26238RMFS4',
    name: 'ОФЗ 26238',
    kind: 'coupon',
    moexBoard: 'TQOB',
    lotSize: 1,
    fallbackPrice: 565,
    annualYieldPct: 15.2,
    payoutMonths: [5, 11],
    note: 'Длинная ОФЗ · купон май и ноябрь',
  },
  {
    ticker: 'SU26243RMFS4',
    name: 'ОФЗ 26243',
    kind: 'coupon',
    moexBoard: 'TQOB',
    lotSize: 1,
    fallbackPrice: 745,
    annualYieldPct: 15.9,
    payoutMonths: [6, 12],
    note: 'Гособлигация РФ · купон июнь и декабрь',
  },
  {
    ticker: 'SBER',
    name: 'Сбербанк (SBER)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 10,
    fallbackPrice: 310,
    annualYieldPct: 12.1,
    payoutMonths: [7],
    note: 'Голубая фишка · лот 10 шт · дивиденды в июле',
  },
  {
    ticker: 'LKOH',
    name: 'Лукойл (LKOH)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 1,
    fallbackPrice: 6850,
    annualYieldPct: 14.8,
    payoutMonths: [6, 12],
    note: 'Нефтегаз · 2 выплаты в год (июнь, декабрь)',
  },
  {
    ticker: 'TATN',
    name: 'Татнефть (TATN)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 1,
    fallbackPrice: 645,
    annualYieldPct: 14.2,
    payoutMonths: [1, 7, 10],
    note: 'Нефтегаз · 3 выплаты в год (янв, июл, окт)',
  },
  {
    ticker: 'ROSN',
    name: 'Роснефть (ROSN)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 1,
    fallbackPrice: 515,
    annualYieldPct: 11.4,
    payoutMonths: [1, 7],
    note: 'Нефтегаз · 2 выплаты в год (январь, июль)',
  },
  {
    ticker: 'SNGSP',
    name: 'Сургутнефтегаз-п (SNGSP)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 10,
    fallbackPrice: 55,
    annualYieldPct: 15.4,
    payoutMonths: [7],
    note: 'Привилегированные · лот 10 шт · дивиденды в июле',
  },
  {
    ticker: 'MTSS',
    name: 'МТС (MTSS)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 10,
    fallbackPrice: 215,
    annualYieldPct: 16.3,
    payoutMonths: [7],
    note: 'Телеком · лот 10 шт · высокая дивидендная ставка',
  },
  {
    ticker: 'MOEX',
    name: 'Мосбиржа (MOEX)',
    kind: 'dividend',
    moexBoard: 'TQBR',
    lotSize: 10,
    fallbackPrice: 205,
    annualYieldPct: 11.8,
    payoutMonths: [5],
    note: 'Финансовый сектор · лот 10 шт · выплата в мае',
  },
];

export function getBrokerLabel(broker: BrokerId, customName?: string): string {
  if (broker === 'other' && customName?.trim()) return customName.trim();
  return BROKER_OPTIONS.find((b) => b.id === broker)?.name || 'Сбербанк / СберИнвестиции';
}

export function getAssetTotalValue(asset: PortfolioAsset): number {
  if (asset.kind === 'deposit') return Math.max(0, asset.price || 0);
  return Math.max(0, (asset.qty || 0) * (asset.price || 0));
}

export function getAssetAnnualIncome(asset: PortfolioAsset): number {
  const total = getAssetTotalValue(asset);
  const pct = Math.max(0, asset.annualYieldPct || 0);
  return Math.round((total * pct) / 100);
}

export interface PortfolioSummary {
  couponsTotal: number;
  dividendsTotal: number;
  bankDepositsTotal: number;
  budgetDepositsTotal: number;
  freeCash: number;
  investedSecuritiesTotal: number;
  grandCapitalTotal: number;
  annualPassiveIncome: number;
  monthlyPassiveIncome: number;
  annualIisContribution: number;
  iisDeductionBase: number;
  iisDeduction13: number;
  coveredMonths: Set<number>;
}

export function analyzeInvestments(
  inv: InvestmentsState,
  budgetDeposits: DepositItem[] = []
): PortfolioSummary {
  let couponsTotal = 0;
  let dividendsTotal = 0;
  let bankDepositsTotal = 0;
  let annualPassiveIncome = 0;
  const coveredMonths = new Set<number>();

  for (const asset of inv.assets || []) {
    const val = getAssetTotalValue(asset);
    const inc = getAssetAnnualIncome(asset);
    annualPassiveIncome += inc;

    if (asset.kind === 'coupon') {
      couponsTotal += val;
      (asset.payoutMonths || []).forEach((m) => {
        if (m >= 1 && m <= 12) coveredMonths.add(m);
      });
    } else if (asset.kind === 'dividend') {
      dividendsTotal += val;
      (asset.payoutMonths || []).forEach((m) => {
        if (m >= 1 && m <= 12) coveredMonths.add(m);
      });
    } else {
      bankDepositsTotal += val;
    }
  }

  let budgetDepositsTotal = 0;
  for (const dep of budgetDeposits) {
    const s = Math.max(0, dep.sum || 0);
    budgetDepositsTotal += s;
    annualPassiveIncome += Math.round((s * Math.max(0, dep.rate || 0)) / 100);
  }

  const freeCash = Math.max(0, inv.freeCash || 0);
  const investedSecuritiesTotal = couponsTotal + dividendsTotal;
  const grandCapitalTotal =
    investedSecuritiesTotal + bankDepositsTotal + budgetDepositsTotal + freeCash;

  const monthlyPlan = Math.max(0, inv.monthlyPlan || 0);
  const annualIisContribution = monthlyPlan * 12;
  const iisDeductionBase = Math.min(400_000, annualIisContribution);
  const iisDeduction13 = Math.round(iisDeductionBase * 0.13);

  return {
    couponsTotal,
    dividendsTotal,
    bankDepositsTotal,
    budgetDepositsTotal,
    freeCash,
    investedSecuritiesTotal,
    grandCapitalTotal,
    annualPassiveIncome,
    monthlyPassiveIncome: Math.round(annualPassiveIncome / 12),
    annualIisContribution,
    iisDeductionBase,
    iisDeduction13,
    coveredMonths,
  };
}

// =========================================================================
// SAFE MOEX ISS PUBLIC QUOTES UPDATER (ZERO USER DATA SENT OUTBOUND)
// =========================================================================

export interface MoexQuoteResult {
  prices: Record<string, number>;
  updatedCount: number;
  offlineFallback: boolean;
}

function parseMoexBoardPrices(
  json: Record<string, unknown>,
  isBond: boolean
): Record<string, number> {
  const out: Record<string, number> = {};
  const sec = json.securities as { columns?: string[]; data?: unknown[][] } | undefined;
  const md = json.marketdata as { columns?: string[]; data?: unknown[][] } | undefined;
  if (!sec?.columns || !Array.isArray(sec.data)) return out;

  const sIdIdx = sec.columns.indexOf('SECID');
  const prevIdx = sec.columns.indexOf('PREVPRICE');
  const faceIdx = sec.columns.indexOf('FACEVALUE');

  const mdPriceBySec = new Map<string, number>();
  if (md?.columns && Array.isArray(md.data)) {
    const mIdIdx = md.columns.indexOf('SECID');
    const lastIdx = md.columns.indexOf('LAST');
    const mpIdx = md.columns.indexOf('MARKETPRICE');
    for (const row of md.data) {
      const id = mIdIdx >= 0 ? String(row[mIdIdx] ?? '').toUpperCase() : '';
      if (!id) continue;
      const pRaw = (lastIdx >= 0 ? row[lastIdx] : null) ?? (mpIdx >= 0 ? row[mpIdx] : null);
      const pNum = typeof pRaw === 'number' ? pRaw : Number(pRaw);
      if (Number.isFinite(pNum) && pNum > 0) mdPriceBySec.set(id, pNum);
    }
  }

  for (const row of sec.data) {
    const id = sIdIdx >= 0 ? String(row[sIdIdx] ?? '').toUpperCase() : '';
    if (!id) continue;
    const prevRaw = prevIdx >= 0 ? row[prevIdx] : null;
    const prevNum = typeof prevRaw === 'number' ? prevRaw : Number(prevRaw);
    const rawPrice = mdPriceBySec.get(id) ?? (Number.isFinite(prevNum) && prevNum > 0 ? prevNum : 0);
    if (!(rawPrice > 0)) continue;

    if (isBond) {
      const faceRaw = faceIdx >= 0 ? row[faceIdx] : 1000;
      const faceVal = Number.isFinite(Number(faceRaw)) && Number(faceRaw) > 0 ? Number(faceRaw) : 1000;
      // MOEX bond prices are quoted as % of face value
      const rubPrice = rawPrice <= 200 ? (rawPrice / 100) * faceVal : rawPrice;
      out[id] = Math.round(rubPrice * 100) / 100;
    } else {
      out[id] = Math.round(rawPrice * 100) / 100;
    }
  }

  return out;
}

export async function fetchMoexQuotesSafe(extraTickers: { ticker: string; kind: AssetKind }[] = []): Promise<MoexQuoteResult> {
  const bondTickers = new Set<string>();
  const shareTickers = new Set<string>();

  MARKET_INSTRUMENTS.forEach((inst) => {
    if (inst.moexBoard === 'TQOB') bondTickers.add(inst.ticker.toUpperCase());
    else shareTickers.add(inst.ticker.toUpperCase());
  });

  extraTickers.forEach((item) => {
    const clean = item.ticker.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    if (!clean) return;
    if (item.kind === 'coupon') bondTickers.add(clean);
    else if (item.kind === 'dividend') shareTickers.add(clean);
  });

  const prices: Record<string, number> = {};
  let anySuccess = false;

  const fetchBoard = async (url: string, isBond: boolean) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const resp = await fetch(url, {
        method: 'GET',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!resp.ok) return;
      const data = (await resp.json()) as Record<string, unknown>;
      const parsed = parseMoexBoardPrices(data, isBond);
      Object.assign(prices, parsed);
      if (Object.keys(parsed).length > 0) anySuccess = true;
    } catch {
      // Offline reserve handled gracefully below
    } finally {
      window.clearTimeout(timer);
    }
  };

  const bondsQuery = Array.from(bondTickers).join(',');
  const sharesQuery = Array.from(shareTickers).join(',');

  await Promise.all([
    bondsQuery
      ? fetchBoard(
          `https://iss.moex.com/iss/engines/stock/markets/bonds/boards/TQOB/securities.json?iss.meta=off&iss.only=securities,marketdata&securities=${encodeURIComponent(bondsQuery)}`,
          true
        )
      : Promise.resolve(),
    sharesQuery
      ? fetchBoard(
          `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities=${encodeURIComponent(sharesQuery)}`,
          false
        )
      : Promise.resolve(),
  ]);

  return {
    prices,
    updatedCount: Object.keys(prices).length,
    offlineFallback: !anySuccess,
  };
}

// =========================================================================
// MARKET SCANNER (MONTHLY SALARY vs MAX YIELD + 1000 ₽ FLEXIBILITY BOOST)
// =========================================================================

export type ScannerStrategy = 'monthly_salary' | 'max_yield';
export type ScannerPayoutFilter = 'all' | 'coupon' | 'dividend';

export interface ScannerCandidate {
  instrument: MarketInstrument;
  unitPrice: number;
  lotPrice: number;
  affordableLots: number;
  affordableUnits: number;
  affordableCost: number;
  expectedAnnualIncome: number;
  newMonthsCovered: number[];
  flexTopUpNeeded: number; // 0 if fits without top-up; 1..1000 if top-up unlocks an extra lot
  flexExtraAnnualIncome: number;
  flexUnlockedLots: number;
  score: number;
}

export interface ScannerFlexBoostTip {
  instrument: MarketInstrument;
  topUpRub: number;
  totalCost: number;
  totalUnits: number;
  annualIncomeAfter: number;
  extraAnnualIncome: number;
  reason: string;
}

export interface ScannerReport {
  budgetUsed: number;
  candidates: ScannerCandidate[];
  flexBoostTip: ScannerFlexBoostTip | null;
}

const BUDGET_FLEX_RUB = 1000;

export function buildScannerRecommendations(
  strategy: ScannerStrategy,
  filter: ScannerPayoutFilter,
  availableBudget: number,
  coveredMonths: Set<number>,
  livePrices: Record<string, number>
): ScannerReport {
  const budget = Math.max(0, availableBudget || 0);
  const filtered = MARKET_INSTRUMENTS.filter((inst) =>
    filter === 'all' ? true : inst.kind === filter
  );

  const candidates: ScannerCandidate[] = filtered.map((inst) => {
    const unitPrice = livePrices[inst.ticker.toUpperCase()] || inst.fallbackPrice;
    const lotPrice = Math.round(unitPrice * inst.lotSize * 100) / 100;
    const affordableLots = lotPrice > 0 ? Math.floor(budget / lotPrice) : 0;
    const affordableUnits = affordableLots * inst.lotSize;
    const affordableCost = Math.round(affordableLots * lotPrice);
    const expectedAnnualIncome = Math.round((affordableCost * inst.annualYieldPct) / 100);

    const newMonthsCovered = inst.payoutMonths.filter((m) => !coveredMonths.has(m));

    // Check if adding up to +1 000 ₽ unlocks 1 more lot (or the first lot of a high-yield instrument)
    const maxFlexLots = lotPrice > 0 ? Math.floor((budget + BUDGET_FLEX_RUB) / lotPrice) : 0;
    let flexTopUpNeeded = 0;
    let flexExtraAnnualIncome = 0;
    let flexUnlockedLots = 0;

    if (maxFlexLots > affordableLots) {
      const targetLots = affordableLots + 1;
      const targetCost = Math.round(targetLots * lotPrice);
      const diff = targetCost - budget;
      if (diff > 0 && diff <= BUDGET_FLEX_RUB) {
        flexTopUpNeeded = Math.ceil(diff);
        flexUnlockedLots = targetLots;
        flexExtraAnnualIncome = Math.round(((targetCost - affordableCost) * inst.annualYieldPct) / 100);
      }
    }

    let score = inst.annualYieldPct;
    if (strategy === 'monthly_salary') {
      // Strongly prioritize instruments that cover missing payout months
      score = newMonthsCovered.length * 14 + inst.payoutMonths.length * 2 + inst.annualYieldPct * 0.6;
      if (affordableLots === 0 && flexTopUpNeeded === 0) score -= 20;
    } else {
      // Max yield strategy: rank by highest yield %, with slight preference for affordable lots
      score = inst.annualYieldPct * 2 + (affordableLots > 0 ? 4 : flexTopUpNeeded > 0 ? 2 : -10);
    }

    return {
      instrument: inst,
      unitPrice,
      lotPrice,
      affordableLots,
      affordableUnits,
      affordableCost,
      expectedAnnualIncome,
      newMonthsCovered,
      flexTopUpNeeded,
      flexExtraAnnualIncome,
      flexUnlockedLots,
      score,
    };
  });

  candidates.sort((a, b) => b.score - a.score);

  // Pick the most compelling ≤ 1 000 ₽ top-up recommendation if it creates a tangible gain
  let flexBoostTip: ScannerFlexBoostTip | null = null;
  if (budget > 0) {
    const flexEligible = candidates
      .filter((c) => c.flexTopUpNeeded > 0 && c.flexTopUpNeeded <= BUDGET_FLEX_RUB)
      .sort((a, b) => {
        const gainA =
          a.flexExtraAnnualIncome +
          (strategy === 'monthly_salary' ? a.newMonthsCovered.length * 250 : 0) +
          (a.affordableLots === 0 ? 400 : 0);
        const gainB =
          b.flexExtraAnnualIncome +
          (strategy === 'monthly_salary' ? b.newMonthsCovered.length * 250 : 0) +
          (b.affordableLots === 0 ? 400 : 0);
        return gainB - gainA;
      });

    const best = flexEligible[0];
    if (best && (best.flexExtraAnnualIncome >= 80 || best.newMonthsCovered.length > 0)) {
      const totalUnits = best.flexUnlockedLots * best.instrument.lotSize;
      const totalCost = Math.round(best.flexUnlockedLots * best.lotPrice);
      const annualIncomeAfter = Math.round((totalCost * best.instrument.annualYieldPct) / 100);
      const monthsStr = best.newMonthsCovered.map((m) => MONTH_SHORT_RU[m - 1]).join(', ');
      const reason =
        best.affordableLots === 0
          ? `Доплата +${best.flexTopUpNeeded} ₽ открывает покупку 1 лота «${best.instrument.name}» под ${best.instrument.annualYieldPct}% годовых${monthsStr ? ` и закрывает выплаты в: ${monthsStr}` : ''}.`
          : `Доплата всего +${best.flexTopUpNeeded} ₽ добавит ещё 1 лот «${best.instrument.name}» (${best.instrument.annualYieldPct}% годовых) и увеличит годовой доход на +${best.flexExtraAnnualIncome} ₽/год.`;

      flexBoostTip = {
        instrument: best.instrument,
        topUpRub: best.flexTopUpNeeded,
        totalCost,
        totalUnits,
        annualIncomeAfter,
        extraAnnualIncome: best.flexExtraAnnualIncome,
        reason,
      };
    }
  }

  return {
    budgetUsed: budget,
    candidates,
    flexBoostTip,
  };
}
