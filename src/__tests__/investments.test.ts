import { describe, expect, it } from 'vitest';
import type { InvestmentsState, PortfolioAsset } from '../types';
import {
  analyzeInvestments,
  buildScannerRecommendations,
  getAssetAnnualIncome,
  getAssetTotalValue,
} from '../utils/investments';

function makeInvestments(partial: Partial<InvestmentsState> = {}): InvestmentsState {
  return {
    broker: 'sber',
    brokerCustomName: '',
    freeCash: 0,
    monthlyPlan: 0,
    assets: [],
    lastQuotesSyncAt: null,
    ...partial,
  };
}

describe('Налоговый вычет 13% по ИИС и годовой лимит (analyzeInvestments)', () => {
  it('возвращает 0 ₽, если план пополнения ИИС не задан', () => {
    const summary = analyzeInvestments(makeInvestments({ monthlyPlan: 0 }));
    expect(summary.annualIisContribution).toBe(0);
    expect(summary.iisDeductionBase).toBe(0);
    expect(summary.iisDeduction13).toBe(0);
  });

  it('корректно считает 13% вычет при пополнении в пределах годового лимита', () => {
    // 5 000 ₽/мес * 12 = 60 000 ₽/год => 13% = 7 800 ₽
    const summary = analyzeInvestments(makeInvestments({ monthlyPlan: 5_000 }));
    expect(summary.annualIisContribution).toBe(60_000);
    expect(summary.iisDeductionBase).toBe(60_000);
    expect(summary.iisDeduction13).toBe(7_800);
  });

  it('ограничивает базу вычета годовым лимитом 400 000 ₽ (максимум 52 000 ₽ в год)', () => {
    // 50 000 ₽/мес * 12 = 600 000 ₽/год => база обрезается до 400 000 ₽ => 52 000 ₽
    const summary = analyzeInvestments(makeInvestments({ monthlyPlan: 50_000 }));
    expect(summary.annualIisContribution).toBe(600_000);
    expect(summary.iisDeductionBase).toBe(400_000);
    expect(summary.iisDeduction13).toBe(52_000);
  });
});

describe('Оценка портфеля: ОФЗ, акции, фонды ликвидности и банковские вклады', () => {
  it('раздельно оценивает ОФЗ, акции, фонды ликвидности и банковский вклад без купонов/дивидендов', () => {
    const assets: PortfolioAsset[] = [
      {
        id: 1,
        kind: 'coupon',
        ticker: 'SU26243RMFS4',
        name: 'ОФЗ 26243',
        qty: 20,
        price: 750, // 15 000 ₽
        annualYieldPct: 16, // 2 400 ₽/год
        payoutMonths: [6, 12],
      },
      {
        id: 2,
        kind: 'dividend',
        ticker: 'SBER',
        name: 'Сбербанк',
        qty: 100,
        price: 310, // 31 000 ₽
        annualYieldPct: 12, // 3 720 ₽/год
        payoutMonths: [7],
      },
      {
        id: 3,
        kind: 'coupon',
        ticker: 'LQDT',
        name: 'Фонд ликвидности ВИМ (LQDT)',
        qty: 10_000,
        price: 1.65, // 16 500 ₽
        annualYieldPct: 18, // 2 970 ₽/год
        payoutMonths: [], // Фонд ликвидности реинвестирует доход без привязки к месяцам купонов
      },
      {
        id: 4,
        kind: 'deposit',
        ticker: '',
        name: 'Накопительный счёт',
        qty: 99, // Для вклада qty игнорируется — учитывается общая сумма price
        price: 200_000, // 200 000 ₽
        annualYieldPct: 17, // 34 000 ₽/год
        payoutMonths: [1, 2, 3], // Даже если переданы месяцы, вклад не добавляется в календарь купонов/дивидендов
      },
    ];

    expect(getAssetTotalValue(assets[0])).toBe(15_000);
    expect(getAssetTotalValue(assets[1])).toBe(31_000);
    expect(getAssetTotalValue(assets[2])).toBe(16_500);
    expect(getAssetTotalValue(assets[3])).toBe(200_000);
    expect(getAssetAnnualIncome(assets[3])).toBe(34_000);

    const summary = analyzeInvestments(
      makeInvestments({
        freeCash: 10_000,
        assets,
      })
    );

    expect(summary.couponsTotal).toBe(31_500); // ОФЗ 15 000 + LQDT 16 500
    expect(summary.dividendsTotal).toBe(31_000);
    expect(summary.investedSecuritiesTotal).toBe(62_500);
    expect(summary.bankDepositsTotal).toBe(200_000);
    expect(summary.freeCash).toBe(10_000);
    expect(summary.grandCapitalTotal).toBe(272_500);

    // Ожидаемый пассивный доход: 2 400 + 3 720 + 2 970 + 34 000 = 43 090 ₽/год
    expect(summary.annualPassiveIncome).toBe(43_090);
    expect(summary.monthlyPassiveIncome).toBe(Math.round(43_090 / 12));

    // В календаре выплат только месяцы купонов и дивидендов (6, 7, 12), без вклада (1, 2, 3)
    expect(Array.from(summary.coveredMonths).sort((a, b) => a - b)).toEqual([6, 7, 12]);
  });
});

