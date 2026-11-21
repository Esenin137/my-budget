import React, { useState } from 'react';
import { Bell, Check, Clock, Lock, Pencil, Trash2, X } from 'lucide-react';
import {
  CalendarTask,
  CategoryTuple,
  DepositItem,
  FamilyNamedAmount,
  PeriodMode,
  RepeatFreq,
  Transaction,
} from '../types';
import {
  fmtShortDate,
  formatMoney,
  getPeriodTitle,
  INC_CAT_LIST,
  isTxInPeriod,
  parseNum,
} from '../utils/finance';
import { isoDate, normDate } from '../utils/storage';
import type { UpcomingReminder } from '../utils/notifications';

// 1. Due Task Reminder Banner (In-app notification with Snooze +15 min & Done)
interface ReminderBannerProps {
  task: CalendarTask;
  onComplete: (id: number) => void;
  onSnooze: (id: number) => void;
  onDismiss: () => void;
}

export function ReminderAlertToast({ task, onComplete, onSnooze, onDismiss }: ReminderBannerProps) {
  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-[390px] z-[90] rounded-2xl bg-[#132623] border border-amber-400/50 shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-amber-300 flex items-center gap-1.5">
            <span>Напоминание ежедневника</span>
            {task.time && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">{task.time}</span>
              </>
            )}
          </div>
          <div className="text-sm font-bold text-white mt-0.5 break-words">{task.title}</div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => onComplete(task.id)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Выполнено</span>
            </button>
            <button
              type="button"
              onClick={() => onSnooze(task.id)}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-xs font-semibold flex items-center gap-1 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>+15 мин</span>
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto p-1.5 text-slate-400 hover:text-white cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 1b. Approaching Financial Reminder Banner (Tomorrow / Today for deposits, coupons, dividends, payments)
interface FinancialReminderToastProps {
  reminder: UpcomingReminder;
  stage: 'today' | 'tomorrow';
  onOpen: (reminder: UpcomingReminder) => void;
  onDismiss: () => void;
}

export function FinancialReminderToast({
  reminder,
  stage,
  onOpen,
  onDismiss,
}: FinancialReminderToastProps) {
  const leadText = stage === 'tomorrow' ? 'Завтра' : 'Сегодня';
  const kindLabel =
    reminder.kind === 'deposit'
      ? 'Срок вклада'
      : reminder.kind === 'coupon'
      ? 'Выплата купона'
      : reminder.kind === 'dividend'
      ? 'Выплата дивидендов'
      : reminder.kind === 'recurring'
      ? 'Повторяющийся платёж'
      : 'Событие календаря';

  return (
    <div className="fixed top-4 right-4 left-4 sm:left-auto sm:w-[400px] z-[90] rounded-2xl bg-[#112420] border border-emerald-400/50 shadow-2xl p-4">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
          <Bell className="w-5 h-5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
            <span>{leadText}</span>
            <span aria-hidden="true">·</span>
            <span>{kindLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">{fmtShortDate(reminder.dateIso)}</span>
          </div>
          <div className="text-sm font-bold text-white mt-0.5 break-words">{reminder.title}</div>
          <div className="text-xs text-slate-300 mt-0.5 tabular-nums">
            {reminder.subtitle}
            {reminder.amount && reminder.amount > 0 ? ` · ${formatMoney(reminder.amount)}` : ''}
          </div>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => onOpen(reminder)}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold cursor-pointer"
            >
              Открыть
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-100 text-xs font-semibold cursor-pointer"
            >
              Понятно
            </button>
            <button
              type="button"
              onClick={onDismiss}
              className="ml-auto p-1.5 text-slate-400 hover:text-white cursor-pointer"
              aria-label="Закрыть"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 2. PIN Lock / Setup Overlay
interface PinOverlayProps {
  mode: 'unlock' | 'set1' | 'set2' | 'disable';
  errorText: string;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onCancel?: () => void;
  filledCount: number;
}

export function PinOverlay({
  mode,
  errorText,
  onDigit,
  onBackspace,
  onCancel,
  filledCount,
}: PinOverlayProps) {
  const titles: Record<typeof mode, { t: string; sub: string }> = {
    unlock: { t: 'Введите ПИН-код', sub: 'Для расшифровки данных (AES-GCM-256) на вашем устройстве' },
    set1: { t: 'Придумайте 4-значный ПИН', sub: 'База данных будет зашифрована вашим ПИН-кодом' },
    set2: { t: 'Повторите ПИН-код', sub: 'Подтвердите 4 цифры для включения шифрования' },
    disable: { t: 'Введите текущий ПИН', sub: 'Чтобы отключить ПИН-код и снять шифрование' },
  };
  const info = titles[mode];

  return (
    <div className="fixed inset-0 z-[100] bg-[#070E0D]/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-xs rounded-3xl bg-[#0F1B19] border border-white/15 p-6 text-center shadow-2xl">
        <div className="w-12 h-12 rounded-2xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center mx-auto mb-3">
          <Lock className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-bold text-white">{info.t}</h2>
        <p className="text-xs text-slate-400 mt-1">{info.sub}</p>

        <div className="flex justify-center gap-3.5 my-5">
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${
                i < filledCount
                  ? 'bg-emerald-400 border-emerald-400 scale-110'
                  : 'border-white/30 bg-transparent'
              }`}
            />
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => onDigit(k)}
              className="h-13 rounded-2xl bg-[#162724] hover:bg-[#1E3531] active:scale-95 border border-white/10 text-lg font-bold text-white tabular-nums transition cursor-pointer"
            >
              {k}
            </button>
          ))}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="h-13 rounded-2xl bg-transparent hover:bg-white/5 text-xs font-semibold text-slate-400 cursor-pointer"
            >
              Отмена
            </button>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={() => onDigit('0')}
            className="h-13 rounded-2xl bg-[#162724] hover:bg-[#1E3531] active:scale-95 border border-white/10 text-lg font-bold text-white tabular-nums transition cursor-pointer"
          >
            0
          </button>
          <button
            type="button"
            onClick={onBackspace}
            className="h-13 rounded-2xl bg-transparent hover:bg-white/5 text-sm font-semibold text-slate-400 cursor-pointer"
          >
            ⌫
          </button>
        </div>

        {errorText && <div className="text-xs text-rose-400 mt-4">{errorText}</div>}
      </div>
    </div>
  );
}

// 3. Generic Modal Shell
export function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[80] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg max-h-[86vh] overflow-y-auto rounded-2xl bg-[#0F1B19] border border-white/15 p-5 shadow-2xl">
        <div className="flex items-center justify-between gap-3 pb-3 mb-4 border-b border-white/10">
          <h3 className="text-base font-bold text-white truncate">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/8 cursor-pointer"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// 4. Period Breakdown Modal
export function PeriodBreakdownModal({
  kind,
  initialScope,
  dayIso,
  initialCategory,
  allTx,
  customStart,
  customEnd,
  onClose,
  onEditTx,
  onDeleteTx,
}: {
  kind: 'in' | 'out' | 'left';
  initialScope: PeriodMode;
  dayIso: string;
  initialCategory: string | null;
  allTx: Transaction[];
  customStart: string;
  customEnd: string;
  onClose: () => void;
  onEditTx: (tx: Transaction) => void;
  onDeleteTx: (id: number) => void;
}) {
  const [scope, setScope] = useState<PeriodMode>(initialScope);
  const [filterCat, setFilterCat] = useState<string | null>(initialCategory);

  const [y, m, d] = normDate(dayIso).split('-').map(Number);
  const dtObj = new Date(y, m - 1, d);
  const periodLabel = getPeriodTitle(scope, dtObj, customStart, customEnd);

  const periodTx = allTx.filter((t) => isTxInPeriod(t.d, scope, dtObj, customStart, customEnd));
  const activeTx = periodTx
    .filter((t) => {
      if (kind === 'in') return t.t === 'in';
      if (kind === 'out') return t.t !== 'in' && (!filterCat || t.c === filterCat);
      return true;
    })
    .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.id - a.id));

  const outSum = periodTx
    .filter((t) => t.t !== 'in' && (!filterCat || t.c === filterCat))
    .reduce((a, t) => a + t.a, 0);
  const inSum = periodTx.filter((t) => t.t === 'in').reduce((a, t) => a + t.a, 0);
  const curLeft = inSum - outSum;

  const title =
    kind === 'in'
      ? 'Детализация доходов'
      : kind === 'out'
      ? filterCat
        ? `Категория «${filterCat}»`
        : 'Детализация расходов'
      : 'Сводка и остаток';

  return (
    <ModalShell title={title} onClose={onClose}>
      <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-[#0A1312] border border-white/10 mb-4">
        {(['day', 'week', 'month', 'year', 'custom'] as PeriodMode[]).map((sc) => (
          <button
            key={sc}
            type="button"
            onClick={() => setScope(sc)}
            className={`py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
              scope === sc ? 'bg-emerald-600 text-white' : 'text-slate-400 hover:text-white'
            }`}
          >
            {sc === 'day' ? 'День' : sc === 'week' ? 'Неделя' : sc === 'month' ? 'Месяц' : sc === 'year' ? 'Год' : 'Даты'}
          </button>
        ))}
      </div>

      <div className="rounded-xl bg-[#0A1312] border border-white/10 p-3.5 mb-4 flex items-center justify-between gap-2">
        <div>
          <div className="text-xs text-slate-400">{periodLabel}</div>
          <div
            className={`text-xl font-bold font-mono tabular-nums mt-0.5 ${
              kind === 'in'
                ? 'text-emerald-400'
                : kind === 'out'
                ? 'text-rose-400'
                : curLeft >= 0
                ? 'text-emerald-400'
                : 'text-rose-400'
            }`}
          >
            {kind === 'in'
              ? `+${formatMoney(inSum)}`
              : kind === 'out'
              ? `−${formatMoney(outSum)}`
              : formatMoney(curLeft)}
          </div>
        </div>
        <div className="text-xs text-slate-400 tabular-nums">Записей: {activeTx.length}</div>
      </div>

      {filterCat && (
        <button
          type="button"
          onClick={() => setFilterCat(null)}
          className="w-full mb-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-xs font-semibold text-slate-200 cursor-pointer"
        >
          Показать все категории
        </button>
      )}

      <div className="space-y-2 max-h-[45vh] overflow-y-auto pr-1">
        {activeTx.length === 0 ? (
          <div className="text-center text-sm text-slate-500 py-8">
            За выбранный период ({periodLabel}) записей нет.
          </div>
        ) : (
          activeTx.map((t) => (
            <div
              key={t.id}
              className="rounded-xl bg-[#0A1312] border border-white/8 px-3 py-2.5 flex items-center justify-between gap-2"
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{t.n || t.c}</div>
                <div className="text-xs text-slate-400 tabular-nums">
                  {fmtShortDate(t.d)} · {t.c} · {t.m}
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span
                  className={`text-sm font-bold font-mono tabular-nums ${
                    t.t === 'in' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {t.t === 'in' ? '+' : '−'}
                  {formatMoney(t.a)}
                </span>
                <button
                  type="button"
                  onClick={() => onEditTx(t)}
                  className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteTx(t.id)}
                  className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </ModalShell>
  );
}

// 5. Edit Transaction Modal
export function EditTxModal({
  tx,
  cats,
  onSave,
  onClose,
}: {
  tx: Transaction;
  cats: CategoryTuple[];
  onSave: (updated: Transaction) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(tx.n || '');
  const [amt, setAmt] = useState(String(tx.a));
  const [date, setDate] = useState(normDate(tx.d));
  const [cat, setCat] = useState(tx.c);
  const [method, setMethod] = useState(tx.m || 'Карта');
  const [repeat, setRepeat] = useState<RepeatFreq>(tx.repeat || 'none');
  const [type, setType] = useState<'in' | 'out'>(tx.t);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseNum(amt);
    if (!(a > 0)) return;
    onSave({
      ...tx,
      n: name.trim() || cat,
      a,
      d: normDate(date || isoDate(new Date())),
      c: cat,
      m: type === 'in' ? 'Доход' : method,
      repeat: type === 'in' ? 'none' : repeat,
      t: type,
    });
  };

  return (
    <ModalShell title={type === 'in' ? 'Редактировать доход' : 'Редактировать расход'} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="text-xs text-slate-400 block">
          Название
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400 block">
            Сумма, ₽
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              inputMode="decimal"
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white tabular-nums"
            />
          </label>
          <label className="text-xs text-slate-400 block">
            Дата
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white tabular-nums"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400 block">
            Категория
            <select
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
            >
              {(type === 'in' ? INC_CAT_LIST : cats.map((c) => c[0])).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-400 block">
            Тип
            <select
              value={type}
              onChange={(e) => setType(e.target.value as 'in' | 'out')}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
            >
              <option value="out">Расход</option>
              <option value="in">Доход</option>
            </select>
          </label>
        </div>
        {type === 'out' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-slate-400 block">
              Способ оплаты
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
              >
                <option>Карта</option>
                <option>Наличка</option>
                <option>Кредит / Ипотека</option>
              </select>
            </label>
            <label className="text-xs text-slate-400 block">
              Повтор
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as RepeatFreq)}
                className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
              >
                <option value="none">Один раз</option>
                <option value="monthly">Каждый месяц</option>
                <option value="weekly">Каждую неделю</option>
                <option value="yearly">Каждый год</option>
              </select>
            </label>
          </div>
        )}
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold cursor-pointer"
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl bg-white/5 text-slate-300 text-sm cursor-pointer"
          >
            Отмена
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// 6. Edit Deposit Modal
export function EditDepositModal({
  deposit,
  onSave,
  onClose,
}: {
  deposit: DepositItem;
  onSave: (d: DepositItem) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(deposit.name);
  const [rate, setRate] = useState(String(deposit.rate || ''));
  const [sum, setSum] = useState(String(deposit.sum || 0));
  const [rule, setRule] = useState(deposit.rule || '');

  return (
    <ModalShell title="Редактировать вклад" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          onSave({ ...deposit, name: name.trim(), rate: parseNum(rate), sum: parseNum(sum), rule: rule.trim() });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400 block">
            Название
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400 block">
            % годовых
            <input
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              inputMode="decimal"
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white tabular-nums"
            />
          </label>
          <label className="text-xs text-slate-400 block">
            Сумма, ₽
            <input
              value={sum}
              onChange={(e) => setSum(e.target.value)}
              inputMode="decimal"
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white tabular-nums"
            />
          </label>
          <label className="text-xs text-slate-400 block">
            Правило
            <input
              value={rule}
              onChange={(e) => setRule(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
            />
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold cursor-pointer"
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl bg-white/5 text-slate-300 text-sm cursor-pointer"
          >
            Отмена
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// 7. Edit Family Item Modal
export function EditFamilyModal({
  listKey,
  item,
  onSave,
  onClose,
}: {
  listKey: 'balances' | 'expenses' | 'loans';
  item: FamilyNamedAmount;
  onSave: (listKey: 'balances' | 'expenses' | 'loans', updated: FamilyNamedAmount) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(item.name);
  const [amt, setAmt] = useState(String(item.amount));

  return (
    <ModalShell title="Изменить запись семьи" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const raw = amt.trim().replace(/\s/g, '').replace(',', '.');
          const val = listKey === 'balances' ? parseFloat(raw) : parseNum(raw);
          if (isNaN(val) || val === 0) return;
          onSave(listKey, { ...item, name: name.trim() || item.name, amount: val });
        }}
        className="space-y-3"
      >
        <div className="grid grid-cols-2 gap-3">
          <label className="text-xs text-slate-400 block">
            Название
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
            />
          </label>
          <label className="text-xs text-slate-400 block">
            Сумма, ₽
            <input
              value={amt}
              onChange={(e) => setAmt(e.target.value)}
              inputMode="decimal"
              className="w-full mt-1 px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white tabular-nums"
            />
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 min-h-[42px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold cursor-pointer"
          >
            Сохранить
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] px-4 rounded-xl bg-white/5 text-slate-300 text-sm cursor-pointer"
          >
            Отмена
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

// 8. Category Manager Modal
export function CategoriesModal({
  cats,
  onUpdateCats,
  onClose,
}: {
  cats: CategoryTuple[];
  onUpdateCats: (next: CategoryTuple[]) => void;
  onClose: () => void;
}) {
  const [newName, setNewName] = useState('');
  const [newKw, setNewKw] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    const next = [...cats];
    next.splice(Math.max(0, next.length - 1), 0, [newName.trim(), '#189A7C', newKw.trim()]);
    onUpdateCats(next);
    setNewName('');
    setNewKw('');
  };

  return (
    <ModalShell title="Категории расходов" onClose={onClose}>
      <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1 mb-4">
        {cats.map((c, idx) => (
          <div
            key={`${c[0]}-${idx}`}
            className="flex items-center justify-between px-3 py-2 rounded-xl bg-[#0A1312] border border-white/8 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full" style={{ backgroundColor: c[1] }} />
              <span className="text-white">{c[0]}</span>
            </div>
            {c[0] !== 'Другое' && (
              <button
                type="button"
                onClick={() => onUpdateCats(cats.filter((_, i) => i !== idx))}
                className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      <form onSubmit={handleAdd} className="space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название категории"
            className="px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
          />
          <input
            value={newKw}
            onChange={(e) => setNewKw(e.target.value)}
            placeholder="Ключевые слова (через запятую)"
            className="px-3 py-2 rounded-xl bg-[#0A1312] border border-white/12 text-sm text-white"
          />
        </div>
        <button
          type="submit"
          className="w-full min-h-[40px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold cursor-pointer"
        >
          Добавить категорию
        </button>
      </form>
    </ModalShell>
  );
}
