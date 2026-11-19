import React, { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { FamilyNamedAmount, FamilyState, Transaction } from '../types';
import { fmtMonthName, formatMoney, parseNum, uid } from '../utils/finance';
import { isoDate, normDate } from '../utils/storage';
import GlassSection from './GlassSection';

interface FamilyTabProps {
  family: FamilyState;
  curDate: Date;
  allTx: Transaction[];
  collapsedSecs: string[];
  onToggleSec: (id: string) => void;
  onUpdateFamily: (next: FamilyState) => void;
  onEditFamilyItem: (listKey: 'balances' | 'expenses' | 'loans', item: FamilyNamedAmount) => void;
  onShowToast: (msg: string) => void;
}

export default function FamilyTab({
  family,
  curDate,
  allTx,
  collapsedSecs,
  onToggleSec,
  onUpdateFamily,
  onEditFamilyItem,
  onShowToast,
}: FamilyTabProps) {
  const [balName, setBalName] = useState('');
  const [balAmt, setBalAmt] = useState('');
  const [expName, setExpName] = useState('');
  const [expAmt, setExpAmt] = useState('');
  const [loanName, setLoanName] = useState('');
  const [loanAmt, setLoanAmt] = useState('');

  const ym = isoDate(curDate).slice(0, 7);
  const monthLabel = fmtMonthName(curDate);
  const sumBalances = family.balances.reduce((a, x) => a + (+x.amount || 0), 0);
  const startTotal = family.totalSavings || 0;
  const projectedTotal = startTotal + sumBalances;

  const handlePullPersonalLeft = () => {
    const pTx = allTx.filter((t) => normDate(t.d).slice(0, 7) === ym);
    const sIn = pTx.filter((t) => t.t === 'in').reduce((a, t) => a + t.a, 0);
    const sOut = pTx.filter((t) => t.t !== 'in').reduce((a, t) => a + t.a, 0);
    const left = Math.round((sIn - sOut) * 100) / 100;
    setBalName(`Мой остаток (${ym.slice(5, 7)}.${ym.slice(0, 4)})`);
    setBalAmt(String(left));
    onShowToast(`Подставлен остаток ${formatMoney(left)}. Нажмите «+».`);
  };

  const handleAddBalance = (e: React.FormEvent) => {
    e.preventDefault();
    const val = parseFloat(balAmt.trim().replace(/\s/g, '').replace(',', '.'));
    if (isNaN(val) || val === 0) return;
    onUpdateFamily({
      ...family,
      balances: [
        ...family.balances,
        { id: uid(), name: balName.trim() || 'Остаток со счёта', amount: val, d: isoDate(curDate) },
      ],
    });
    setBalName('');
    setBalAmt('');
  };

  const handleAddReminder = (key: 'expenses' | 'loans', name: string, rawAmt: string) => {
    const amt = parseNum(rawAmt);
    if (!(amt > 0)) return;
    onUpdateFamily({
      ...family,
      [key]: [
        ...family[key],
        { id: uid(), name: name.trim() || 'Платёж', amount: amt, done: false },
      ],
    });
  };

  const handleSaveMonthSnapshot = () => {
    const finalSav = Math.round((startTotal + sumBalances) * 100) / 100;
    const record = {
      month: ym,
      label: monthLabel,
      start: startTotal,
      delta: sumBalances,
      total: finalSav,
      savedAt: isoDate(new Date()),
    };
    const nextHistory = family.history.filter((h) => h.month !== ym);
    nextHistory.push(record);
    nextHistory.sort((a, b) => (a.month < b.month ? -1 : a.month > b.month ? 1 : 0));

    onUpdateFamily({
      ...family,
      totalSavings: finalSav,
      balances: [],
      history: nextHistory,
      lastMonth: ym,
    });
    onShowToast(`✅ Итог за ${monthLabel} сохранён: ${formatMoney(finalSav)}`);
  };

  const previewList = [
    ...family.history.slice(-5).map((h) => ({ ...h, isPreview: false })),
    ...(sumBalances !== 0 || family.history.length === 0
      ? [{ month: ym, label: `${monthLabel} (тек.)`, start: startTotal, delta: sumBalances, total: projectedTotal, isPreview: true }]
      : []),
  ];
  const maxAbs = Math.max(1, ...previewList.map((h) => Math.abs(h.total) || 1));

  return (
    <>

      <GlassSection
        id="sec-fam-main"
        title="👨‍👩‍👧‍👦 Накопления и итог месяца"
        helpText="Здесь ведётся общий семейный капитал: стартовые накопления, остатки на счетах и картах, обязательные семейные платежи и кредиты. Обязательные платежи учитываются в проверке дублей задач."
        rightExtra={<span className="fin-sub">{monthLabel}</span>}
        collapsed={collapsedSecs.includes('sec-fam-main')}
        onToggleCollapse={onToggleSec}
      >
        <div className="grid grid-cols-2 gap-2">
          <label className="fin-sub block">
            Старт месяца, ₽
            <input
              className="fin-input w-full mt-1 tabular-nums"
              inputMode="decimal"
              value={family.totalSavings || ''}
              onChange={(e) => onUpdateFamily({ ...family, totalSavings: parseNum(e.target.value) })}
              placeholder="0"
            />
          </label>
          <label className="fin-sub block">
            Доход семьи, ₽
            <input
              className="fin-input w-full mt-1 tabular-nums"
              inputMode="decimal"
              value={family.income || ''}
              onChange={(e) => onUpdateFamily({ ...family, income: parseNum(e.target.value) })}
              placeholder="0"
            />
          </label>
        </div>

        <div className="flex items-center justify-between">
          <span className="fin-sub font-bold">💳 Остатки со счетов:</span>
          <button
            type="button"
            onClick={handlePullPersonalLeft}
            className="fin-btn ghost sm"
            style={{ padding: '3px 8px', fontSize: '.72rem' }}
          >
            + Мой остаток
          </button>
        </div>

        <div className="space-y-1.5 max-h-32 overflow-y-auto">
          {family.balances.length === 0 ? (
            <div className="fin-sub">Внесите остатки со счетов членов семьи.</div>
          ) : (
            family.balances.map((b) => (
              <div key={b.id} className="tx-tile">
                <b className="truncate">{b.name}</b>
                <div className="flex items-center gap-1 shrink-0">
                  <b className={`tabular-nums ${b.amount >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {b.amount >= 0 ? '+' : '−'}
                    {formatMoney(Math.abs(b.amount))}
                  </b>
                  <button
                    type="button"
                    onClick={() => onEditFamilyItem('balances', b)}
                    className="p-1 text-slate-400 hover:text-white cursor-pointer"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onUpdateFamily({
                        ...family,
                        balances: family.balances.filter((x) => x.id !== b.id),
                      })
                    }
                    className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <form onSubmit={handleAddBalance} className="flex gap-1.5">
          <input
            className="fin-input flex-1"
            value={balName}
            onChange={(e) => setBalName(e.target.value)}
            placeholder="Чей счёт (Муж, Жена)"
          />
          <input
            className="fin-input w-24 tabular-nums"
            inputMode="decimal"
            value={balAmt}
            onChange={(e) => setBalAmt(e.target.value)}
            placeholder="Сумма"
          />
          <button type="submit" className="fin-btn sm">
            +
          </button>
        </form>

        <div className="grid grid-cols-2 gap-2">
          <div className="sum-card-flat">
            <div className="fin-sub">Сумма остатков</div>
            <div
              className={`font-extrabold text-base tabular-nums ${
                sumBalances >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {sumBalances >= 0 ? '+' : '−'}
              {formatMoney(Math.abs(sumBalances))}
            </div>
          </div>
          <div className="sum-card-flat">
            <div className="fin-sub">Итого накопления</div>
            <div className="font-extrabold text-base tabular-nums text-white">
              {formatMoney(projectedTotal)}
            </div>
          </div>
        </div>

        <button type="button" onClick={handleSaveMonthSnapshot} className="fin-btn w-full">
          💾 Зафиксировать результат месяца
        </button>
      </GlassSection>

      <GlassSection
        id="sec-fam-rem"
        title="🔔 Напоминания платежей"
        helpText="Чек-лист постоянных семейных платежей (ЖКХ, садик, связь), кредитов и долгов. Нажимайте на строку, чтобы отметить оплату. Учитывается защитой от двойного списания в ежедневнике."
        collapsed={collapsedSecs.includes('sec-fam-rem')}
        onToggleCollapse={onToggleSec}
      >
        <div className="fin-sub font-bold">🏠 Постоянные расходы (ЖКХ, связь):</div>
        <div className="space-y-1.5">
          {family.expenses.map((x) => (
            <div
              key={x.id}
              onClick={() =>
                onUpdateFamily({
                  ...family,
                  expenses: family.expenses.map((it) =>
                    it.id === x.id ? { ...it, done: !it.done } : it
                  ),
                })
              }
              className="tx-tile cursor-pointer"
              style={{ opacity: x.done ? 0.6 : 1 }}
            >
              <span className={x.done ? 'line-through' : ''}>
                {x.done ? '✅' : '🔔'} {x.name}
              </span>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <span className="fin-sub tabular-nums">{formatMoney(x.amount)}</span>
                <button
                  type="button"
                  onClick={() => onEditFamilyItem('expenses', x)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateFamily({
                      ...family,
                      expenses: family.expenses.filter((it) => it.id !== x.id),
                    })
                  }
                  className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddReminder('expenses', expName, expAmt);
            setExpName('');
            setExpAmt('');
          }}
          className="flex gap-1.5"
        >
          <input
            className="fin-input flex-1"
            value={expName}
            onChange={(e) => setExpName(e.target.value)}
            placeholder="ЖКХ, Школа..."
          />
          <input
            className="fin-input w-22 tabular-nums"
            inputMode="decimal"
            value={expAmt}
            onChange={(e) => setExpAmt(e.target.value)}
            placeholder="Сумма"
          />
          <button type="submit" className="fin-btn ghost sm">
            +
          </button>
        </form>

        <div className="fin-sub font-bold pt-1">🏦 Ипотека, кредиты и займы:</div>
        <div className="space-y-1.5">
          {family.loans.map((x) => (
            <div
              key={x.id}
              onClick={() =>
                onUpdateFamily({
                  ...family,
                  loans: family.loans.map((it) =>
                    it.id === x.id ? { ...it, done: !it.done } : it
                  ),
                })
              }
              className="tx-tile cursor-pointer"
              style={{ opacity: x.done ? 0.6 : 1 }}
            >
              <span className={x.done ? 'line-through' : ''}>
                {x.done ? '✅' : '🏦'} {x.name}
              </span>
              <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                <span className="fin-sub tabular-nums">{formatMoney(x.amount)}</span>
                <button
                  type="button"
                  onClick={() => onEditFamilyItem('loans', x)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onUpdateFamily({
                      ...family,
                      loans: family.loans.filter((it) => it.id !== x.id),
                    })
                  }
                  className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAddReminder('loans', loanName, loanAmt);
            setLoanName('');
            setLoanAmt('');
          }}
          className="flex gap-1.5"
        >
          <input
            className="fin-input flex-1"
            value={loanName}
            onChange={(e) => setLoanName(e.target.value)}
            placeholder="Ипотека / Кредит"
          />
          <input
            className="fin-input w-22 tabular-nums"
            inputMode="decimal"
            value={loanAmt}
            onChange={(e) => setLoanAmt(e.target.value)}
            placeholder="Сумма"
          />
          <button type="submit" className="fin-btn ghost sm">
            +
          </button>
        </form>
      </GlassSection>

      <GlassSection
        id="sec-fam-hist"
        title="📈 Динамика накоплений семьи"
        helpText="График изменений семейного капитала по месяцам после фиксации результатов. Зелёные столбцы — рост накоплений, красные — просадка."
        collapsed={collapsedSecs.includes('sec-fam-hist')}
        onToggleCollapse={onToggleSec}
      >
        <div
          className="grid gap-2 h-22 p-2.5 rounded-2xl bg-[var(--fld)] border border-[var(--line)] items-end"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, previewList.length)}, 1fr)` }}
        >
          {previewList.map((h) => {
            const pct = Math.max(14, Math.round((Math.abs(h.total) / maxAbs) * 100));
            const shortM = `${h.month.slice(5, 7)}.${h.month.slice(2, 4)}`;
            return (
              <div
                key={`${h.month}-${h.isPreview ? 'p' : 's'}`}
                className="flex flex-col items-center gap-1 h-full justify-end"
              >
                <div className="w-full max-w-[16px] flex-1 bg-white/8 rounded-full flex items-end overflow-hidden">
                  <div
                    className="w-full rounded-full"
                    style={{
                      height: `${pct}%`,
                      opacity: h.isPreview ? 0.65 : 1,
                      background:
                        h.delta >= 0
                          ? 'linear-gradient(180deg,#34D399,#10B981)'
                          : 'linear-gradient(180deg,#F05A44,#B83220)',
                    }}
                  />
                </div>
                <span className="text-[10px] text-[var(--mute)] tabular-nums">
                  {h.isPreview ? 'Сейчас' : shortM}
                </span>
              </div>
            );
          })}
        </div>

        {family.history.length > 0 && (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {family.history
              .slice()
              .reverse()
              .map((h) => (
                <div key={h.month} className="tx-tile">
                  <div>
                    <b>{h.label || h.month}</b>
                    <div className="fin-sub tabular-nums">
                      Старт: {formatMoney(h.start)} ·{' '}
                      <span className={h.delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                        {h.delta >= 0 ? '+' : '−'}
                        {formatMoney(Math.abs(h.delta))}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <b className="tabular-nums">{formatMoney(h.total)}</b>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateFamily({
                          ...family,
                          history: family.history.filter((x) => x.month !== h.month),
                        })
                      }
                      className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </GlassSection>
    </>
  );
}
