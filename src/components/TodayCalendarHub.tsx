import React, { useMemo, useState } from 'react';
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  HelpCircle,
  Mic,
  Plus,
} from 'lucide-react';
import { AppState, TabId } from '../types';
import {
  analyzeFinancialHealth,
  fmtHumanDate,
  fmtMonthName,
  fmtShortDate,
  formatMoney,
  getRepeatLabel,
  getTasksForDate,
  getWeekBounds,
  isTaskDoneOnDate,
} from '../utils/finance';
import { isoDate } from '../utils/storage';
import {
  collectUpcomingReminders,
  formatReminderLeadLabel,
} from '../utils/notifications';

export type HubHorizon = 'today' | 'week' | 'month';

interface UnifiedEvent {
  id: string;
  date: string;
  time?: string;
  title: string;
  subtitle: string;
  amount?: number;
  kind: 'task' | 'expense' | 'income' | 'recurring' | 'deposit' | 'payout';
  done?: boolean;
  targetTab: TabId;
  targetDate?: string;
  targetSectionId?: string;
}

interface TodayCalendarHubProps {
  state: AppState;
  curDate: Date;
  periodTx: AppState['tx'];
  showSafePill: boolean;
  onNavigateToTab: (tab: TabId, jumpDateIso?: string, targetSectionId?: string) => void;
  onOpenUniversalVoice: () => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function addDays(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + delta);
}

function advanceRepeatDate(
  baseYear: number,
  baseMonth: number,
  baseDay: number,
  step: number,
  freq: 'weekly' | 'monthly' | 'yearly'
): Date {
  if (freq === 'weekly') {
    return new Date(baseYear, baseMonth, baseDay + step * 7);
  }
  if (freq === 'monthly') {
    const targetMonth = baseMonth + step;
    const maxDay = new Date(baseYear, targetMonth + 1, 0).getDate();
    return new Date(baseYear, targetMonth, Math.min(baseDay, maxDay));
  }
  const targetYear = baseYear + step;
  const maxDay = new Date(targetYear, baseMonth + 1, 0).getDate();
  return new Date(targetYear, baseMonth, Math.min(baseDay, maxDay));
}

