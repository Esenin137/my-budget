import React, { useEffect, useMemo, useState } from 'react';
import { Pencil, RefreshCw, Trash2 } from 'lucide-react';
import {
  AssetKind,
  BrokerId,
  DepositItem,
  InvestmentsState,
  PortfolioAsset,
} from '../types';
import { formatMoney, parseNum, uid } from '../utils/finance';
import {
  analyzeInvestments,
  BROKER_OPTIONS,
  buildScannerRecommendations,
  fetchMoexQuotesSafe,
  getAssetAnnualIncome,
  getAssetTotalValue,
  MARKET_INSTRUMENTS,
  MarketInstrument,
  MONTH_SHORT_RU,
  ScannerPayoutFilter,
  ScannerStrategy,
} from '../utils/investments';
import GlassSection from './GlassSection';

interface InvestmentsTabProps {
  investments: InvestmentsState;
  budgetDeposits: DepositItem[];
  collapsedSecs: string[];
  onToggleSec: (id: string) => void;
  onUpdateInvestments: (next: InvestmentsState) => void;
  onShowToast: (msg: string) => void;
}

const KIND_LABELS: Record<AssetKind, string> = {
  coupon: 'Купоны',
  dividend: 'Дивиденды',
  deposit: 'Вклад / счёт',
};

