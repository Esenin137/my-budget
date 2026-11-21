import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../types';
import { analyzeFinancialHealth, isFixedExpense, isTxInPeriod } from '../utils/finance';

function makeTx(partial: Partial<Transaction>): Transaction {
  return {
    id: Math.floor(Math.random() * 1_000_000),
    t: 'out',
    a: 0,
    c: 'Еда',
    m: 'Карта',
    d: '2026-04-10',
    n: '',
    ...partial,
  };
}

describe('Бюджет и безопасный дневной лимит (analyzeFinancialHealth)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('рассчитывает свободный остаток и безопасный дневной лимит до конца текущего месяца', () => {
    // Фиксируем текущую дату: 21 апреля 2026 (в апреле 30 дней => осталось 10 дней включительно: 21..30)
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 21, 12, 0, 0));

    const txs: Transaction[] = [
      makeTx({ t: 'in', a: 100_000, c: 'Зарплата', d: '2026-04-05' }),
      makeTx({ t: 'out', a: 30_000, c: 'Кредиты и Ипотека', n: 'Ипотека', d: '2026-04-06' }),
      makeTx({ t: 'out', a: 15_000, c: 'Дом', n: 'ЖКХ и интернет', d: '2026-04-07' }),
      makeTx({ t: 'out', a: 25_000, c: 'Еда', n: 'Продукты', d: '2026-04-12' }),
    ];

    const health = analyzeFinancialHealth(txs, new Date(2026, 3, 21));

    expect(health.sumIn).toBe(100_000);
    expect(health.sumOut).toBe(70_000);
    expect(health.left).toBe(30_000);
    expect(health.fixedSum).toBe(45_000);
    expect(health.flexSum).toBe(25_000);
    expect(health.topFlexCat).toBe('Еда');
    expect(health.remDays).toBe(10);
    expect(health.safeDaily).toBe(3_000);
  });

  it('возвращает safeDaily = 0 при дефиците или нулевом остатке и не уходит в отрицательные значения', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 15, 12, 0, 0));

    const txs: Transaction[] = [
      makeTx({ t: 'in', a: 40_000, c: 'Зарплата', d: '2026-04-01' }),
      makeTx({ t: 'out', a: 45_000, c: 'Дом', n: 'Аренда квартиры', d: '2026-04-02' }),
    ];

    const health = analyzeFinancialHealth(txs, new Date(2026, 3, 15));

    expect(health.left).toBe(-5_000);
    expect(health.safeDaily).toBe(0);
  });

  it('использует полное число дней месяца для прошлых периодов и ровно 1 день в последний день месяца', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 3, 30, 18, 0, 0)); // 30 апреля — последний день месяца

    const aprilTxs: Transaction[] = [
      makeTx({ t: 'in', a: 50_000, c: 'Зарплата', d: '2026-04-01' }),
      makeTx({ t: 'out', a: 42_000, c: 'Еда', d: '2026-04-10' }),
    ];

    const lastDayHealth = analyzeFinancialHealth(aprilTxs, new Date(2026, 3, 30));
    expect(lastDayHealth.remDays).toBe(1);
    expect(lastDayHealth.safeDaily).toBe(8_000);

    // Прошлый месяц (март 2026 — 31 день)
    const marchTxs: Transaction[] = [
      makeTx({ t: 'in', a: 62_000, c: 'Зарплата', d: '2026-03-01' }),
      makeTx({ t: 'out', a: 31_000, c: 'Еда', d: '2026-03-10' }),
    ];
    const pastMonthHealth = analyzeFinancialHealth(marchTxs, new Date(2026, 2, 15));
    expect(pastMonthHealth.remDays).toBe(31);
    expect(pastMonthHealth.safeDaily).toBe(1_000);
  });

  it('корректно классифицирует обязательные расходы и социальный налоговый вычет 13%', () => {
    const txs: Transaction[] = [
      makeTx({ t: 'in', a: 120_000, c: 'Зарплата' }),
      makeTx({ t: 'out', a: 10_000, c: 'Здоровье', n: 'Стоматолог и анализы' }),
      makeTx({ t: 'out', a: 20_000, c: 'Дети', n: 'Логопед и обучение' }),
      makeTx({ t: 'out', a: 35_000, c: 'Кредиты и Ипотека', n: 'Платёж по ипотеке' }),
      makeTx({ t: 'out', a: 2_000, c: 'Досуг', n: 'Подписка', repeat: 'monthly' }),
    ];

    expect(isFixedExpense(txs[4])).toBe(true);

    const health = analyzeFinancialHealth(txs, new Date(2026, 3, 10));
    expect(health.taxMed).toBe(10_000);
    expect(health.taxEdu).toBe(20_000);
    expect(health.taxMort).toBe(35_000);
    expect(health.socialRefund).toBe(Math.round((10_000 + 20_000) * 0.13)); // 3 900 ₽
  });

  it('фильтрует транзакции по периодам (день, неделя, месяц, год, произвольный диапазон)', () => {
    const ref = new Date(2026, 3, 15); // Среда, 15 апреля 2026 (неделя: 13.04..19.04)

    expect(isTxInPeriod('2026-04-15', 'day', ref)).toBe(true);
    expect(isTxInPeriod('2026-04-14', 'day', ref)).toBe(false);

    expect(isTxInPeriod('2026-04-13', 'week', ref)).toBe(true);
    expect(isTxInPeriod('2026-04-19', 'week', ref)).toBe(true);
    expect(isTxInPeriod('2026-04-20', 'week', ref)).toBe(false);

    expect(isTxInPeriod('2026-04-01', 'month', ref)).toBe(true);
    expect(isTxInPeriod('2026-05-01', 'month', ref)).toBe(false);

    expect(isTxInPeriod('2026-12-31', 'year', ref)).toBe(true);
    expect(isTxInPeriod('2025-12-31', 'year', ref)).toBe(false);

    // Произвольный диапазон работает даже если start > end
    expect(isTxInPeriod('2026-04-10', 'custom', ref, '2026-04-20', '2026-04-05')).toBe(true);
    expect(isTxInPeriod('2026-04-25', 'custom', ref, '2026-04-05', '2026-04-20')).toBe(false);
  });
});