export default function TodayCalendarHub({
  state,
  curDate,
  periodTx,
  showSafePill,
  onNavigateToTab,
  onOpenUniversalVoice,
}: TodayCalendarHubProps) {
  const [horizon, setHorizon] = useState<HubHorizon>('today');
  const [selectedIso, setSelectedIso] = useState<string>(() => isoDate(new Date()));
  const [calMonth, setCalMonth] = useState<Date>(() => new Date());
  const [showCalGrid, setShowCalGrid] = useState<boolean>(false);
  const [collapsed, setCollapsed] = useState<boolean>(false);
  const [showHelp, setShowHelp] = useState<boolean>(false);

  const todayIso = isoDate(new Date());
  const health = useMemo(() => analyzeFinancialHealth(periodTx, curDate), [periodTx, curDate]);

  // Compute date range for the selected horizon
  const rangeDates = useMemo(() => {
    const [y, m, d] = selectedIso.split('-').map(Number);
    const anchor = new Date(y, m - 1, d);
    if (horizon === 'today') {
      return [selectedIso];
    }
    if (horizon === 'week') {
      const wb = getWeekBounds(anchor);
      const [sy, sm, sd] = wb.start.split('-').map(Number);
      const startD = new Date(sy, sm - 1, sd);
      return Array.from({ length: 7 }, (_, i) => isoDate(addDays(startD, i)));
    }
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const dim = new Date(year, month + 1, 0).getDate();
    return Array.from({ length: dim }, (_, i) => isoDate(new Date(year, month, i + 1)));
  }, [horizon, selectedIso, calMonth]);

  // Build unified event feed across Tasks, Expenses, Income, and scheduled Recurring payments
  // (Family tab reminders/debts are kept strictly inside «Семья» as reference memos)
  const unifiedEvents = useMemo<UnifiedEvent[]>(() => {
    const out: UnifiedEvent[] = [];
    const dateSet = new Set(rangeDates);
    const rangeEndIso = rangeDates[rangeDates.length - 1] || todayIso;

    // 1. Calendar tasks (including repeating tasks!)
    rangeDates.forEach((dIso) => {
      const dayTasks = getTasksForDate(state.tasks, dIso);
      dayTasks.forEach((t) => {
        const done = isTaskDoneOnDate(t, dIso);
        const repLbl = getRepeatLabel(t.repeat);
        out.push({
          id: `task-${t.id}-${dIso}`,
          date: dIso,
          time: t.time || undefined,
          title: t.title,
          subtitle: [t.time ? `⏰ ${t.time}` : 'Задача', repLbl].filter(Boolean).join(' · '),
          amount: t.amount,
          kind: 'task',
          done,
          targetTab: 'planner',
          targetDate: dIso,
          targetSectionId: 'sec-planner-cal',
        });
      });
    });

    // 2. Actual transactions (expenses & income) in range
    const recordedByParentAndDate = new Set<string>();
    state.tx.forEach((tx) => {
      if (tx.parentId) {
        recordedByParentAndDate.add(`${tx.parentId}:${tx.d}`);
      }
      if (!dateSet.has(tx.d)) return;
      out.push({
        id: `tx-${tx.id}`,
        date: tx.d,
        title: tx.n || tx.c,
        subtitle:
          tx.t === 'in'
            ? `Доход · ${tx.c}`
            : `${tx.c} · ${tx.m}${tx.repeat && tx.repeat !== 'none' ? ' · повтор' : ''}`,
        amount: tx.a,
        kind: tx.t === 'in' ? 'income' : 'expense',
        targetTab: tx.t === 'in' ? 'budget' : 'expenses',
        targetDate: tx.d,
        targetSectionId: tx.t === 'in' ? 'sec-inc-list' : 'sec-exp-list',
      });
    });

    // 3. Scheduled upcoming occurrences of user-created recurring expenses (repeat !== 'none')
    state.tx.forEach((tx) => {
      if (!tx.repeat || tx.repeat === 'none' || tx.parentId) return;
      const parts = tx.d.split('-').map(Number);
      if (parts.length !== 3 || parts.some(Number.isNaN)) return;
      const [baseYear, baseMonth1, baseDay] = parts;
      const baseMonth = baseMonth1 - 1;
      for (let step = 1; step <= 500; step++) {
        const nextIso = isoDate(advanceRepeatDate(baseYear, baseMonth, baseDay, step, tx.repeat));
        if (nextIso > rangeEndIso) break;
        if (dateSet.has(nextIso) && !recordedByParentAndDate.has(`${tx.id}:${nextIso}`)) {
          out.push({
            id: `rec-${tx.id}-${nextIso}`,
            date: nextIso,
            title: tx.n || tx.c,
            subtitle: `Повторяющийся платёж · ${tx.c}`,
            amount: tx.a,
            kind: 'recurring',
            targetTab: 'expenses',
            targetDate: nextIso,
            targetSectionId: 'sec-exp-list',
          });
        }
      }
    });

    // 4. Deposit maturities and coupon/dividend payout dates in range
    const investReminders = collectUpcomingReminders(state, 90);
    investReminders.forEach((rem) => {
      if (rem.kind !== 'deposit' && rem.kind !== 'coupon' && rem.kind !== 'dividend') return;
      if (!dateSet.has(rem.dateIso)) return;
      out.push({
        id: `inv-${rem.id}`,
        date: rem.dateIso,
        title: rem.title,
        subtitle: rem.subtitle,
        amount: rem.amount,
        kind: rem.kind === 'deposit' ? 'deposit' : 'payout',
        targetTab: 'invest',
        targetDate: rem.dateIso,
        targetSectionId: 'sec-inv-assets',
      });
    });

    return out.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const kindOrder: Record<UnifiedEvent['kind'], number> = {
        deposit: 0,
        payout: 1,
        task: 2,
        recurring: 3,
        expense: 4,
        income: 5,
      };
      if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
      if (kindOrder[a.kind] !== kindOrder[b.kind]) return kindOrder[a.kind] - kindOrder[b.kind];
      return (a.time || '99:99').localeCompare(b.time || '99:99');
    });
  }, [rangeDates, state, todayIso]);

  // Nearest approaching reminders (today, tomorrow, next 14 days) across tasks, payments, deposits & coupons
  const upcomingReminders = useMemo(() => collectUpcomingReminders(state, 14), [state]);

  // Dots map for the mini calendar
  const calCells = useMemo(() => {
    const year = calMonth.getFullYear();
    const month = calMonth.getMonth();
    const first = new Date(year, month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const gridStart = new Date(year, month, 1 - startOffset);

    const txByDay = new Map<string, { hasOut: boolean; hasIn: boolean }>();
    state.tx.forEach((t) => {
      const prev = txByDay.get(t.d) || { hasOut: false, hasIn: false };
      if (t.t === 'in') prev.hasIn = true;
      else prev.hasOut = true;
      txByDay.set(t.d, prev);
    });

    const investDateSet = new Set<string>();
    (state.investments?.assets || []).forEach((a) => {
      if (a.kind === 'deposit' && a.maturityDate) investDateSet.add(a.maturityDate);
      if ((a.kind === 'coupon' || a.kind === 'dividend') && a.nextPayoutDate) {
        investDateSet.add(a.nextPayoutDate);
      }
    });

    const cells: {
      iso: string;
      day: number;
      inMonth: boolean;
      hasTask: boolean;
      hasOut: boolean;
      hasIn: boolean;
      hasInvest: boolean;
    }[] = [];

    for (let i = 0; i < 42; i++) {
      const d = addDays(gridStart, i);
      const dIso = isoDate(d);
      const txInfo = txByDay.get(dIso);
      const hasTask = getTasksForDate(state.tasks, dIso).length > 0;
      cells.push({
        iso: dIso,
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        hasTask,
        hasOut: Boolean(txInfo?.hasOut),
        hasIn: Boolean(txInfo?.hasIn),
        hasInvest: investDateSet.has(dIso),
      });
    }
    return cells;
  }, [calMonth, state.tasks, state.tx, state.investments]);

  const openTasksCount = unifiedEvents.filter((e) => e.kind === 'task' && !e.done).length;
  const recurringCount = unifiedEvents.filter((e) => e.kind === 'recurring').length;

  const horizonTitle =
    horizon === 'today'
      ? selectedIso === todayIso
        ? `Сегодня · ${fmtShortDate(todayIso)}`
        : fmtHumanDate(selectedIso)
      : horizon === 'week'
      ? `Неделя · ${fmtShortDate(rangeDates[0])}–${fmtShortDate(rangeDates[rangeDates.length - 1])}`
      : fmtMonthName(calMonth);

  const kindMeta: Record<UnifiedEvent['kind'], { dot: string; badge: string; dest: string }> = {
    task: { dot: '#1EB4C9', badge: '📅', dest: 'Задачи ↗' },
    expense: { dot: '#F06253', badge: '🛒', dest: 'Расходы ↗' },
    income: { dot: '#19A886', badge: '💰', dest: 'Бюджет ↗' },
    recurring: { dot: '#E5A93B', badge: '🔁', dest: 'Расходы ↗' },
    deposit: { dot: '#E8B44C', badge: '🏛️', dest: 'Пассив ↗' },
    payout: { dot: '#10B981', badge: '📈', dest: 'Пассив ↗' },
  };

  return (
    <div className="hub-wrap max-w-[1560px] mx-auto px-3.5 mt-2">
      <div className="rounded-[20px] bg-[#0D1418]/90 border border-white/[0.09] backdrop-blur-xl px-3.5 py-3 shadow-[0_12px_32px_rgba(0,0,0,0.42)] space-y-2.5">
        {/* Верхняя строка хаба: чистый сегментированный переключатель + минималистичные иконки */}
        <div className="flex items-center justify-between gap-2">
          <div className="inline-flex items-center gap-0.5 p-0.5 rounded-xl bg-black/40 border border-white/[0.07]">
            {(
              [
                ['today', 'Сегодня'],
                ['week', 'Неделя'],
                ['month', 'Месяц'],
              ] as [HubHorizon, string][]
            ).map(([id, lbl]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setHorizon(id);
                  if (id === 'month') setShowCalGrid(true);
                  if (id === 'today') setSelectedIso(todayIso);
                }}
                className={`px-2.5 py-1 rounded-[9px] text-[11.5px] font-bold cursor-pointer transition whitespace-nowrap ${
                  horizon === id
                    ? 'bg-white/[0.14] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setShowCalGrid((v) => !v)}
              className={`h-8 px-2.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 cursor-pointer transition whitespace-nowrap ${
                showCalGrid
                  ? 'bg-white/[0.14] border-white/25 text-white'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-300 hover:bg-white/[0.09]'
              }`}
              title="Показать или скрыть единый календарь"
              aria-label="Единый календарь"
            >
              <CalendarDays className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Календарь</span>
            </button>
            <button
              type="button"
              onClick={() => setShowHelp((v) => !v)}
              className={`w-8 h-8 rounded-xl border flex items-center justify-center cursor-pointer transition ${
                showHelp
                  ? 'bg-emerald-500/20 border-emerald-400/40 text-emerald-300'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-400 hover:text-white'
              }`}
              title="Подсказка по мини-экрану «Сегодня»"
              aria-label="Подсказка"
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="w-8 h-8 rounded-xl bg-white/[0.04] border border-white/[0.08] text-slate-400 hover:text-white flex items-center justify-center cursor-pointer transition"
              title={collapsed ? 'Развернуть сводку дня' : 'Свернуть сводку дня'}
              aria-label="Свернуть или развернуть"
            >
              {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Тихая строка метаданных: дата · лимит в день · счётчик задач (без лишних пилюль) */}
        <div className="flex items-center justify-between gap-2 text-[11.5px] text-slate-400">
          <div className="flex items-center gap-1.5 min-w-0 truncate">
            <span className="font-semibold text-slate-200 capitalize truncate">{horizonTitle}</span>
            {showSafePill && health.left > 0 && (
              <>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => onNavigateToTab('budget')}
                  className="text-emerald-300 font-semibold hover:underline cursor-pointer tabular-nums whitespace-nowrap"
                >
                  {formatMoney(health.safeDaily)}/день
                </button>
              </>
            )}
          </div>
          <span className="tabular-nums shrink-0 text-[11px]">
            Задач: <b className="text-slate-100">{openTasksCount}</b>
            {recurringCount > 0 && (
              <>
                {' · '}Повтор.: <b className="text-amber-300">{recurringCount}</b>
              </>
            )}
          </span>
        </div>

        {showHelp && (
          <div className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2 text-[11.5px] leading-relaxed text-slate-300">
            <div className="font-bold text-emerald-300 mb-0.5">Единый центр дня</div>
            Показывает события выбранного периода: задачи, траты, доходы и запланированные повторяющиеся платежи. Памятка долгов и постоянных расходов из раздела «Семья» сюда не попадает.
          </div>
        )}

        {!collapsed && (
          <>
            {/* Сворачиваемая сетка единого календаря */}
            {showCalGrid && (
              <div className="rounded-2xl bg-black/35 border border-white/[0.07] p-2.5 space-y-1.5">
                <div className="flex items-center justify-between text-xs font-bold text-slate-100">
                  <button
                    type="button"
                    onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}
                    className="w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center cursor-pointer"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="capitalize">{fmtMonthName(calMonth)}</span>
                  <button
                    type="button"
                    onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}
                    className="w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center cursor-pointer"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] text-slate-500 font-semibold">
                  {WEEKDAYS.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {calCells.map((c) => {
                    const isSel = c.iso === selectedIso;
                    const isToday = c.iso === todayIso;
                    return (
                      <button
                        key={c.iso}
                        type="button"
                        onClick={() => {
                          setSelectedIso(c.iso);
                          if (horizon === 'month') setHorizon('today');
                        }}
                        className={`h-8 rounded-lg flex flex-col items-center justify-center text-[11px] font-semibold cursor-pointer transition ${
                          isSel
                            ? 'bg-white/20 text-white ring-1 ring-white/40'
                            : isToday
                            ? 'bg-emerald-500/20 text-emerald-200'
                            : c.inMonth
                            ? 'text-slate-200 hover:bg-white/[0.08]'
                            : 'text-slate-600'
                        }`}
                      >
                        <span className="leading-none tabular-nums">{c.day}</span>
                        <span className="flex items-center gap-0.5 mt-0.5 h-1.5">
                          {c.hasTask && <span className="w-1 h-1 rounded-full bg-[#2AC0D4]" />}
                          {c.hasOut && <span className="w-1 h-1 rounded-full bg-[#E86A54]" />}
                          {c.hasIn && <span className="w-1 h-1 rounded-full bg-[#1FB892]" />}
                          {c.hasInvest && <span className="w-1 h-1 rounded-full bg-[#E8B44C]" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Обобщённая лента событий — клик переводит в нужный блок */}
            {unifiedEvents.length > 0 ? (
              <div className="max-h-32 overflow-y-auto space-y-1.5 pr-0.5">
                {unifiedEvents.slice(0, 12).map((ev) => {
                  const meta = kindMeta[ev.kind];
                  return (
                    <button
                      key={ev.id}
                      type="button"
                      onClick={() => onNavigateToTab(ev.targetTab, ev.targetDate, ev.targetSectionId)}
                      className="w-full text-left flex items-center justify-between gap-2.5 px-3 py-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition cursor-pointer"
                      style={{ opacity: ev.done ? 0.52 : 1 }}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: meta.dot }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className={`text-xs font-semibold text-slate-100 truncate ${ev.done ? 'line-through' : ''}`}>
                          {ev.title}
                        </div>
                        <div className="text-[10.5px] text-slate-400 truncate">
                          {horizon !== 'today' ? `${fmtShortDate(ev.date)} · ` : ''}
                          {ev.subtitle}
                        </div>
                      </div>
                      <div className="text-right shrink-0 flex items-center gap-2">
                        {ev.amount && ev.amount > 0 ? (
                          <span
                            className={`text-xs font-num font-bold ${
                              ev.kind === 'income' ? 'text-emerald-300' : 'text-slate-100'
                            }`}
                          >
                            {ev.kind === 'income' ? '+' : ''}
                            {formatMoney(ev.amount)}
                          </span>
                        ) : null}
                        <span className="text-[10px] font-medium text-slate-500">{meta.dest}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-[11.5px] text-slate-400 py-1">
                На этот период событий нет — добавьте трату, задачу или продиктуйте команду.
              </div>
            )}

            {/* Ближайшие напоминания (Календарь, Вклады, Купоны, Платежи на 14 дней) */}
            {upcomingReminders.length > 0 && (
              <div className="pt-2 border-t border-white/[0.07] space-y-1.5">
                <div className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-amber-300" />
                    <span>Ближайшие напоминания</span>
                  </span>
                  <span className="text-[10.5px] text-slate-400 tabular-nums">
                    {upcomingReminders.length} на 14 дн.
                  </span>
                </div>
                <div className="flex flex-col gap-1 max-h-28 overflow-y-auto pr-0.5">
                  {upcomingReminders.slice(0, 5).map((rem) => {
                    const lead = formatReminderLeadLabel(rem.daysUntil, rem.dateIso);
                    const isUrgent = rem.daysUntil === 0;
                    const isTomorrow = rem.daysUntil === 1;
                    return (
                      <button
                        key={rem.id}
                        type="button"
                        onClick={() =>
                          onNavigateToTab(rem.targetTab, rem.dateIso, rem.targetSectionId)
                        }
                        className="w-full text-left flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] transition cursor-pointer"
                      >
                        <div className="min-w-0 flex items-center gap-2">
                          <span
                            className={`text-[10.5px] font-extrabold shrink-0 tabular-nums ${
                              isUrgent
                                ? 'text-rose-300'
                                : isTomorrow
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                            }`}
                          >
                            {lead}
                          </span>
                          <span className="text-xs font-semibold text-slate-100 truncate">
                            {rem.title}
                          </span>
                        </div>
                        <div className="shrink-0 flex items-center gap-1.5">
                          {rem.amount && rem.amount > 0 ? (
                            <span className="text-[11px] font-num font-bold text-slate-200 tabular-nums">
                              {formatMoney(rem.amount)}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-slate-500">↗</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Чистая строка быстрых действий */}
            <div className="grid grid-cols-3 gap-2 pt-0.5">
              <button
                type="button"
                onClick={onOpenUniversalVoice}
                className="h-9 px-2.5 rounded-xl text-xs font-bold text-white flex items-center justify-center gap-1.5 cursor-pointer transition active:scale-95 bg-gradient-to-r from-[#6F5DE0]/75 to-[#219EB5]/75 border border-white/15 hover:brightness-110"
              >
                <Mic className="w-3.5 h-3.5 shrink-0" />
                <span>Команда</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('expenses', undefined, 'sec-exp-add')}
                className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-semibold text-slate-100 flex items-center justify-center gap-1 cursor-pointer transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 shrink-0 text-[#E86A54]" />
                <span>Трата</span>
              </button>
              <button
                type="button"
                onClick={() => onNavigateToTab('planner', selectedIso, 'sec-planner-cal')}
                className="h-9 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-xs font-semibold text-slate-100 flex items-center justify-center gap-1 cursor-pointer transition active:scale-95"
              >
                <Plus className="w-3.5 h-3.5 shrink-0 text-[#2AC0D4]" />
                <span>Задача</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