describe('Сканер рынка и проверка погрешности бюджета до 1 000 ₽ (buildScannerRecommendations)', () => {
  it('подсвечивает выгодную доплату в пределах 1 000 ₽, когда она открывает покупку лота', () => {
    // Лот SBER = 10 шт * 310 ₽ = 3 100 ₽; при бюджете 2 600 ₽ не хватает ровно 500 ₽ (<= 1 000 ₽)
    const report = buildScannerRecommendations(
      'max_yield',
      'dividend',
      2_600,
      new Set<number>(),
      {}
    );

    const sber = report.candidates.find((c) => c.instrument.ticker === 'SBER');
    expect(sber).toBeDefined();
    expect(sber!.affordableLots).toBe(0);
    expect(sber!.flexTopUpNeeded).toBe(500);
    expect(sber!.flexUnlockedLots).toBe(1);
    expect(sber!.flexExtraAnnualIncome).toBe(Math.round((3_100 * 12.1) / 100));

    // Лот LKOH = 6 850 ₽; при бюджете 2 600 ₽ не хватает 4 250 ₽ (> 1 000 ₽) => flexTopUpNeeded = 0
    const lkoh = report.candidates.find((c) => c.instrument.ticker === 'LKOH');
    expect(lkoh).toBeDefined();
    expect(lkoh!.affordableLots).toBe(0);
    expect(lkoh!.flexTopUpNeeded).toBe(0);

    // Должна быть сформирована рекомендация доплаты строго в пределах 1 000 ₽
    expect(report.flexBoostTip).not.toBeNull();
    expect(report.flexBoostTip!.topUpRub).toBeGreaterThan(0);
    expect(report.flexBoostTip!.topUpRub).toBeLessThanOrEqual(1_000);
  });

  it('не предлагает доплату, если бюджет = 0 ₽ или для нового лота требуется больше 1 000 ₽', () => {
    const zeroReport = buildScannerRecommendations('monthly_salary', 'all', 0, new Set(), {});
    expect(zeroReport.flexBoostTip).toBeNull();

    // Искусственно задаём живые цены так, чтобы все бумаги стоили дороже 5 000 ₽ за лот при бюджете 1 000 ₽
    const expensivePrices: Record<string, number> = {
      SU26241RMFS8: 5_000,
      SU26240RMFS0: 5_000,
      SU26244RMFS2: 5_000,
      SU26242RMFS6: 5_000,
      SU26238RMFS4: 5_000,
      SU26243RMFS4: 5_000,
    };
    const unreachableReport = buildScannerRecommendations(
      'max_yield',
      'coupon',
      1_000,
      new Set(),
      expensivePrices
    );
    expect(unreachableReport.candidates.every((c) => c.flexTopUpNeeded === 0)).toBe(true);
    expect(unreachableReport.flexBoostTip).toBeNull();
  });

  it('в стратегии «Ежемесячная зарплата» поднимает бумаги, закрывающие пустые месяцы выплат', () => {
    // Уже закрыты почти все месяцы, кроме января и июля (ОФЗ 26241 платит в 1 и 7)
    const covered = new Set<number>([2, 3, 4, 5, 6, 8, 9, 10, 11, 12]);
    const report = buildScannerRecommendations('monthly_salary', 'coupon', 5_000, covered, {});

    expect(report.candidates[0].instrument.ticker).toBe('SU26241RMFS8');
    expect(report.candidates[0].newMonthsCovered).toEqual([1, 7]);
  });
});
