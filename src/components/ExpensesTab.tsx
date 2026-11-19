import React, { useMemo, useRef, useState } from 'react';
import { Camera, Mic, Pencil, Search, Trash2, X } from 'lucide-react';
import { CategoryTuple, PeriodMode, RepeatFreq, Transaction } from '../types';
import {
  CAT_ICON,
  fmtShortDate,
  formatMoney,
  isTaxDeductible,
  ParsedExpenseItem,
  parseNum,
  parsePhrase,
  uid,
} from '../utils/finance';
import { isoDate, normDate } from '../utils/storage';
import GlassSection from './GlassSection';

interface ExpensesTabProps {
  cats: CategoryTuple[];
  curDate: Date;
  viewMode: PeriodMode;
  periodOutTx: Transaction[];
  collapsedSecs: string[];
  onToggleSec: (id: string) => void;
  onSaveExpenses: (items: Transaction[], jumpDate: string) => void;
  onDeleteTx: (id: number) => void;
  onEditTx: (tx: Transaction) => void;
  onStopRepeat: (id: number) => void;
  onOpenCategories: () => void;
  onOpenReceipt: (tx: Transaction) => void;
  onOpenBreakdown: () => void;
  onOpenCategoryBreakdown: (cat: string) => void;
  onOpenDayBreakdown: (dayIso: string) => void;
}