export default function InvestmentsTab({
  investments,
  budgetDeposits,
  collapsedSecs,
  onToggleSec,
  onUpdateInvestments,
  onShowToast,
}: InvestmentsTabProps) {
  const [freeCashInp, setFreeCashInp] = useState(() =>
    investments.freeCash ? String(investments.freeCash) : ''
  );
  const [monthlyPlanInp, setMonthlyPlanInp] = useState(() =>
    investments.monthlyPlan ? String(investments.monthlyPlan) : ''
  );
  const [brokerCustomInp, setBrokerCustomInp] = useState(() => investments.brokerCustomName || '');

  // Quote sync state
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});
  const [syncingQuotes, setSyncingQuotes] = useState(false);
  const [quoteStatusNote, setQuoteStatusNote] = useState<string | null>(null);

  // Asset add/edit state
  const [assetFilter, setAssetFilter] = useState<'all' | AssetKind>('all');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formKind, setFormKind] = useState<AssetKind>('coupon');
  const [formTicker, setFormTicker] = useState('');
  const [formName, setFormName] = useState('');
  const [formQty, setFormQty] = useState('1');
  const [formPrice, setFormPrice] = useState('');
  const [formYield, setFormYield] = useState('15.5');
  const [formMonths, setFormMonths] = useState<number[]>([6, 12]);
  const [showAssetForm, setShowAssetForm] = useState(false);

  // Market scanner state
  const [strategy, setStrategy] = useState<ScannerStrategy>('monthly_salary');
  const [payoutFilter, setPayoutFilter] = useState<ScannerPayoutFilter>('all');
  const [scannerBudgetMode, setScannerBudgetMode] = useState<'free' | 'plan'>('free');

  useEffect(() => {
    setFreeCashInp(investments.freeCash ? String(investments.freeCash) : '');
    setMonthlyPlanInp(investments.monthlyPlan ? String(investments.monthlyPlan) : '');
    setBrokerCustomInp(investments.brokerCustomName || '');
  }, [investments.freeCash, investments.monthlyPlan, investments.brokerCustomName]);

  const summary = useMemo(
    () => analyzeInvestments(investments, budgetDeposits),
    [investments, budgetDeposits]
  );

  const scannerBudget =
    scannerBudgetMode === 'free' ? investments.freeCash : investments.monthlyPlan;

  const scannerReport = useMemo(
    () =>
      buildScannerRecommendations(
        strategy,
        payoutFilter,
        scannerBudget,
        summary.coveredMonths,
        livePrices
      ),
    [strategy, payoutFilter, scannerBudget, summary.coveredMonths, livePrices]
  );

  const allAssets = investments.assets || [];
  const filteredAssets = useMemo(() => {
    if (assetFilter === 'all') return allAssets;
    return allAssets.filter((a) => a.kind === assetFilter);
  }, [allAssets, assetFilter]);

  const handleSelectBroker = (broker: BrokerId) => {
    onUpdateInvestments({ ...investments, broker });
  };

  const handleSaveCashAndPlan = (e: React.FormEvent) => {
    e.preventDefault();
    const nextFree = Math.max(0, parseNum(freeCashInp));
    const nextPlan = Math.max(0, parseNum(monthlyPlanInp));
    onUpdateInvestments({
      ...investments,
      freeCash: nextFree,
      monthlyPlan: nextPlan,
      brokerCustomName: brokerCustomInp.trim(),
    });
    onShowToast('План пополнения и остаток сохранены.');
  };

  const handleSyncMoexQuotes = async () => {
    if (syncingQuotes) return;
    setSyncingQuotes(true);
    setQuoteStatusNote(null);
    try {
      const result = await fetchMoexQuotesSafe(
        allAssets.map((a) => ({ ticker: a.ticker, kind: a.kind }))
      );
      if (result.offlineFallback || result.updatedCount === 0) {
        setQuoteStatusNote('Мосбиржа недоступна — используются сохранённые офлайн-цены.');
        onShowToast('Офлайн-резерв: сохранены текущие цены активов.');
        return;
      }

      setLivePrices((prev) => ({ ...prev, ...result.prices }));

      let updatedAssetsCount = 0;
      const now = Date.now();
      const nextAssets = allAssets.map((asset) => {
        if (asset.kind === 'deposit' || !asset.ticker) return asset;
        const fresh = result.prices[asset.ticker.toUpperCase()];
        if (fresh && fresh > 0) {
          updatedAssetsCount += 1;
          return { ...asset, price: fresh, lastUpdatedAt: now };
        }
        return asset;
      });

      onUpdateInvestments({
        ...investments,
        assets: nextAssets,
        lastQuotesSyncAt: now,
      });

      setQuoteStatusNote(
        `Обновлено котировок Мосбиржи: ${result.updatedCount}${
          updatedAssetsCount > 0 ? ` · в портфеле: ${updatedAssetsCount}` : ''
        }`
      );
      onShowToast(`Котировки Мосбиржи обновлены (${result.updatedCount}).`);
    } catch {
      setQuoteStatusNote('Не удалось связаться с Мосбиржей — используются сохранённые цены.');
    } finally {
      setSyncingQuotes(false);
    }
  };

  const resetAssetForm = (kind: AssetKind = 'coupon') => {
    setEditingId(null);
    setFormKind(kind);
    setFormTicker('');
    setFormName('');
    setFormQty('1');
    setFormPrice('');
    setFormYield(kind === 'deposit' ? '16' : kind === 'coupon' ? '15.5' : '12');
    setFormMonths(kind === 'deposit' ? [] : kind === 'coupon' ? [6, 12] : [7]);
  };

  const handleApplyPreset = (ticker: string) => {
    const inst = MARKET_INSTRUMENTS.find((i) => i.ticker === ticker);
    if (!inst) return;
    const p = livePrices[inst.ticker.toUpperCase()] || inst.fallbackPrice;
    setFormKind(inst.kind);
    setFormTicker(inst.ticker);
    setFormName(inst.name);
    setFormQty(String(inst.lotSize));
    setFormPrice(String(p));
    setFormYield(String(inst.annualYieldPct));
    setFormMonths([...inst.payoutMonths]);
  };

  const handleStartEdit = (asset: PortfolioAsset) => {
    setEditingId(asset.id);
    setFormKind(asset.kind);
    setFormTicker(asset.ticker || '');
    setFormName(asset.name);
    setFormQty(asset.kind === 'deposit' ? '1' : String(asset.qty));
    setFormPrice(String(asset.price));
    setFormYield(String(asset.annualYieldPct || ''));
    setFormMonths(asset.kind === 'deposit' ? [] : [...(asset.payoutMonths || [])]);
    setShowAssetForm(true);
  };

  const toggleFormMonth = (m: number) => {
    setFormMonths((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m].sort((a, b) => a - b)
    );
  };

  const handleSaveAsset = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = formName.trim();
    const priceVal = parseNum(formPrice);
    const qtyVal = formKind === 'deposit' ? 1 : parseNum(formQty);
    const yieldVal = Math.max(0, parseNum(formYield));

    if (!cleanName) {
      onShowToast('Укажите название актива или вклада.');
      return;
    }
    if (!(priceVal > 0)) {
      onShowToast(
        formKind === 'deposit' ? 'Укажите сумму вклада больше нуля.' : 'Укажите цену больше нуля.'
      );
      return;
    }
    if (formKind !== 'deposit' && !(qtyVal > 0)) {
      onShowToast('Укажите количество больше нуля.');
      return;
    }

    const payload: PortfolioAsset = {
      id: editingId ?? uid(),
      kind: formKind,
      ticker: formKind === 'deposit' ? '' : formTicker.trim().toUpperCase(),
      name: cleanName,
      qty: qtyVal,
      price: priceVal,
      annualYieldPct: yieldVal,
      payoutMonths: formKind === 'deposit' ? [] : formMonths,
      moexBoard: formKind === 'coupon' ? 'TQOB' : formKind === 'dividend' ? 'TQBR' : undefined,
      lastUpdatedAt: Date.now(),
    };

    const nextAssets = editingId
      ? allAssets.map((a) => (a.id === editingId ? payload : a))
      : [payload, ...allAssets];

    onUpdateInvestments({ ...investments, assets: nextAssets });
    onShowToast(editingId ? 'Позиция обновлена.' : `Добавлено: ${cleanName}`);
    setShowAssetForm(false);
    resetAssetForm(formKind);
  };

  const handleDeleteAsset = (id: number) => {
    onUpdateInvestments({
      ...investments,
      assets: allAssets.filter((a) => a.id !== id),
    });
    onShowToast('Позиция удалена.');
  };

  const handleQuickAddFromScanner = (inst: MarketInstrument, units: number, unitPrice: number) => {
    const qtyToAdd = Math.max(inst.lotSize, units);
    const existing = allAssets.find(
      (a) => a.kind === inst.kind && a.ticker.toUpperCase() === inst.ticker.toUpperCase()
    );

    const nextAssets = existing
      ? allAssets.map((a) =>
          a.id === existing.id
            ? {
                ...a,
                qty: a.qty + qtyToAdd,
                price: unitPrice,
                lastUpdatedAt: Date.now(),
              }
            : a
        )
      : [
          {
            id: uid(),
            kind: inst.kind,
            ticker: inst.ticker,
            name: inst.name,
            qty: qtyToAdd,
            price: unitPrice,
            annualYieldPct: inst.annualYieldPct,
            payoutMonths: [...inst.payoutMonths],
            moexBoard: inst.moexBoard,
            lastUpdatedAt: Date.now(),
          },
          ...allAssets,
        ];

    const spent = Math.round(qtyToAdd * unitPrice);
    const nextFreeCash =
      investments.freeCash >= spent ? Math.round(investments.freeCash - spent) : investments.freeCash;

    onUpdateInvestments({
      ...investments,
      freeCash: nextFreeCash,
      assets: nextAssets,
    });
    onShowToast(`Добавлено: ${inst.name} × ${qtyToAdd} шт.`);
  };

  const totalDepositsCombined = summary.bankDepositsTotal + summary.budgetDepositsTotal;

  return (
    <>
      {/* ФИРМЕННЫЕ 3D-ПЛИТКИ СВОДКИ — В ЕДИНОМ СТИЛЕ С «БЮДЖЕТОМ» */}
      <div className="summary-strip">
        <div className="sum-card card-inv-main" role="region" aria-label="Общий капитал">
          <div>
            <div className="lbl">Весь капитал:</div>
            <div className="val tabular-nums">{formatMoney(summary.grandCapitalTotal)}</div>
          </div>
          <div className="safe-pill tabular-nums">
            {summary.monthlyPassiveIncome > 0
              ? `Пассивный доход: ~${formatMoney(summary.monthlyPassiveIncome)}/мес`
              : 'Добавьте активы или вклады ниже'}
          </div>
        </div>

        <div className="sum-card card-inv-sec" role="region" aria-label="Портфель и вклады">
          <div className="lbl">
            {summary.investedSecuritiesTotal > 0 ? 'Бумаги и вклады:' : 'Вклады и накопления:'}
          </div>
          <div className="val tabular-nums">
            {formatMoney(summary.investedSecuritiesTotal + totalDepositsCombined)}
          </div>
        </div>

        <div className="sum-card card-inv-iis" role="region" aria-label="Вычет ИИС 13%">
          <div className="lbl">
            {summary.iisDeduction13 > 0
              ? `Вычет ИИС 13% (план ${formatMoney(investments.monthlyPlan)}/м):`
              : 'Вычет ИИС (13%):'}
          </div>
          <div className="val tabular-nums">
            {summary.iisDeduction13 > 0 ? `+${formatMoney(summary.iisDeduction13)}` : formatMoney(0)}
          </div>
        </div>
      </div>

      {/* 1. БРОКЕР, ПЛАН ИИС И КОТИРОВКИ МОСБИРЖИ */}
      <GlassSection
        id="sec-inv-overview"
        title="🏛️ Брокер, план ИИС и Мосбиржа"
        helpText="Выберите своего брокера, задайте свободные деньги на счёте и ежемесячный план пополнения ИИС для расчёта вычета 13% НДФЛ и подбора бумаг."
        collapsed={collapsedSecs.includes('sec-inv-overview')}
        onToggleCollapse={onToggleSec}
      >
        <form onSubmit={handleSaveCashAndPlan} className="space-y-2.5">
          <label className="fin-sub block">
            Брокер / Платформа
            <select
              className="fin-select w-full mt-1"
              value={investments.broker}
              onChange={(e) => handleSelectBroker(e.target.value as BrokerId)}
            >
              {BROKER_OPTIONS.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>

          {investments.broker === 'other' && (
            <input
              type="text"
              className="fin-input w-full"
              value={brokerCustomInp}
              onChange={(e) => setBrokerCustomInp(e.target.value)}
              placeholder="Название вашего брокера"
            />
          )}

          <div className="grid grid-cols-2 gap-2">
            <label className="fin-sub block">
              Свободно на счёте, ₽
              <input
                type="text"
                inputMode="decimal"
                className="fin-input w-full mt-1 tabular-nums"
                value={freeCashInp}
                onChange={(e) => setFreeCashInp(e.target.value)}
                placeholder="0"
              />
            </label>
            <label className="fin-sub block">
              План ИИС / мес, ₽
              <input
                type="text"
                inputMode="decimal"
                className="fin-input w-full mt-1 tabular-nums"
                value={monthlyPlanInp}
                onChange={(e) => setMonthlyPlanInp(e.target.value)}
                placeholder="Например, 5000"
              />
            </label>
          </div>

          <div className="flex gap-1.5 flex-wrap">
            <button type="submit" className="fin-btn sm flex-1">
              Сохранить план
            </button>
            <button
              type="button"
              disabled={syncingQuotes}
              onClick={() => void handleSyncMoexQuotes()}
              className="fin-btn ghost sm flex-1"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncingQuotes ? 'animate-spin' : ''}`} />
              <span>{syncingQuotes ? 'Загрузка...' : 'Котировки MOEX'}</span>
            </button>
          </div>
        </form>

        <div className="pt-2 border-t border-[var(--line)] space-y-1 fin-sub tabular-nums">
          {investments.monthlyPlan > 0 ? (
            <div>
              Ваш расчёт вычета ИИС 13%: {formatMoney(investments.monthlyPlan)}/мес (
              {formatMoney(summary.annualIisContribution)}/год) →{' '}
              <b className="text-[var(--ink)]">+{formatMoney(summary.iisDeduction13)}</b> (лимит базы
              400 000 ₽/год → до 52 000 ₽)
            </div>
          ) : (
            <div>
              План пополнения ИИС пока не задан (вычет 0 ₽). <b>Пример:</b> при пополнении 5 000 ₽/мес
              (60 000 ₽/год) вычет 13% составит +7 800 ₽/год.
            </div>
          )}
          {summary.annualPassiveIncome > 0 && (
            <div>
              Прогноз выплат: ~<b className="text-emerald-400">{formatMoney(summary.monthlyPassiveIncome)}/мес</b> ·{' '}
              {formatMoney(summary.annualPassiveIncome)}/год
            </div>
          )}
          {(quoteStatusNote || investments.lastQuotesSyncAt) && (
            <div>
              {quoteStatusNote ||
                `MOEX обновлён: ${new Date(investments.lastQuotesSyncAt!).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
            </div>
          )}
        </div>
      </GlassSection>

      {/* 2. МОИ АКТИВЫ И ВКЛАДЫ (КУПОНЫ, ДИВИДЕНДЫ, БАНКОВСКИЙ ВКЛАД) */}
      <GlassSection
        id="sec-inv-assets"
        title="💼 Мои активы и вклады"
        helpText="Единый список вашего капитала: купонные облигации (ОФЗ), дивидендные акции и банковские вклады / накопительные счета. Вклады учитываются общей суммой без привязки к календарю купонов."
        rightExtra={
          allAssets.length > 0 ? <span className="fin-sub tabular-nums">({allAssets.length})</span> : null
        }
        collapsed={collapsedSecs.includes('sec-inv-assets')}
        onToggleCollapse={onToggleSec}
      >
        {/* Сегментированный фильтр (в стиле Бюджета) */}
        <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
          {(
            [
              ['all', 'Все'],
              ['coupon', 'Купоны'],
              ['dividend', 'Акции'],
              ['deposit', 'Вклады'],
            ] as ['all' | AssetKind, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAssetFilter(id)}
              className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer transition whitespace-nowrap ${
                assetFilter === id
                  ? 'bg-[var(--acc)] text-[var(--accInk)] shadow'
                  : 'text-[var(--mute)] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Список активов и вкладов */}
        <div className="space-y-2 max-h-72 overflow-y-auto pr-0.5">
          {filteredAssets.length === 0 ? (
            <div className="fin-sub py-1">
              Пока нет позиций в этой категории — добавьте актив или вклад ниже.
            </div>
          ) : (
            filteredAssets.map((asset) => {
              const total = getAssetTotalValue(asset);
              const annualInc = getAssetAnnualIncome(asset);

              if (asset.kind === 'deposit') {
                return (
                  <div key={asset.id} className="tx-tile dep">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-10 h-10 rounded-xl bg-black/15 flex items-center justify-center text-lg shrink-0">
                        🏛️
                      </span>
                      <div className="min-w-0">
                        <div className="font-extrabold text-sm truncate">
                          {asset.name}
                          {asset.annualYieldPct > 0 ? ` · ${asset.annualYieldPct}%` : ''}
                        </div>
                        <div className="text-xs opacity-80 font-semibold tabular-nums truncate">
                          {formatMoney(total)}
                          {annualInc > 0 ? ` · ~${formatMoney(Math.round(annualInc / 12))}/мес` : ' · Вклад / счёт'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(asset)}
                        className="p-2 text-[#1F1300] hover:opacity-70 cursor-pointer"
                        title="Изменить"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAsset(asset.id)}
                        className="p-2 text-[#1F1300] hover:opacity-70 cursor-pointer"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              }

              const monthsText =
                asset.payoutMonths?.length
                  ? asset.payoutMonths.map((m) => MONTH_SHORT_RU[m - 1]).join(', ')
                  : '';

              return (
                <div key={asset.id} className="tx-tile">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <b className="truncate text-[var(--ink)]">{asset.name}</b>
                      <b className="tabular-nums shrink-0 text-[var(--ink)]">{formatMoney(total)}</b>
                    </div>
                    <div className="fin-sub tabular-nums mt-0.5 truncate">
                      {[
                        KIND_LABELS[asset.kind],
                        asset.ticker || null,
                        `${asset.qty} шт × ${formatMoney(asset.price)}`,
                        asset.annualYieldPct > 0 ? `${asset.annualYieldPct}%` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {(monthsText || annualInc > 0) && (
                      <div className="fin-sub tabular-nums mt-0.5 truncate">
                        {[
                          annualInc > 0 ? `~${formatMoney(annualInc)}/год` : null,
                          monthsText ? `выплаты: ${monthsText}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(asset)}
                      className="p-2 text-slate-400 hover:text-amber-300 cursor-pointer"
                      title="Изменить"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteAsset(asset.id)}
                      className="p-2 text-slate-400 hover:text-rose-400 cursor-pointer"
                      title="Удалить"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Форма добавления / редактирования (чистая, без вложенных рамок) */}
        <div className="pt-2 border-t border-[var(--line)]">
          <button
            type="button"
            onClick={() => {
              if (showAssetForm) {
                setShowAssetForm(false);
                resetAssetForm(formKind);
              } else {
                resetAssetForm(assetFilter === 'all' ? 'coupon' : assetFilter);
                setShowAssetForm(true);
              }
            }}
            className="fin-btn ghost sm w-full"
          >
            {showAssetForm
              ? 'Скрыть форму'
              : editingId
              ? 'Редактировать позицию'
              : '+ Добавить актив или вклад'}
          </button>

          {showAssetForm && (
            <form onSubmit={handleSaveAsset} className="space-y-2.5 mt-3">
              {/* 3 типа позиций */}
              <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
                {(['coupon', 'dividend', 'deposit'] as AssetKind[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => {
                      setFormKind(k);
                      if (k === 'deposit') {
                        setFormTicker('');
                        setFormQty('1');
                        setFormMonths([]);
                        if (!formYield) setFormYield('16');
                      } else if (k === 'coupon' && !formMonths.length) {
                        setFormMonths([6, 12]);
                      } else if (k === 'dividend' && !formMonths.length) {
                        setFormMonths([7]);
                      }
                    }}
                    className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer transition whitespace-nowrap ${
                      formKind === k
                        ? 'bg-[var(--acc)] text-[var(--accInk)] shadow'
                        : 'text-[var(--mute)] hover:text-white'
                    }`}
                  >
                    {KIND_LABELS[k]}
                  </button>
                ))}
              </div>

              {/* Быстрая подстановка популярной бумаги MOEX */}
              {formKind !== 'deposit' && (
                <select
                  className="fin-select w-full"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) handleApplyPreset(e.target.value);
                  }}
                >
                  <option value="">Быстро выбрать бумагу Мосбиржи...</option>
                  {MARKET_INSTRUMENTS.filter((i) => i.kind === formKind).map((inst) => (
                    <option key={inst.ticker} value={inst.ticker}>
                      {inst.name} ({inst.ticker}) · ~{inst.annualYieldPct}%
                    </option>
                  ))}
                </select>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  className="fin-input w-full"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder={
                    formKind === 'coupon'
                      ? 'ОФЗ 26243'
                      : formKind === 'dividend'
                      ? 'Сбербанк'
                      : 'Накопительный счёт / Вклад'
                  }
                />
                {formKind !== 'deposit' && (
                  <input
                    type="text"
                    className="fin-input w-full"
                    value={formTicker}
                    onChange={(e) => setFormTicker(e.target.value.toUpperCase())}
                    placeholder={formKind === 'coupon' ? 'Тикер (SU26243RMFS4)' : 'Тикер (SBER)'}
                  />
                )}
              </div>

              <div className="grid grid-cols-3 gap-2">
                {formKind !== 'deposit' && (
                  <label className="fin-sub block">
                    Кол-во, шт
                    <input
                      type="text"
                      inputMode="decimal"
                      className="fin-input w-full mt-1 tabular-nums"
                      value={formQty}
                      onChange={(e) => setFormQty(e.target.value)}
                      placeholder="1"
                    />
                  </label>
                )}
                <label className={`fin-sub block ${formKind === 'deposit' ? 'col-span-2' : ''}`}>
                  {formKind === 'deposit' ? 'Сумма вклада, ₽' : 'Цена, ₽'}
                  <input
                    type="text"
                    inputMode="decimal"
                    className="fin-input w-full mt-1 tabular-nums"
                    value={formPrice}
                    onChange={(e) => setFormPrice(e.target.value)}
                    placeholder={formKind === 'deposit' ? '100000' : '745'}
                  />
                </label>
                <label className="fin-sub block">
                  %/год
                  <input
                    type="text"
                    inputMode="decimal"
                    className="fin-input w-full mt-1 tabular-nums"
                    value={formYield}
                    onChange={(e) => setFormYield(e.target.value)}
                    placeholder="15.5"
                  />
                </label>
              </div>

              {formKind !== 'deposit' ? (
                <div className="space-y-1">
                  <div className="fin-sub">Месяцы выплат:</div>
                  <div className="grid grid-cols-6 gap-1">
                    {MONTH_SHORT_RU.map((lbl, idx) => {
                      const m = idx + 1;
                      const active = formMonths.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleFormMonth(m)}
                          className={`py-1.5 rounded-lg text-[11px] font-bold border cursor-pointer transition ${
                            active
                              ? 'bg-[var(--acc)] text-[var(--accInk)] border-transparent'
                              : 'bg-[var(--fld)] border-[var(--line)] text-[var(--mute)] hover:text-white'
                          }`}
                        >
                          {lbl}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="fin-sub">
                  Вклад учитывается общей суммой в капитале без привязки к купонам и дивидендам.
                </div>
              )}

              <div className="flex gap-1.5">
                <button type="submit" className="fin-btn sm flex-1">
                  {editingId ? 'Сохранить изменения' : 'Сохранить позицию'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAssetForm(false);
                    resetAssetForm(formKind);
                  }}
                  className="fin-btn ghost sm"
                >
                  Отмена
                </button>
              </div>
            </form>
          )}
        </div>
      </GlassSection>

      {/* 3. СКАНЕР РЫНКА И КАЛЕНДАРЬ ВЫПЛАТ */}
      <GlassSection
        id="sec-inv-scanner"
        title="🔎 Сканер рынка и выплаты"
        helpText="Подбирает ОФЗ и дивидендные акции под свободный остаток или план ИИС. Учитывает погрешность до +1 000 ₽ и подсказывает, если небольшая доплата заметно увеличивает доход или закрывает пустой месяц."
        rightExtra={
          <span className="fin-sub tabular-nums">{summary.coveredMonths.size}/12 мес.</span>
        }
        collapsed={collapsedSecs.includes('sec-inv-scanner')}
        onToggleCollapse={onToggleSec}
      >
        {/* Переключатель стратегий */}
        <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
          <button
            type="button"
            onClick={() => setStrategy('monthly_salary')}
            className={`py-1.5 px-2 rounded-lg text-xs font-bold cursor-pointer transition whitespace-nowrap truncate ${
              strategy === 'monthly_salary'
                ? 'bg-[var(--acc)] text-[var(--accInk)] shadow'
                : 'text-[var(--mute)] hover:text-white'
            }`}
          >
            Ежемесячная зарплата
          </button>
          <button
            type="button"
            onClick={() => setStrategy('max_yield')}
            className={`py-1.5 px-2 rounded-lg text-xs font-bold cursor-pointer transition whitespace-nowrap truncate ${
              strategy === 'max_yield'
                ? 'bg-[var(--acc)] text-[var(--accInk)] shadow'
                : 'text-[var(--mute)] hover:text-white'
            }`}
          >
            Максимальный процент
          </button>
        </div>

        {/* Фильтр выплат и база расчёта */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="inline-flex gap-1 p-0.5 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
            {(
              [
                ['all', 'Все'],
                ['coupon', 'Купоны'],
                ['dividend', 'Дивиденды'],
              ] as [ScannerPayoutFilter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPayoutFilter(id)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition whitespace-nowrap ${
                  payoutFilter === id
                    ? 'bg-white/14 text-white'
                    : 'text-[var(--mute)] hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="inline-flex gap-1 p-0.5 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
            <button
              type="button"
              onClick={() => setScannerBudgetMode('free')}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition whitespace-nowrap tabular-nums ${
                scannerBudgetMode === 'free'
                  ? 'bg-white/14 text-white'
                  : 'text-[var(--mute)] hover:text-white'
              }`}
            >
              Остаток {formatMoney(investments.freeCash)}
            </button>
            <button
              type="button"
              onClick={() => setScannerBudgetMode('plan')}
              className={`px-2 py-1 rounded-lg text-[11px] font-bold cursor-pointer transition whitespace-nowrap tabular-nums ${
                scannerBudgetMode === 'plan'
                  ? 'bg-white/14 text-white'
                  : 'text-[var(--mute)] hover:text-white'
              }`}
            >
              План {formatMoney(investments.monthlyPlan)}
            </button>
          </div>
        </div>

        {/* 12-месячный календарь выплат */}
        <div className="grid grid-cols-6 gap-1">
          {MONTH_SHORT_RU.map((lbl, idx) => {
            const covered = summary.coveredMonths.has(idx + 1);
            return (
              <div
                key={lbl}
                className={`py-1 rounded-lg text-center text-[11px] font-bold border ${
                  covered
                    ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-200'
                    : 'bg-[var(--fld)] border-[var(--line)] text-[var(--mute)]'
                }`}
              >
                {lbl}
              </div>
            );
          })}
        </div>

        {/* Совет при доплате в пределах +1 000 ₽ (в фирменном стиле .tip-card.invest) */}
        {scannerReport.flexBoostTip && (
          <div className="tip-card invest space-y-2">
            <div className="flex items-center justify-between gap-2">
              <b className="text-[var(--ink)]">
                Выгодная доплата +{formatMoney(scannerReport.flexBoostTip.topUpRub)}
              </b>
              <span className="fin-sub tabular-nums">в пределах 1 000 ₽</span>
            </div>
            <div className="text-xs text-slate-200 leading-relaxed">
              {scannerReport.flexBoostTip.reason}
            </div>
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="fin-sub tabular-nums">
                {scannerReport.flexBoostTip.totalUnits} шт за{' '}
                {formatMoney(scannerReport.flexBoostTip.totalCost)} · ~
                {formatMoney(scannerReport.flexBoostTip.annualIncomeAfter)}/год
              </span>
              <button
                type="button"
                onClick={() =>
                  handleQuickAddFromScanner(
                    scannerReport.flexBoostTip!.instrument,
                    scannerReport.flexBoostTip!.totalUnits,
                    livePrices[scannerReport.flexBoostTip!.instrument.ticker.toUpperCase()] ||
                      scannerReport.flexBoostTip!.instrument.fallbackPrice
                  )
                }
                className="fin-btn sm"
              >
                + В портфель
              </button>
            </div>
          </div>
        )}

        {scannerBudget === 0 && (
          <div className="fin-sub">
            Свободные деньги и план пополнения не заданы (0 ₽) — ниже показаны справочные цены бумаг.
            Укажите сумму выше для расчёта покупок под ваш бюджет.
          </div>
        )}

        {/* Список рекомендаций */}
        <div className="space-y-2 max-h-96 overflow-y-auto pr-0.5">
          {scannerReport.candidates.slice(0, 8).map((c) => {
            const monthsLbl = c.instrument.payoutMonths.map((m) => MONTH_SHORT_RU[m - 1]).join(', ');
            const canBuyNow = c.affordableLots > 0;
            const canBuyWithFlex = !canBuyNow && c.flexTopUpNeeded > 0;

            return (
              <div
                key={c.instrument.ticker}
                className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-1.5"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <b className="text-sm text-[var(--ink)] leading-snug">{c.instrument.name}</b>
                  <span className="text-emerald-400 font-bold text-xs tabular-nums shrink-0">
                    {c.instrument.annualYieldPct}% год.
                  </span>
                </div>

                <div className="fin-sub tabular-nums leading-snug">
                  {KIND_LABELS[c.instrument.kind]} · {formatMoney(c.unitPrice)}
                  {c.instrument.lotSize > 1
                    ? ` (лот ${c.instrument.lotSize} шт = ${formatMoney(c.lotPrice)})`
                    : ''}
                  {monthsLbl ? ` · ${monthsLbl}` : ''}
                </div>

                <div className="flex items-center justify-between gap-2 pt-1 flex-wrap">
                  <div className="fin-sub tabular-nums leading-snug flex-1 min-w-[160px]">
                    {canBuyNow ? (
                      <>
                        Доступно {c.affordableUnits} шт ({formatMoney(c.affordableCost)}) · ~
                        {formatMoney(c.expectedAnnualIncome)}/год
                      </>
                    ) : canBuyWithFlex ? (
                      <span className="text-amber-300">
                        Доплата +{formatMoney(c.flexTopUpNeeded)} → 1 лот ({formatMoney(c.lotPrice)})
                      </span>
                    ) : (
                      <>Цена лота: {formatMoney(c.lotPrice)}</>
                    )}
                    {c.newMonthsCovered.length > 0 && strategy === 'monthly_salary'
                      ? ` · закроет ${c.newMonthsCovered.map((m) => MONTH_SHORT_RU[m - 1]).join(', ')}`
                      : ''}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      handleQuickAddFromScanner(
                        c.instrument,
                        canBuyNow ? c.affordableUnits : c.instrument.lotSize,
                        c.unitPrice
                      )
                    }
                    className={`fin-btn sm shrink-0 ${canBuyNow ? '' : 'ghost'}`}
                  >
                    {canBuyNow ? '+ Купить' : '+ В портфель'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </GlassSection>
    </>
  );
}
