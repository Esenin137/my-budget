import React, { useEffect, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { AppState, GoalScope, Transaction } from '../types';
import {
  buildXlsxBlob,
  fmtShortDate,
  formatMoney,
  INC_CAT_LIST,
  isTxInPeriod,
  parseNum,
  uid,
} from '../utils/finance';
import { encryptPayload, isoDate, normDate } from '../utils/storage';
import GlassSection from './GlassSection';

interface BudgetTabProps {
  state: AppState;
  curDate: Date;
  periodInTx: Transaction[];
  sumIn: number;
  sumOut: number;
  left: number;
  safeDaily: number;
  showSummaryStrip: boolean;
  showSafePill: boolean;
  activePin: string | null;
  collapsedSecs: string[];
  onToggleSec: (id: string) => void;
  onOpenSummaryBreakdown: (kind: 'in' | 'out' | 'left') => void;
  onAddIncome: (tx: Transaction) => void;
  onDeleteTx: (id: number) => void;
  onEditTx: (tx: Transaction) => void;
  onUpdateGoals: (scope: GoalScope, limit: number, target: number) => void;
  onOpenPinManager: () => void;
  onImportJsonFile: (file: File, passHint: string) => void;
  onShowToast: (msg: string) => void;
}

export default function BudgetTab({
  state,
  curDate,
  periodInTx,
  sumIn,
  sumOut,
  left,
  safeDaily,
  showSummaryStrip,
  showSafePill,
  activePin,
  collapsedSecs,
  onToggleSec,
  onOpenSummaryBreakdown,
  onAddIncome,
  onDeleteTx,
  onEditTx,
  onUpdateGoals,
  onOpenPinManager,
  onImportJsonFile,
  onShowToast,
}: BudgetTabProps) {
  const [incName, setIncName] = useState('');
  const [incAmt, setIncAmt] = useState('');
  const [incCat, setIncCat] = useState(INC_CAT_LIST[0]);
  const [incDate, setIncDate] = useState(() => isoDate(curDate));

  const [goalScope, setGoalScope] = useState<GoalScope>('month');
  const currentGoal = state.periodGoals[goalScope] || { limit: 0, target: 0 };
  const [limitInp, setLimitInp] = useState(currentGoal.limit ? String(currentGoal.limit) : '');
  const [targetInp, setTargetInp] = useState(currentGoal.target ? String(currentGoal.target) : '');

  const [backupPass, setBackupPass] = useState('');

  useEffect(() => {
    setLimitInp(currentGoal.limit ? String(currentGoal.limit) : '');
    setTargetInp(currentGoal.target ? String(currentGoal.target) : '');
  }, [goalScope, currentGoal.limit, currentGoal.target]);

  useEffect(() => {
    if (!incName && !incAmt) {
      setIncDate(isoDate(curDate));
    }
  }, [curDate, incName, incAmt]);

  const handleScopeSwitch = (sc: GoalScope) => {
    setGoalScope(sc);
  };

  const goalPeriodTx = state.tx.filter((t) => isTxInPeriod(t.d, goalScope, curDate));
  const goalSpent = goalPeriodTx.filter((t) => t.t !== 'in').reduce((a, t) => a + t.a, 0);
  const goalEarned = goalPeriodTx.filter((t) => t.t === 'in').reduce((a, t) => a + t.a, 0);
  const goalSavedNow = Math.max(0, goalEarned - goalSpent);

  const lim = currentGoal.limit || 0;
  const limPct = lim > 0 ? Math.round((goalSpent / lim) * 100) : 0;
  const limFill = lim > 0 ? Math.min(100, Math.max(0, limPct)) : 0;

  const trg = currentGoal.target || 0;
  const savPct = trg > 0 ? Math.round((goalSavedNow / trg) * 100) : 0;
  const savFill = trg > 0 ? Math.min(100, Math.max(0, savPct)) : 0;

  const scopeLabels: Record<GoalScope, string> = {
    week: 'за неделю',
    month: 'за месяц',
    year: 'за год',
  };

  const handleAddIncomeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const a = parseNum(incAmt);
    if (!(a > 0)) {
      onShowToast('Введите сумму дохода больше нуля.');
      return;
    }
    const d = normDate(incDate || isoDate(curDate));
    onAddIncome({
      id: uid(),
      t: 'in',
      a,
      c: incCat,
      m: 'Доход',
      d,
      n: incName.trim() || incCat,
    });
    setIncName('');
    setIncAmt('');
  };

  const handleSaveGoal = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdateGoals(goalScope, parseNum(limitInp), parseNum(targetInp));
    onShowToast(`Цель и лимит ${scopeLabels[goalScope]} сохранены!`);
  };

  const handleExportEncrypted = async (share: boolean) => {
    const pass = backupPass.trim() || activePin;
    if (!pass) {
      onShowToast('Укажите пароль в поле ниже (или задайте ПИН-код).');
      return;
    }
    try {
      const pkg = await encryptPayload(state, pass);
      const fileName = `moi-finansy-protected-${isoDate(new Date())}.json`;
      const blob = new Blob([JSON.stringify(pkg)], { type: 'application/json' });
      if (share && navigator.canShare) {
        const file = new File([blob], fileName, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({
            title: 'Мои финансы — Зашифрованная копия',
            text: 'Резервная копия бюджета (защищена паролем AES-256)',
            files: [file],
          });
          onShowToast('📤 Зашифрованная копия отправлена!');
          return;
        }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      onShowToast('🔒 Зашифрованная копия сохранена.');
    } catch {
      onShowToast('Не удалось создать копию.');
    }
  };

  const handleExportXlsx = () => {
    if (!state.tx.length) {
      onShowToast('Пока нечего скачивать: записей нет.');
      return;
    }
    const blob = buildXlsxBlob(state.tx);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `moi-traty-${isoDate(new Date())}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    onShowToast('Файл Excel сохранён.');
  };

  const handleExportPlainJson = () => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `moi-traty-backup-${isoDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    onShowToast('Копия JSON сохранена.');
  };

  return (
    <>

      {showSummaryStrip && (
        <div className="summary-strip">
          <button
            type="button"
            className="sum-card card-inc"
            onClick={() => onOpenSummaryBreakdown('in')}
          >
            <div>
              <div className="lbl">Доходы (Бюджет):</div>
              <div className="val tabular-nums">{formatMoney(sumIn)}</div>
            </div>
            {showSafePill && (
              <div className="safe-pill tabular-nums">
                {left > 0
                  ? `⏱ Безопасно в день: ${formatMoney(safeDaily)}`
                  : sumIn > 0
                  ? '⚠️ Лимит исчерпан'
                  : '⏱ Нажмите для деталей'}
              </div>
            )}
          </button>

          <button
            type="button"
            className="sum-card card-out"
            onClick={() => onOpenSummaryBreakdown('out')}
          >
            <div className="lbl">Расходы:</div>
            <div className="val tabular-nums">{formatMoney(sumOut)}</div>
          </button>

          <button
            type="button"
            className="sum-card card-left"
            onClick={() => onOpenSummaryBreakdown('left')}
          >
            <div className="lbl">Свободный остаток:</div>
            <div className="val tabular-nums">{formatMoney(left)}</div>
          </button>
        </div>
      )}

      <GlassSection
        id="sec-inc-add"
        title="💰 Записать доход"
        helpText="Фиксируйте зарплату, аванс, подработку или проценты по вкладам. Эти суммы формируют общий бюджет и автоматически рассчитывают ваш безопасный дневной лимит."
        collapsed={collapsedSecs.includes('sec-inc-add')}
        onToggleCollapse={onToggleSec}
      >
        <form onSubmit={handleAddIncomeSubmit} className="space-y-2">
          <div className="flex gap-1.5 flex-wrap">
            <input
              className="fin-input flex-1"
              value={incName}
              onChange={(e) => setIncName(e.target.value)}
              placeholder="Зарплата / Аванс"
            />
            <input
              className="fin-input w-24 tabular-nums"
              inputMode="decimal"
              value={incAmt}
              onChange={(e) => setIncAmt(e.target.value)}
              placeholder="Сумма, ₽"
            />
            <button type="submit" className="fin-btn">
              + Доход
            </button>
          </div>
          <div className="flex gap-1.5">
            <select
              className="fin-select flex-1"
              value={incCat}
              onChange={(e) => setIncCat(e.target.value)}
            >
              {INC_CAT_LIST.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="fin-input w-32 tabular-nums"
              value={incDate}
              onChange={(e) => setIncDate(e.target.value)}
            />
          </div>
        </form>
      </GlassSection>

      <GlassSection
        id="sec-inc-list"
        title="Доходы за период"
        helpText="Полный список всех поступлений за выбранный период. Нажмите на карандаш, чтобы отредактировать сумму или дату."
        rightExtra={periodInTx.length ? <span className="fin-sub">({periodInTx.length})</span> : null}
        collapsed={collapsedSecs.includes('sec-inc-list')}
        onToggleCollapse={onToggleSec}
      >
        <div className="max-h-56 overflow-y-auto space-y-1.5 pr-0.5">
          {periodInTx.length === 0 ? (
            <div className="fin-sub py-1">Доходы за этот период ещё не внесены.</div>
          ) : (
            periodInTx.map((t) => (
              <div key={t.id} className="tx-tile">
                <div className="min-w-0">
                  <div className="truncate">
                    <b className="text-emerald-400 tabular-nums">+{formatMoney(t.a)}</b>{' '}
                    <b>{t.n || t.c}</b>
                  </div>
                  <div className="fin-sub tabular-nums">
                    {fmtShortDate(t.d)} · {t.c}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onEditTx(t)}
                    className="p-1.5 text-slate-400 hover:text-emerald-300 cursor-pointer"
                    title="Изменить"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteTx(t.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer"
                    title="Удалить"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </GlassSection>

      <GlassSection
        id="sec-goals-tank"
        title="🎯 Цель и Лимит: Неделя / Месяц / Год"
        helpText="Наглядные резервуары показывают, сколько вы уже потратили относительно лимита и насколько близки к цели накопления на неделю, месяц или год."
        collapsed={collapsedSecs.includes('sec-goals-tank')}
        onToggleCollapse={onToggleSec}
      >
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
          {(['week', 'month', 'year'] as GoalScope[]).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => handleScopeSwitch(sc)}
              className={`py-1.5 rounded-lg text-xs font-bold cursor-pointer transition ${
                goalScope === sc
                  ? 'bg-[var(--acc)] text-white shadow'
                  : 'text-[var(--mute)] hover:text-white'
              }`}
            >
              {sc === 'week' ? 'Неделя' : sc === 'month' ? 'Месяц' : 'Год'}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-2.5">
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-2.5 flex items-center gap-3">
            <div className="tank-jar">
              <div
                className={`tank-fill ${limPct >= 100 ? 'over' : limPct >= 80 ? 'warn' : ''}`}
                style={{ height: `${limFill}%` }}
              />
              <div className="absolute inset-0 flex items-center justify-center font-extrabold text-xs text-white drop-shadow tabular-nums">
                {lim > 0 ? `${limPct}%` : '—'}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs font-extrabold">
                <span>🛑 Лимит трат</span>
                <span className="fin-sub">{scopeLabels[goalScope]}</span>
              </div>
              <div className="fin-sub tabular-nums mt-0.5">
                Потрачено: {formatMoney(goalSpent)}
                {lim > 0 ? ` из ${formatMoney(lim)}` : ''}
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden my-1.5">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${limFill}%`,
                    background:
                      limPct >= 100 ? 'var(--warn)' : limPct >= 80 ? 'var(--gold)' : 'var(--acc)',
                  }}
                />
              </div>
              <div className="fin-sub tabular-nums">
                {lim > 0 ? (
                  goalSpent <= lim ? (
                    <span>
                      Можно тратить ещё:{' '}
                      <b className="text-emerald-400">{formatMoney(lim - goalSpent)}</b>
                    </span>
                  ) : (
                    <span>
                      Превышение на{' '}
                      <b className="text-rose-400">{formatMoney(goalSpent - lim)}</b>
                    </span>
                  )
                ) : (
                  'Задайте лимит ниже'
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-2.5 flex items-center gap-3">
            <div className="tank-jar">
              <div className="tank-fill" style={{ height: `${savFill}%` }} />
              <div className="absolute inset-0 flex items-center justify-center font-extrabold text-xs text-white drop-shadow tabular-nums">
                {trg > 0 ? `${savPct}%` : '—'}
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between text-xs font-extrabold">
                <span>💧 Цель накопить</span>
                <span className="fin-sub">{scopeLabels[goalScope]}</span>
              </div>
              <div className="fin-sub tabular-nums mt-0.5">
                Накоплено: {formatMoney(goalSavedNow)}
                {trg > 0 ? ` из ${formatMoney(trg)}` : ''}
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden my-1.5">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{ width: `${savFill}%` }}
                />
              </div>
              <div className="fin-sub tabular-nums">
                {trg > 0 ? (
                  goalSavedNow >= trg ? (
                    <b className="text-emerald-400">🎉 Цель достигнута!</b>
                  ) : (
                    <span>
                      До цели: <b>{formatMoney(trg - goalSavedNow)}</b>
                    </span>
                  )
                ) : (
                  'Задайте цель ниже'
                )}
              </div>
            </div>
          </div>
        </div>

        <details className="rounded-xl bg-[var(--fld)] border border-[var(--line)] p-2.5">
          <summary className="cursor-pointer font-bold text-xs text-[var(--acc)]">
            ⚙ Настроить лимит трат и цель накопления
          </summary>
          <form onSubmit={handleSaveGoal} className="space-y-2 mt-2.5">
            <div className="grid grid-cols-2 gap-2">
              <label className="fin-sub block">
                Лимит, ₽
                <input
                  className="fin-input w-full mt-1 tabular-nums"
                  inputMode="decimal"
                  value={limitInp}
                  onChange={(e) => setLimitInp(e.target.value)}
                  placeholder="45000"
                />
              </label>
              <label className="fin-sub block">
                Цель, ₽
                <input
                  className="fin-input w-full mt-1 tabular-nums"
                  inputMode="decimal"
                  value={targetInp}
                  onChange={(e) => setTargetInp(e.target.value)}
                  placeholder="15000"
                />
              </label>
            </div>
            <button type="submit" className="fin-btn sm w-full">
              💾 Сохранить цель и лимит
            </button>
          </form>
        </details>
      </GlassSection>

      <GlassSection
        id="sec-security"
        title="🛡️ Безопасность и резервные копии"
        helpText="Защитите базу ПИН-кодом (шифрование AES-256 прямо на устройстве), выгружайте таблицы в Excel (.xlsx) или сохраняйте зашифрованные резервные копии."
        collapsed={collapsedSecs.includes('sec-security')}
        onToggleCollapse={onToggleSec}
      >
        <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-emerald-500/12 border border-emerald-400/25 text-xs">
          <span>{activePin ? '🔒 База зашифрована (AES-GCM)' : '🔓 ПИН-код не задан'}</span>
          <button type="button" onClick={onOpenPinManager} className="fin-btn sm">
            {activePin ? 'ПИН' : 'Задать ПИН'}
          </button>
        </div>

        <div className="flex gap-1.5">
          <input
            type="password"
            className="fin-input flex-1"
            value={backupPass}
            onChange={(e) => setBackupPass(e.target.value)}
            placeholder="Пароль для защиты копии"
          />
          <button type="button" onClick={() => handleExportEncrypted(true)} className="fin-btn sm">
            📤 Отправить
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          <button type="button" onClick={() => handleExportEncrypted(false)} className="fin-btn ghost sm">
            🔒 Скачать с паролем
          </button>
          <label className="fin-btn ghost sm text-center cursor-pointer">
            📂 Восстановить
            <input
              type="file"
              accept=".json,.enc,application/json,text/plain"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onImportJsonFile(f, backupPass.trim());
                e.target.value = '';
              }}
            />
          </label>
          <button type="button" onClick={handleExportXlsx} className="fin-btn sm">
            📊 Excel (.xlsx)
          </button>
          <button type="button" onClick={handleExportPlainJson} className="fin-btn ghost sm">
            💾 JSON
          </button>
        </div>
      </GlassSection>
    </>
  );
}