export default function ExpensesTab({
  cats,
  curDate,
  viewMode,
  periodOutTx,
  collapsedSecs,
  onToggleSec,
  onSaveExpenses,
  onDeleteTx,
  onEditTx,
  onStopRepeat,
  onOpenCategories,
  onOpenReceipt,
  onOpenBreakdown,
  onOpenCategoryBreakdown,
  onOpenDayBreakdown,
}: ExpensesTabProps) {
  const [sayText, setSayText] = useState('');
  const [hint, setHint] = useState('');
  const [previewItems, setPreviewItems] = useState<ParsedExpenseItem[] | null>(null);
  const [previewDate, setPreviewDate] = useState(() => isoDate(curDate));
  const [previewMethod, setPreviewMethod] = useState('Карта');
  const [previewRepeat, setPreviewRepeat] = useState<RepeatFreq>('none');
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const recRef = useRef<{ stop: () => void } | null>(null);

  const runParse = (inputStr?: string) => {
    const raw = (inputStr ?? sayText).trim();
    if (!raw) {
      setHint('Скажите или напишите, что купили и сколько стоило.');
      return;
    }
    const r = parsePhrase(raw, cats, curDate);
    setPreviewItems(r.items);
    setPreviewDate(r.date);
    setPreviewMethod(r.method);
    const miss = r.items.some((x) => !(x.a > 0));
    setHint(
      miss
        ? 'Не нашёл сумму у части покупок. Впишите её ниже.'
        : `Проверьте дату (${fmtShortDate(r.date)}) и нажмите Сохранить.`
    );
  };

  const handleVoicePhrase = () => {
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
        onerror: (() => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setHint('Голосовой ввод недоступен. Введите текст и нажмите «Разобрать».');
      return;
    }
    if (listening && recRef.current) {
      recRef.current.stop();
      setListening(false);
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      let latest = '';
      rec.onresult = (e) => {
        let s = '';
        for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript;
        latest = s;
        setSayText(s);
      };
      rec.onerror = () => {
        setListening(false);
        setHint('Не удалось распознать речь. Введите текстом.');
      };
      rec.onend = () => {
        setListening(false);
        if (latest.trim()) runParse(latest);
      };
      setSayText('');
      setHint('Слушаю…');
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  };

  const handleReceiptPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = typeof ev.target?.result === 'string' ? ev.target.result : '';
      if (!src) return;
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const max = 700;
        let w = img.width;
        let h = img.height;
        if (w > max) {
          h = Math.round((h * max) / w);
          w = max;
        }
        c.width = w;
        c.height = h;
        c.getContext('2d')?.drawImage(img, 0, 0, w, h);
        setPendingImg(c.toDataURL('image/jpeg', 0.62));
        setPreviewDate(isoDate(curDate));
        setPreviewMethod('Карта');
        setPreviewItems([{ a: 0, n: 'Чек из магазина', c: 'Еда' }]);
        setHint('📷 Фото чека прикреплено! Укажите сумму и сохраните.');
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmSave = () => {
    if (!previewItems) return;
    const valid = previewItems.filter((x) => x.a > 0);
    if (!valid.length) {
      setHint('Введите сумму больше нуля.');
      return;
    }
    const d = normDate(previewDate || isoDate(curDate));
    const baseId = uid();
    const newTxs: Transaction[] = valid.map((x, idx) => ({
      id: baseId + idx,
      t: 'out',
      a: x.a,
      c: x.c,
      m: previewMethod,
      d,
      n: x.n || x.c,
      repeat: previewRepeat,
      img: idx === 0 ? pendingImg : null,
    }));
    onSaveExpenses(newTxs, d);
    setPreviewItems(null);
    setSayText('');
    setPendingImg(null);
    setPreviewRepeat('none');
    setHint(`Трата сохранена за ${fmtShortDate(d)}!`);
  };

  const catColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    cats.forEach((c) => (m[c[0]] = c[1]));
    return m;
  }, [cats]);

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return periodOutTx;
    return periodOutTx.filter((t) => `${t.n} ${t.c} ${t.m}`.toLowerCase().includes(q));
  }, [periodOutTx, searchQuery]);

  const { donutBg, topCatLabel, catRows } = useMemo(() => {
    const sumOut = periodOutTx.reduce((acc, t) => acc + t.a, 0);
    const bc: Record<string, number> = {};
    periodOutTx.forEach((t) => (bc[t.c] = (bc[t.c] || 0) + t.a));
    const maxVal = Math.max(1, ...Object.values(bc));
    const active = sumOut > 0 ? cats.filter((c) => bc[c[0]]) : cats.slice(0, 4);
    const grad: string[] = [];
    let accDeg = 0;

    const rows = active.map((c) => {
      const val = bc[c[0]] || 0;
      const pct = sumOut > 0 ? Math.round((val / sumOut) * 100) : 0;
      const deg = sumOut > 0 ? (val / sumOut) * 360 : 0;
      if (deg > 0) {
        grad.push(`${c[1]} ${accDeg}deg ${accDeg + deg}deg`);
        accDeg += deg;
      }
      return { name: c[0], color: c[1], val, pct, widthPct: sumOut > 0 ? (val / maxVal) * 100 : 0 };
    });

    const topName = Object.keys(bc).sort((a, b) => bc[b] - bc[a])[0];
    const topLabel =
      sumOut > 0 && topName
        ? `${topName.length > 10 ? `${topName.slice(0, 9)}…` : topName}\n${Math.round((bc[topName] / sumOut) * 100)}%`
        : 'Нет трат\n0%';

    return {
      donutBg: grad.length ? `conic-gradient(${grad.join(',')})` : 'conic-gradient(#1D2B30 0deg 360deg)',
      topCatLabel: topLabel,
      catRows: rows,
    };
  }, [periodOutTx, cats]);

  const dayBars = useMemo(() => {
    const byDay: Record<string, number> = {};
    periodOutTx.forEach((t) => (byDay[t.d] = (byDay[t.d] || 0) + t.a));
    const now = new Date();
    const baseD =
      viewMode === 'month' &&
      curDate.getMonth() === now.getMonth() &&
      curDate.getFullYear() === now.getFullYear()
        ? now
        : curDate;

    const slots: { lbl: string; iso: string; val: number }[] = [];
    for (let k = 13; k >= 0; k--) {
      const tmp = new Date(baseD.getFullYear(), baseD.getMonth(), baseD.getDate() - k);
      const dIso = isoDate(tmp);
      slots.push({ lbl: String(tmp.getDate()).padStart(2, '0'), iso: dIso, val: byDay[dIso] || 0 });
    }
    const maxDay = Math.max(1, ...slots.map((s) => s.val));
    return slots.map((s) => ({
      ...s,
      heightPct: s.val > 0 ? Math.max(12, Math.round((s.val / maxDay) * 100)) : 6,
    }));
  }, [periodOutTx, curDate, viewMode]);

  return (
    <>

      <GlassSection
        id="sec-exp-add"
        title="Записать траты"
        helpText="Быстро фиксируйте траты голосом (можно перечислить несколько покупок сразу, например «молоко 120, хлеб 60»), фото чека или текстом. Можно задать автоповтор для постоянных платежей."
        rightExtra={
          <button
            type="button"
            onClick={onOpenCategories}
            className="fin-btn ghost sm"
            style={{ padding: '3px 8px', fontSize: '.72rem' }}
          >
            ⚙ Категории
          </button>
        }
        collapsed={collapsedSecs.includes('sec-exp-add')}
        onToggleCollapse={onToggleSec}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={handleVoicePhrase} className="mic-tile">
            <span className={`mic-orb ${listening ? 'rec' : ''}`}>
              <Mic className="w-7 h-7" />
            </span>
            <span>{listening ? 'Стоп' : 'Говорить'}</span>
          </button>

          <label className="cam-tile">
            <span className="w-13 h-13 rounded-2xl bg-white/8 border border-white/15 flex items-center justify-center">
              <Camera className="w-6 h-6" />
            </span>
            <span>Снять чек / QR</span>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleReceiptPhoto(f);
                e.target.value = '';
              }}
            />
          </label>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runParse();
          }}
          className="flex gap-1.5"
        >
          <input
            className="fin-input flex-1"
            value={sayText}
            onChange={(e) => setSayText(e.target.value)}
            placeholder="Например: кило картошки, 400 рублей"
          />
          <button type="submit" className="fin-btn">
            Разобрать
          </button>
        </form>

        {hint && <div className="fin-sub">{hint}</div>}

        {previewItems && (
          <div className="space-y-2 pt-2 border-t border-[var(--line)]">
            <div className="grid grid-cols-2 gap-2">
              <label className="fin-sub block">
                Дата траты
                <input
                  type="date"
                  className="fin-input w-full mt-1 tabular-nums"
                  value={previewDate}
                  onChange={(e) => setPreviewDate(e.target.value)}
                />
              </label>
              <label className="fin-sub block">
                Чем оплачено
                <select
                  className="fin-select w-full mt-1"
                  value={previewMethod}
                  onChange={(e) => setPreviewMethod(e.target.value)}
                >
                  <option>Карта</option>
                  <option>Наличка</option>
                  <option>Кредит / Ипотека</option>
                </select>
              </label>
            </div>

            <label className="fin-sub block">
              Повтор
              <select
                className="fin-select w-full mt-1"
                value={previewRepeat}
                onChange={(e) => setPreviewRepeat(e.target.value as RepeatFreq)}
              >
                <option value="none">Один раз</option>
                <option value="monthly">Каждый месяц</option>
                <option value="yearly">Каждый год</option>
                <option value="weekly">Каждую неделю</option>
              </select>
            </label>

            {pendingImg && (
              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
                <img src={pendingImg} alt="Чек" className="w-9 h-11 object-cover rounded-md" />
                <span className="fin-sub flex-1">📷 Фото чека прикреплено</span>
                <button
                  type="button"
                  onClick={() => setPendingImg(null)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {previewItems.map((it, idx) => (
              <div key={idx} className="space-y-1.5 pt-2 border-t border-[var(--line)]">
                <input
                  className="fin-input w-full"
                  value={it.n}
                  onChange={(e) => {
                    const next = [...previewItems];
                    next[idx] = { ...next[idx], n: e.target.value };
                    setPreviewItems(next);
                  }}
                  placeholder="Что купили"
                />
                <div className="flex gap-1.5">
                  <input
                    className="fin-input w-24 tabular-nums"
                    inputMode="decimal"
                    value={it.a > 0 ? String(it.a) : ''}
                    onChange={(e) => {
                      const next = [...previewItems];
                      next[idx] = { ...next[idx], a: parseNum(e.target.value) };
                      setPreviewItems(next);
                    }}
                    placeholder="Сумма"
                  />
                  <select
                    className="fin-select flex-1"
                    value={it.c}
                    onChange={(e) => {
                      const next = [...previewItems];
                      next[idx] = { ...next[idx], c: e.target.value };
                      setPreviewItems(next);
                    }}
                  >
                    {cats.map((c) => (
                      <option key={c[0]} value={c[0]}>
                        {c[0]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <button type="button" onClick={handleConfirmSave} className="fin-btn flex-1">
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewItems(null);
                  setPendingImg(null);
                }}
                className="fin-btn ghost"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </GlassSection>

      <GlassSection
        id="sec-exp-list"
        title={`Последние траты ${periodOutTx.length ? `(${periodOutTx.length})` : ''}`}
        helpText="История всех ваших расходов за выбранный период с быстрым поиском, просмотром фото чеков и остановкой автоповторов."
        rightExtra={
          <button
            type="button"
            onClick={onOpenBreakdown}
            className="fin-btn ghost sm"
            style={{ padding: '3px 8px', fontSize: '.72rem' }}
          >
            Все ↗
          </button>
        }
        collapsed={collapsedSecs.includes('sec-exp-list')}
        onToggleCollapse={onToggleSec}
      >
        {periodOutTx.length > 3 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="fin-input w-full pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по тратам..."
            />
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
          {filteredList.length === 0 ? (
            <div className="fin-sub py-2">За выбранный период трат нет.</div>
          ) : (
            filteredList.map((t) => {
              const isRec = t.repeat && t.repeat !== 'none';
              const taxType = isTaxDeductible(t);
              const color = catColorMap[t.c] || '#6B827E';
              return (
                <div key={t.id} className="tx-tile">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 shadow"
                      style={{ background: color }}
                    >
                      {CAT_ICON[t.c] || '🏷️'}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-sm truncate flex items-center gap-1 flex-wrap">
                        <span>{t.n || t.c}</span>
                        {isRec && <span title="Регулярный">🔄</span>}
                        {taxType && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                            +13%
                          </span>
                        )}
                        {t.img && (
                          <button
                            type="button"
                            onClick={() => onOpenReceipt(t)}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-slate-200 cursor-pointer"
                          >
                            🧾 Чек
                          </button>
                        )}
                      </div>
                      <div className="fin-sub tabular-nums truncate">
                        {fmtShortDate(t.d)} · {t.c} · {t.m}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <b className="text-[var(--warn)] tabular-nums mr-1">−{formatMoney(t.a)}</b>
                    {isRec && (
                      <button
                        type="button"
                        onClick={() => onStopRepeat(t.id)}
                        className="p-1 text-amber-400 cursor-pointer"
                        title="Остановить повтор"
                      >
                        ⏹
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onEditTx(t)}
                      className="p-1 text-slate-400 hover:text-emerald-300 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteTx(t.id)}
                      className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </GlassSection>

      <GlassSection
        id="sec-charts"
        title="Куда уходят деньги"
        helpText="Наглядная структура расходов по категориям и график трат за последние 14 дней. Нажмите на любую категорию или столбик дня, чтобы открыть подробный список операций."
        collapsed={collapsedSecs.includes('sec-charts')}
        onToggleCollapse={onToggleSec}
      >
        <div className="grid grid-cols-[112px_1fr] gap-3 items-center">
          <div
            className="w-28 h-28 rounded-full relative flex items-center justify-center shadow-lg"
            style={{ background: donutBg }}
          >
            <div className="w-[74px] h-[74px] rounded-full bg-[#0E161A] flex items-center justify-center text-center text-[11px] font-extrabold text-white whitespace-pre-line leading-tight px-1">
              {topCatLabel}
            </div>
          </div>

          <div className="space-y-1.5 min-w-0">
            {catRows.map((row) => (
              <button
                key={row.name}
                type="button"
                onClick={() => onOpenCategoryBreakdown(row.name)}
                className="w-full grid grid-cols-[78px_1fr_34px] items-center gap-1.5 text-xs hover:bg-white/5 px-1 py-0.5 rounded-lg cursor-pointer text-left"
              >
                <span className="truncate">{row.name}</span>
                <span className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${row.widthPct}%`, backgroundColor: row.color }}
                  />
                </span>
                <b className="text-right tabular-nums">{row.pct}%</b>
              </button>
            ))}
          </div>
        </div>

        <div className="fin-sub font-bold mt-2">Динамика по дням</div>
        <div className="grid grid-cols-14 gap-1 h-20 p-2 rounded-2xl bg-[var(--fld)] border border-[var(--line)] items-end">
          {dayBars.map((b) => (
            <button
              key={b.iso}
              type="button"
              onClick={() => onOpenDayBreakdown(b.iso)}
              title={`${b.lbl} число: ${formatMoney(b.val)}`}
              className="flex flex-col items-center gap-1 h-full justify-end cursor-pointer"
            >
              <div className="w-full max-w-[9px] flex-1 bg-white/8 rounded-full flex items-end overflow-hidden">
                <div
                  className="w-full rounded-full bg-gradient-to-b from-[#F47265] to-[#C63B2F]"
                  style={{ height: `${b.heightPct}%`, opacity: b.val > 0 ? 1 : 0.25 }}
                />
              </div>
              <span className="text-[9px] text-[var(--mute)] tabular-nums">{b.lbl}</span>
            </button>
          ))}
        </div>
      </GlassSection>
    </>
  );
}
