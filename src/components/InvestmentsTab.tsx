import React, { useEffect, useMemo, useState } from 'react';
import {
  Briefcase,
  Building2,
  Calendar,
  Coins,
  Landmark,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
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
  getBrokerLabel,
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

const ASSET_KIND_META: Record<
  AssetKind,
  { label: string; shortLabel: string; badgeClass: string; icon: React.ComponentType<{ className?: string }> }
> = {
  coupon: {
    label: 'Купоны (ОФЗ / облигации)',
    shortLabel: 'Купоны',
    badgeClass: 'bg-cyan-500/20 text-cyan-200 border-cyan-400/35',
    icon: Landmark,
  },
  dividend: {
    label: 'Дивиденды (акции)',
    shortLabel: 'Дивиденды',
    badgeClass: 'bg-amber-500/20 text-amber-200 border-amber-400/35',
    icon: TrendingUp,
  },
  deposit: {
    label: 'Банковский вклад / Накопительный счёт',
    shortLabel: 'Вклад / счёт',
    badgeClass: 'bg-emerald-500/20 text-emerald-200 border-emerald-400/35',
    icon: Coins,
  },
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
    investments.monthlyPlan ? String(investments.monthlyPlan) : '5000'
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
  const [formYield, setFormYield] = useState('');
  const [formMonths, setFormMonths] = useState<number[]>([6, 12]);
  const [showAssetForm, setShowAssetForm] = useState(false);

  // Market scanner state
  const [strategy, setStrategy] = useState<ScannerStrategy>('monthly_salary');
  const [payoutFilter, setPayoutFilter] = useState<ScannerPayoutFilter>('all');
  const [scannerBudgetMode, setScannerBudgetMode] = useState<'free' | 'plan'>('free');

  // Keep top inputs synced after async IndexedDB hydration or backup import
  useEffect(() => {
    setFreeCashInp(investments.freeCash ? String(investments.freeCash) : '');
    setMonthlyPlanInp(String(investments.monthlyPlan ?? 5000));
    setBrokerCustomInp(investments.brokerCustomName || '');
  }, [investments.freeCash, investments.monthlyPlan, investments.brokerCustomName]);

  const summary = useMemo(
    () => analyzeInvestments(investments, budgetDeposits),
    [investments, budgetDeposits]
  );

  const scannerBudget =
    scannerBudgetMode === 'free' && investments.freeCash > 0
      ? investments.freeCash
      : investments.monthlyPlan > 0
      ? investments.monthlyPlan
      : investments.freeCash;

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

  const filteredAssets = useMemo(() => {
    const list = investments.assets || [];
    if (assetFilter === 'all') return list;
    return list.filter((a) => a.kind === assetFilter);
  }, [investments.assets, assetFilter]);

  const handleSelectBroker = (broker: BrokerId) => {
    onUpdateInvestments({ ...investments, broker });
  };

  const handleSaveCashAndPlan = () => {
    const nextFree = Math.max(0, parseNum(freeCashInp));
    const nextPlan = Math.max(0, parseNum(monthlyPlanInp));
    onUpdateInvestments({
      ...investments,
      freeCash: nextFree,
      monthlyPlan: nextPlan,
      brokerCustomName: brokerCustomInp.trim(),
    });
    onShowToast('Параметры счёта и план пополнения сохранены.');
  };

  const handleSyncMoexQuotes = async () => {
    if (syncingQuotes) return;
    setSyncingQuotes(true);
    setQuoteStatusNote(null);
    try {
      const result = await fetchMoexQuotesSafe(
        (investments.assets || []).map((a) => ({ ticker: a.ticker, kind: a.kind }))
      );
      if (result.offlineFallback || result.updatedCount === 0) {
        setQuoteStatusNote('Мосбиржа сейчас недоступна — используются сохранённые офлайн-цены.');
        onShowToast('Офлайн-резерв: сохранены текущие цены активов.');
        return;
      }

      setLivePrices((prev) => ({ ...prev, ...result.prices }));

      let updatedAssetsCount = 0;
      const now = Date.now();
      const nextAssets = (investments.assets || []).map((asset) => {
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
        `Обновлено котировок MOEX: ${result.updatedCount}${
          updatedAssetsCount > 0 ? ` (в портфеле обновлено: ${updatedAssetsCount})` : ''
        }.`
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

  const handleApplyPreset = (inst: MarketInstrument) => {
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
      onShowToast(formKind === 'deposit' ? 'Укажите сумму вклада больше нуля.' : 'Укажите цену больше нуля.');
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
      ? (investments.assets || []).map((a) => (a.id === editingId ? payload : a))
      : [payload, ...(investments.assets || [])];

    onUpdateInvestments({ ...investments, assets: nextAssets });
    onShowToast(editingId ? 'Позиция обновлена.' : `Добавлено в «Мои активы»: ${cleanName}`);
    setShowAssetForm(false);
    resetAssetForm(formKind);
  };

  const handleDeleteAsset = (id: number) => {
    onUpdateInvestments({
      ...investments,
      assets: (investments.assets || []).filter((a) => a.id !== id),
    });
    onShowToast('Позиция удалена из портфеля.');
  };

  const handleQuickAddFromScanner = (inst: MarketInstrument, units: number, unitPrice: number) => {
    const qtyToAdd = Math.max(inst.lotSize, units);
    const existing = (investments.assets || []).find(
      (a) => a.kind === inst.kind && a.ticker.toUpperCase() === inst.ticker.toUpperCase()
    );

    const nextAssets = existing
      ? (investments.assets || []).map((a) =>
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
          ...(investments.assets || []),
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

  return (
    <>
      {/* 1. БРОКЕР, КАПИТАЛ, ПЛАН ИИС И МОСБИРЖА */}
      <GlassSection
        id="sec-inv-overview"
        title="💼 Платформа, капитал и ИИС (13%)"
        helpText="Выберите своего брокера, задайте свободный остаток и план ежемесячного пополнения ИИС — приложение автоматически посчитает вычет 13% НДФЛ и обновит котировки с Мосбиржи (iss.moex.com)."
        collapsed={collapsedSecs.includes('sec-inv-overview')}
        onToggleCollapse={onToggleSec}
      >
        {/* Итоговая сводка капитала */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <div className="rounded-2xl bg-[var(--fld)] border border-amber-400/30 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-amber-200/80">
              Весь капитал
            </div>
            <div className="text-base font-extrabold text-white font-num mt-0.5">
              {formatMoney(summary.grandCapitalTotal)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              Активы + вклады + кэш
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--fld)] border border-cyan-400/25 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-200/80">
              Купоны + Акции
            </div>
            <div className="text-base font-extrabold text-white font-num mt-0.5">
              {formatMoney(summary.investedSecuritiesTotal)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              ОФЗ: {formatMoney(summary.couponsTotal)}
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--fld)] border border-emerald-400/25 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-200/80">
              Пассивный доход
            </div>
            <div className="text-base font-extrabold text-emerald-300 font-num mt-0.5">
              ~{formatMoney(summary.monthlyPassiveIncome)}/м
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              {formatMoney(summary.annualPassiveIncome)}/год
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--fld)] border border-violet-400/30 p-2.5">
            <div className="text-[10px] font-bold uppercase tracking-wider text-violet-200/80">
              Вычет ИИС 13%
            </div>
            <div className="text-base font-extrabold text-violet-200 font-num mt-0.5">
              +{formatMoney(summary.iisDeduction13)}
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5">
              При {formatMoney(summary.annualIisContribution)}/год
            </div>
          </div>
        </div>

        {/* Выбор брокера */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
            <Building2 className="w-3.5 h-3.5 text-amber-300" />
            <span>Брокер / Платформа: {getBrokerLabel(investments.broker, investments.brokerCustomName)}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BROKER_OPTIONS.map((b) => {
              const active = investments.broker === b.id;
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => handleSelectBroker(b.id)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    active
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-100'
                      : 'bg-[var(--fld)] border-[var(--line)] text-slate-300 hover:border-white/25'
                  }`}
                >
                  {b.shortName}
                </button>
              );
            })}
          </div>
          {investments.broker === 'other' && (
            <input
              type="text"
              value={brokerCustomInp}
              onChange={(e) => setBrokerCustomInp(e.target.value)}
              placeholder="Название вашего брокера"
              className="fin-input w-full text-xs"
            />
          )}
        </div>

        {/* Свободные деньги и план пополнения */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">
              Свободные деньги на счёте (₽)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={freeCashInp}
              onChange={(e) => setFreeCashInp(e.target.value)}
              placeholder="0"
              className="fin-input w-full"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-slate-300 block mb-1">
              План пополнения ИИС в месяц (₽)
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={monthlyPlanInp}
              onChange={(e) => setMonthlyPlanInp(e.target.value)}
              placeholder="5000"
              className="fin-input w-full"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSaveCashAndPlan}
            className="fin-btn sm flex-1"
          >
            Сохранить план и остаток
          </button>
          <button
            type="button"
            disabled={syncingQuotes}
            onClick={() => void handleSyncMoexQuotes()}
            className="fin-btn ghost sm flex-1 flex items-center justify-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncingQuotes ? 'animate-spin' : ''}`} />
            <span>{syncingQuotes ? 'Загрузка MOEX...' : 'Обновить котировки с Мосбиржи'}</span>
          </button>
        </div>

        {/* Расчёт вычета ИИС + статус котировок */}
        <div className="rounded-xl bg-black/25 border border-white/10 px-3 py-2 text-[11px] text-slate-300 space-y-1">
          <div>
            🏛️ <b>Налоговый вычет ИИС:</b> пополнение{' '}
            <b className="text-white">{formatMoney(investments.monthlyPlan)}/мес</b> ={' '}
            <b className="text-white">{formatMoney(summary.annualIisContribution)}/год</b> → возврат
            13% НДФЛ <b className="text-emerald-300">+{formatMoney(summary.iisDeduction13)}</b>{' '}
            (лимит базы 400 000 ₽/год → до 52 000 ₽).
          </div>
          {summary.budgetDepositsTotal > 0 && (
            <div className="text-slate-400">
              💡 В общем капитале также учтены вклады из раздела «Бюджет»: {formatMoney(summary.budgetDepositsTotal)}.
            </div>
          )}
          {(quoteStatusNote || investments.lastQuotesSyncAt) && (
            <div className="text-cyan-200/90">
              {quoteStatusNote ||
                `Последнее обновление MOEX: ${new Date(investments.lastQuotesSyncAt!).toLocaleString('ru-RU', {
                  day: '2-digit',
                  month: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                })}`}
            </div>
          )}
        </div>
      </GlassSection>

      {/* 2. МОИ АКТИВЫ (3 ТИПА: КУПОНЫ, ДИВИДЕНДЫ, БАНКОВСКИЙ ВКЛАД) */}
      <GlassSection
        id="sec-inv-assets"
        title={`📊 Мои активы (${(investments.assets || []).length})`}
        helpText="Учитывайте 3 типа позиций: купонные облигации (ОФЗ), дивидендные акции и банковские вклады / накопительные счета (вклады не привязываются к купонам/дивидендам и идут общей суммой в капитал)."
        collapsed={collapsedSecs.includes('sec-inv-assets')}
        onToggleCollapse={onToggleSec}
        rightExtra={
          <button
            type="button"
            onClick={() => {
              resetAssetForm(assetFilter === 'all' ? 'coupon' : assetFilter);
              setShowAssetForm((v) => !v);
            }}
            className="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/40 text-[11px] font-bold text-amber-200 hover:bg-amber-500/30 cursor-pointer flex items-center gap-1"
          >
            {showAssetForm ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
            <span>{showAssetForm ? 'Скрыть' : 'Добавить'}</span>
          </button>
        }
      >
        {/* Форма добавления / редактирования позиции */}
        {showAssetForm && (
          <form
            onSubmit={handleSaveAsset}
            className="rounded-2xl bg-[var(--fld)] border border-amber-400/35 p-3 space-y-2.5"
          >
            <div className="text-xs font-extrabold text-white">
              {editingId ? '✏️ Редактировать позицию' : '➕ Новая позиция в портфеле'}
            </div>

            {/* Выбор одного из 3 типов */}
            <div className="grid grid-cols-3 gap-1.5">
              {(['coupon', 'dividend', 'deposit'] as AssetKind[]).map((k) => {
                const active = formKind === k;
                const Icon = ASSET_KIND_META[k].icon;
                return (
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
                    className={`py-2 px-1.5 rounded-xl border text-[11px] font-bold flex flex-col items-center gap-1 cursor-pointer transition ${
                      active
                        ? 'bg-amber-500/20 border-amber-400/60 text-white'
                        : 'bg-black/20 border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-center leading-tight">{ASSET_KIND_META[k].shortLabel}</span>
                  </button>
                );
              })}
            </div>

            {/* Быстрый выбор популярных бумаг MOEX */}
            {formKind !== 'deposit' && (
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-semibold">
                  Быстрый выбор с Мосбиржи:
                </div>
                <div className="flex flex-wrap gap-1">
                  {MARKET_INSTRUMENTS.filter((i) => i.kind === formKind)
                    .slice(0, 6)
                    .map((inst) => (
                      <button
                        key={inst.ticker}
                        type="button"
                        onClick={() => handleApplyPreset(inst)}
                        className="px-2 py-1 rounded-lg bg-white/6 hover:bg-white/14 border border-white/12 text-[11px] font-semibold text-slate-200 cursor-pointer transition"
                      >
                        {inst.name}
                      </button>
                    ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder={
                  formKind === 'coupon'
                    ? 'Название (напр. ОФЗ 26243)'
                    : formKind === 'dividend'
                    ? 'Название (напр. Сбербанк)'
                    : 'Название вклада / счёта (напр. Накопительный Сбер)'
                }
                className="fin-input w-full text-xs"
              />
              {formKind !== 'deposit' && (
                <input
                  type="text"
                  value={formTicker}
                  onChange={(e) => setFormTicker(e.target.value.toUpperCase())}
                  placeholder={formKind === 'coupon' ? 'Тикер MOEX (SU26243RMFS4)' : 'Тикер MOEX (SBER)'}
                  className="fin-input w-full text-xs"
                />
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {formKind !== 'deposit' && (
                <div>
                  <label className="text-[10px] text-slate-400 block mb-0.5">Кол-во (шт)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formQty}
                    onChange={(e) => setFormQty(e.target.value)}
                    placeholder="1"
                    className="fin-input w-full text-xs"
                  />
                </div>
              )}
              <div className={formKind === 'deposit' ? 'col-span-2' : ''}>
                <label className="text-[10px] text-slate-400 block mb-0.5">
                  {formKind === 'deposit' ? 'Сумма вклада (₽)' : 'Цена за 1 шт (₽)'}
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formPrice}
                  onChange={(e) => setFormPrice(e.target.value)}
                  placeholder={formKind === 'deposit' ? '100000' : '745'}
                  className="fin-input w-full text-xs"
                />
              </div>
              <div>
                <label className="text-[10px] text-slate-400 block mb-0.5">Ставка %/год</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={formYield}
                  onChange={(e) => setFormYield(e.target.value)}
                  placeholder="15.5"
                  className="fin-input w-full text-xs"
                />
              </div>
            </div>

            {/* Месяцы выплат (только для купонов и дивидендов; вклад не привязывается) */}
            {formKind !== 'deposit' ? (
              <div className="space-y-1">
                <div className="text-[10px] text-slate-400 font-semibold">
                  Месяцы выплат (для календаря «Ежемесячной зарплаты»):
                </div>
                <div className="grid grid-cols-6 gap-1">
                  {MONTH_SHORT_RU.map((lbl, idx) => {
                    const m = idx + 1;
                    const active = formMonths.includes(m);
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => toggleFormMonth(m)}
                        className={`py-1 rounded-lg text-[10px] font-bold border cursor-pointer transition ${
                          active
                            ? 'bg-emerald-500/25 border-emerald-400/60 text-emerald-100'
                            : 'bg-black/25 border-white/10 text-slate-400 hover:text-white'
                        }`}
                      >
                        {lbl}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-emerald-200/80 bg-emerald-500/10 border border-emerald-400/25 rounded-xl px-2.5 py-1.5">
                Банковский вклад / накопительный счёт не привязывается к купонам и дивидендам — учитывается общей суммой в капитале.
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button type="submit" className="fin-btn sm flex-1">
                {editingId ? 'Сохранить изменения' : 'Добавить актив'}
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

        {/* Фильтр типов активов */}
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['all', `Все (${(investments.assets || []).length})`],
              ['coupon', `Купоны (${(investments.assets || []).filter((a) => a.kind === 'coupon').length})`],
              ['dividend', `Дивиденды (${(investments.assets || []).filter((a) => a.kind === 'dividend').length})`],
              ['deposit', `Вклады (${(investments.assets || []).filter((a) => a.kind === 'deposit').length})`],
            ] as ['all' | AssetKind, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setAssetFilter(id)}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border cursor-pointer transition ${
                assetFilter === id
                  ? 'bg-white/15 border-white/30 text-white'
                  : 'bg-[var(--fld)] border-[var(--line)] text-slate-300 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Список активов пользователя */}
        {filteredAssets.length === 0 ? (
          <div className="rounded-2xl bg-[var(--fld)] border border-dashed border-white/15 p-4 text-center space-y-2">
            <Briefcase className="w-6 h-6 text-slate-400 mx-auto" />
            <div className="text-xs font-bold text-slate-200">
              В этой категории пока нет активов
            </div>
            <div className="fin-sub">
              Нажмите «Добавить» выше или выберите бумаги в «Сканере рынка» ниже — можно добавить ОФЗ, акции или банковский вклад.
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {filteredAssets.map((asset) => {
              const total = getAssetTotalValue(asset);
              const annualInc = getAssetAnnualIncome(asset);
              const meta = ASSET_KIND_META[asset.kind];
              const monthsText =
                asset.kind !== 'deposit' && asset.payoutMonths?.length
                  ? asset.payoutMonths.map((m) => MONTH_SHORT_RU[m - 1]).join(', ')
                  : '';

              return (
                <div
                  key={asset.id}
                  className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 flex items-start justify-between gap-2"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-extrabold text-white">{asset.name}</span>
                      {asset.ticker && (
                        <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-white/10 text-slate-200">
                          {asset.ticker}
                        </span>
                      )}
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${meta.badgeClass}`}>
                        {meta.shortLabel}
                      </span>
                    </div>

                    <div className="text-[11px] text-slate-300 flex flex-wrap gap-x-3 gap-y-0.5">
                      {asset.kind === 'deposit' ? (
                        <span>Общая сумма в капитале</span>
                      ) : (
                        <span>
                          {asset.qty} шт × {formatMoney(asset.price)}
                        </span>
                      )}
                      {asset.annualYieldPct > 0 && (
                        <span className="text-emerald-300 font-semibold">
                          {asset.annualYieldPct}% год. (~{formatMoney(annualInc)}/год)
                        </span>
                      )}
                    </div>

                    {monthsText && (
                      <div className="text-[10px] text-slate-400">
                        Выплаты: {monthsText}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="text-sm font-extrabold text-white font-num">
                      {formatMoney(total)}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => handleStartEdit(asset)}
                        className="p-1.5 rounded-lg bg-white/6 hover:bg-white/14 text-slate-200 cursor-pointer"
                        title="Редактировать"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteAsset(asset.id)}
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 cursor-pointer"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassSection>

      {/* 3. СКАНЕР РЫНКА (СТРАТЕГИИ, ФИЛЬТР ВЫПЛАТ И ДОПЛАТА ДО 1 000 ₽) */}
      <GlassSection
        id="sec-inv-scanner"
        title="🔎 Сканер рынка и подбор покупок"
        helpText="Подбирает ОФЗ и дивидендные акции под ваш свободный остаток или план пополнения. При погрешности бюджета до 1 000 ₽ подсказывает, если небольшая доплата заметно увеличивает доходность или закрывает пустой месяц выплат."
        collapsed={collapsedSecs.includes('sec-inv-scanner')}
        onToggleCollapse={onToggleSec}
      >
        {/* Переключатель стратегий */}
        <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[var(--fld)] border border-[var(--line)]">
          <button
            type="button"
            onClick={() => setStrategy('monthly_salary')}
            className={`py-2 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition ${
              strategy === 'monthly_salary'
                ? 'bg-amber-500/25 text-amber-100 border border-amber-400/50'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            <span>Ежемесячная зарплата</span>
          </button>
          <button
            type="button"
            onClick={() => setStrategy('max_yield')}
            className={`py-2 px-2.5 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition ${
              strategy === 'max_yield'
                ? 'bg-emerald-500/25 text-emerald-100 border border-emerald-400/50'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5 shrink-0" />
            <span>Максимальный процент</span>
          </button>
        </div>

        {/* Фильтр выплат + выбор базы бюджета */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1">
            {(
              [
                ['all', 'Все'],
                ['coupon', 'Только купоны'],
                ['dividend', 'Только дивиденды'],
              ] as [ScannerPayoutFilter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPayoutFilter(id)}
                className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border cursor-pointer transition ${
                  payoutFilter === id
                    ? 'bg-cyan-500/20 border-cyan-400/50 text-cyan-100'
                    : 'bg-[var(--fld)] border-[var(--line)] text-slate-300 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 text-[11px]">
            <button
              type="button"
              onClick={() => setScannerBudgetMode('free')}
              className={`px-2 py-1 rounded-lg border cursor-pointer ${
                scannerBudgetMode === 'free'
                  ? 'bg-white/15 border-white/30 text-white font-bold'
                  : 'bg-transparent border-white/10 text-slate-400'
              }`}
            >
              Остаток ({formatMoney(investments.freeCash)})
            </button>
            <button
              type="button"
              onClick={() => setScannerBudgetMode('plan')}
              className={`px-2 py-1 rounded-lg border cursor-pointer ${
                scannerBudgetMode === 'plan'
                  ? 'bg-white/15 border-white/30 text-white font-bold'
                  : 'bg-transparent border-white/10 text-slate-400'
              }`}
            >
              План ({formatMoney(investments.monthlyPlan)})
            </button>
          </div>
        </div>

        {/* Календарь покрытия выплат по 12 месяцам */}
        <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-bold text-slate-200">
              Календарь купонов и дивидендов (покрыто {summary.coveredMonths.size} из 12 мес.)
            </span>
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-12 gap-1">
            {MONTH_SHORT_RU.map((lbl, idx) => {
              const covered = summary.coveredMonths.has(idx + 1);
              return (
                <div
                  key={lbl}
                  className={`py-1 rounded-lg text-center text-[10px] font-bold border ${
                    covered
                      ? 'bg-emerald-500/25 border-emerald-400/50 text-emerald-200'
                      : 'bg-black/25 border-white/8 text-slate-500'
                  }`}
                >
                  {lbl}
                </div>
              );
            })}
          </div>
        </div>

        {/* Подсветка рекомендации при погрешности бюджета до +1 000 ₽ */}
        {scannerReport.flexBoostTip && (
          <div className="rounded-2xl bg-gradient-to-br from-amber-500/18 to-emerald-500/12 border border-amber-400/50 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-200">
                <Sparkles className="w-4 h-4 text-amber-300 shrink-0" />
                <span>Выгодная доплата в пределах +1 000 ₽</span>
              </div>
              <span className="text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-amber-400/25 text-amber-100 font-num">
                +{formatMoney(scannerReport.flexBoostTip.topUpRub)}
              </span>
            </div>
            <p className="text-xs text-slate-100 leading-relaxed">
              {scannerReport.flexBoostTip.reason}
            </p>
            <div className="flex items-center justify-between gap-2 text-[11px] text-amber-100/90 flex-wrap">
              <span>
                Итого к покупке: <b>{scannerReport.flexBoostTip.totalUnits} шт</b> за{' '}
                <b>{formatMoney(scannerReport.flexBoostTip.totalCost)}</b> · доход ~
                <b>{formatMoney(scannerReport.flexBoostTip.annualIncomeAfter)}/год</b>
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
                className="px-2.5 py-1 rounded-xl bg-amber-400 text-slate-950 font-extrabold text-[11px] hover:bg-amber-300 cursor-pointer transition"
              >
                + В портфель
              </button>
            </div>
          </div>
        )}

        {/* Карточки кандидатов */}
        <div className="space-y-2">
          {scannerReport.candidates.slice(0, 8).map((c) => {
            const monthsLbl = c.instrument.payoutMonths.map((m) => MONTH_SHORT_RU[m - 1]).join(', ');
            const canBuyNow = c.affordableLots > 0;
            const canBuyWithFlex = !canBuyNow && c.flexTopUpNeeded > 0;

            return (
              <div
                key={c.instrument.ticker}
                className={`rounded-2xl p-3 border transition ${
                  canBuyNow
                    ? 'bg-[var(--fld)] border-[var(--line)]'
                    : canBuyWithFlex
                    ? 'bg-amber-500/8 border-amber-400/35'
                    : 'bg-black/20 border-white/8 opacity-75'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-extrabold text-white">{c.instrument.name}</span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                          ASSET_KIND_META[c.instrument.kind].badgeClass
                        }`}
                      >
                        {c.instrument.annualYieldPct}% год.
                      </span>
                      {strategy === 'monthly_salary' && c.newMonthsCovered.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-200">
                          +{c.newMonthsCovered.map((m) => MONTH_SHORT_RU[m - 1]).join(', ')}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400 mt-0.5">
                      Лот ({c.instrument.lotSize} шт): <b className="text-slate-200">{formatMoney(c.lotPrice)}</b> · Выплаты: {monthsLbl}
                    </div>
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
                    className="px-2.5 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-[11px] font-bold text-white shrink-0 cursor-pointer transition"
                  >
                    + {canBuyNow ? `${c.affordableUnits} шт` : `${c.instrument.lotSize} шт`}
                  </button>
                </div>

                <div className="mt-2 pt-2 border-t border-white/8 flex items-center justify-between gap-2 text-[11px] flex-wrap">
                  {canBuyNow ? (
                    <span className="text-emerald-200">
                      На {formatMoney(scannerReport.budgetUsed)} доступно: <b>{c.affordableUnits} шт</b> ({formatMoney(c.affordableCost)}) → <b>+{formatMoney(c.expectedAnnualIncome)}/год</b>
                    </span>
                  ) : canBuyWithFlex ? (
                    <span className="text-amber-200">
                      Не хватает <b>{formatMoney(c.flexTopUpNeeded)}</b> (в пределах погрешности 1 000 ₽) для покупки 1 лота
                    </span>
                  ) : (
                    <span className="text-slate-400">
                      Нужно ещё {formatMoney(Math.max(0, Math.ceil(c.lotPrice - scannerReport.budgetUsed)))} для 1 лота
                    </span>
                  )}

                  {canBuyNow && c.flexTopUpNeeded > 0 && (
                    <span className="text-[10px] font-bold text-amber-200">
                      ✨ +{formatMoney(c.flexTopUpNeeded)} даст ещё 1 лот (+{formatMoney(c.flexExtraAnnualIncome)}/год)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </GlassSection>
    </>
  );
}
