import { AppState, CalendarTask, CategoryTuple, HabitItem, PeriodMode, TaskRepeatFreq, Transaction } from '../types';
import { isoDate, normDate } from './storage';
import { analyzeInvestments, getAssetTotalValue, getBrokerLabel } from './investments';

export const INC_CAT_LIST = [
  'Зарплата',
  'Аванс',
  'Подработка',
  'Пенсия',
  'Налоговый вычет 13%',
  'Проценты по вкладу',
  'Иной доход',
];

export const CAT_ICON: Record<string, string> = {
  Еда: '🛒',
  'Кредиты и Ипотека': '🏠',
  Дом: '🏡',
  Транспорт: '🚗',
  Вещи: '👕',
  Дети: '🧒',
  Здоровье: '💊',
  Досуг: '🎟️',
  Вклады: '🏦',
  Другое: '📦',
};

export function uid(): number {
  return Date.now() + Math.floor(Math.random() * 10000);
}

export function parseNum(x: unknown): number {
  let t = String(x ?? '').replace(/\s/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) t = t.replace(/[.,]/g, '');
  else t = t.replace(',', '.');
  return parseFloat(t) || 0;
}

export function formatMoney(n: number): string {
  return (
    new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(
      Math.round((n || 0) * 100) / 100
    ) + ' ₽'
  );
}

export function fmtHumanDate(isoStr: string): string {
  const p = normDate(isoStr).split('-');
  const dt = new Date(+p[0], +p[1] - 1, +p[2]);
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtShortDate(isoStr: string): string {
  const d = normDate(isoStr);
  return `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

export function fmtMonthName(dt: Date): string {
  const mStr = dt
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
    .replace(/\s*г\.?$/, '');
  return mStr.charAt(0).toUpperCase() + mStr.slice(1);
}

export function parseLocalIsoDate(isoStr: string): Date | null {
  const m = normDate(isoStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(y, mo, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

export function advanceRepeatDate(
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

export function getWeekBounds(dt: Date): { start: string; end: string; mon: Date; sun: Date } {
  const d = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(d.getFullYear(), d.getMonth(), diff);
  const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
  return { start: isoDate(mon), end: isoDate(sun), mon, sun };
}

export function isTxInPeriod(
  tDateStr: string,
  mode: PeriodMode,
  refDate: Date,
  customStart?: string,
  customEnd?: string
): boolean {
  const d = normDate(tDateStr);
  if (mode === 'day') return d === isoDate(refDate);
  if (mode === 'week') {
    const wb = getWeekBounds(refDate);
    return d >= wb.start && d <= wb.end;
  }
  if (mode === 'month') return d.slice(0, 7) === isoDate(refDate).slice(0, 7);
  if (mode === 'year') return d.slice(0, 4) === String(refDate.getFullYear());
  if (mode === 'custom') {
    let s = normDate(customStart || isoDate(refDate));
    let e = normDate(customEnd || isoDate(refDate));
    if (s > e) [s, e] = [e, s];
    return d >= s && d <= e;
  }
  return d.slice(0, 7) === isoDate(refDate).slice(0, 7);
}

export function getPeriodTitle(
  mode: PeriodMode,
  refDate: Date,
  customStart?: string,
  customEnd?: string
): string {
  if (mode === 'day') return fmtHumanDate(isoDate(refDate));
  if (mode === 'week') {
    const wb = getWeekBounds(refDate);
    return `${wb.start.slice(8)}.${wb.start.slice(5, 7)} — ${wb.end.slice(8)}.${wb.end.slice(5, 7)}.${wb.end.slice(0, 4)}`;
  }
  if (mode === 'month') return fmtMonthName(refDate);
  if (mode === 'year') return `${refDate.getFullYear()} год`;
  if (mode === 'custom') {
    const s = normDate(customStart || isoDate(refDate));
    const e = normDate(customEnd || isoDate(refDate));
    return `${s.slice(8)}.${s.slice(5, 7)} — ${e.slice(8)}.${e.slice(5, 7)}.${e.slice(2, 4)}`;
  }
  return fmtMonthName(refDate);
}

// Russian natural language expense parser (preserved & typed)
const NW: Record<string, number> = {
  ноль: 0, один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5,
  шесть: 6, семь: 7, восемь: 8, девять: 9, десять: 10, одиннадцать: 11,
  двенадцать: 12, тринадцать: 13, четырнадцать: 14, пятнадцать: 15,
  шестнадцать: 16, семнадцать: 17, восемнадцать: 18, девятнадцать: 19,
  двадцать: 20, тридцать: 30, сорок: 40, пятьдесят: 50, шестьдесят: 60,
  семьдесят: 70, восемьдесят: 80, девяносто: 90, сто: 100, двести: 200,
  триста: 300, четыреста: 400, пятьсот: 500, шестьсот: 600, семьсот: 700,
  восемьсот: 800, девятьсот: 900,
};

const MONTHS_RU: Record<string, number> = {
  январ: 0, феврал: 1, март: 2, апрел: 3, ма: 4, мая: 4, мае: 4,
  июн: 5, июл: 6, август: 7, сентябр: 8, октябр: 9, ноябр: 10, декабр: 11,
};

const DICT: [RegExp, string][] = [
  [/^картошк\S*$|^картофел\S*$/i, 'картошка'],
  [/^морков\S*$/i, 'морковка'],
  [/^капуст\S*$/i, 'капуста'],
  [/^помидор\S*$|^томат\S*$/i, 'помидоры'],
  [/^огурц\S*$|^огурец$/i, 'огурцы'],
  [/^яблок\S*$/i, 'яблоки'],
  [/^банан\S*$/i, 'бананы'],
  [/^молок\S*$/i, 'молоко'],
  [/^хлеб\S*$/i, 'хлеб'],
  [/^сыр(а|у|ом)?$/i, 'сыр'],
  [/^колбас\S*$/i, 'колбаса'],
  [/^рыб(а|ы|у|ой)$/i, 'рыба'],
  [/^мяс(о|а|ом)$/i, 'мясо'],
  [/^масл(о|а|ом)$/i, 'масло'],
  [/^сахар\S*$/i, 'сахар'],
  [/^яйц\S*$|^яиц\S*$/i, 'яйца'],
  [/^бензин\S*$/i, 'бензин'],
  [/^лук(а|у|ом)?$/i, 'лук'],
];

const STOP = /^(я|мы|ещё|еще|также|потом|затем|тоже|вот|ну|и|а|купил[аи]?|взял[аи]?|заплатил[аи]?|потратил[аи]?|стоил[аио]?|стоит|обошл\S*|вчера|позавчера|сегодня|картой|карту|налич\S*|за|на|по|в|рублей|рубля|рубль|руб|р|рынке|магазине|аптеке|супермаркете|так|значит|короче|просто|около|примерно|мне|это)$/i;
const UNIT = /^(кг|килограмм\S*|кило|полкило|г|гр|грамм\S*|л|литр\S*|шт|штук\S*|пачк\S*|бутылк\S*|упаковк\S*)$/i;

export function words2num(t: string): string {
  const out: string[] = [];
  let cur = 0;
  let tot = 0;
  let on = false;
  const flush = () => {
    if (on) {
      out.push(String(tot + cur));
      cur = 0;
      tot = 0;
      on = false;
    }
  };
  t.split(/\s+/).forEach((x) => {
    const k = x.toLowerCase().replace(/[.,!?]/g, '');
    if (k in NW) {
      cur += NW[k];
      on = true;
    } else if (/^тысяч/.test(k)) {
      tot += (cur || 1) * 1000;
      cur = 0;
      on = true;
    } else {
      flush();
      out.push(x);
    }
  });
  flush();
  return out.join(' ');
}

function extractDateFromText(t: string, refDate: Date): { date: string; rest: string } {
  let base = new Date(refDate.getFullYear(), refDate.getMonth(), refDate.getDate());
  const now = new Date();
  let cleanT = t;
  if (/позавчера/i.test(t)) {
    base = new Date(now);
    base.setDate(now.getDate() - 2);
    return { date: isoDate(base), rest: t.replace(/позавчера/gi, ' ') };
  }
  if (/вчера/i.test(t)) {
    base = new Date(now);
    base.setDate(now.getDate() - 1);
    return { date: isoDate(base), rest: t.replace(/вчера/gi, ' ') };
  }
  if (/сегодня/i.test(t)) {
    return { date: isoDate(now), rest: t.replace(/сегодня/gi, ' ') };
  }
  const dm = t.match(/(?:^|\s)(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?(?=\s|$)/);
  if (dm) {
    const day = +dm[1];
    const mon = +dm[2] - 1;
    const yr = dm[3] ? (dm[3].length === 2 ? 2000 + +dm[3] : +dm[3]) : refDate.getFullYear();
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      base = new Date(yr, mon, day);
      cleanT = t.replace(dm[0], ' ');
      return { date: isoDate(base), rest: cleanT };
    }
  }
  const wm = t.match(
    /(\d{1,2})\s+(январ[яе]?|феврал[яе]?|март[ае]?|апрел[яе]?|ма[яе]|июн[яе]?|июл[яе]?|август[ае]?|сентябр[яе]?|октябр[яе]?|ноябр[яе]?|декабр[яе]?)/i
  );
  if (wm) {
    const dNum = +wm[1];
    const mWord = wm[2].toLowerCase();
    for (const k of Object.keys(MONTHS_RU)) {
      if (mWord.startsWith(k)) {
        base = new Date(refDate.getFullYear(), MONTHS_RU[k], dNum);
        cleanT = t.replace(wm[0], ' ');
        return { date: isoDate(base), rest: cleanT };
      }
    }
  }
  return { date: isoDate(base), rest: cleanT };
}

export function catOf(s: string, cats: CategoryTuple[]): string | null {
  for (let i = 0; i < cats.length; i++) {
    const pat = cats[i][2];
    if (pat) {
      try {
        const rg = new RegExp(pat.replace(/,/g, '|'), 'i');
        if (rg.test(s)) return cats[i][0];
      } catch {
        // ignore invalid regex
      }
    }
  }
  return null;
}

function cleanName(s: string): string {
  const stripped = s.replace(
    /\d+(?:[.,]\d+)?\s*(?:кг|килограмм\S*|кило|гр?|грамм\S*|л|литр\S*|шт|штук\S*)(?![а-яё])/gi,
    ' '
  );
  const words = stripped
    .split(/\s+/)
    .map((x) => x.replace(/[.,;!?:]/g, ''))
    .filter((x) => x && !STOP.test(x) && !UNIT.test(x) && !/^\d+([.,]\d+)?$/.test(x))
    .map((x) => {
      for (const [re, rep] of DICT) {
        if (re.test(x)) return rep;
      }
      return x;
    });
  const out: string[] = [];
  words.forEach((x) => {
    if (out[out.length - 1] !== x) out.push(x);
  });
  const r = out.join(' ');
  return r ? r.charAt(0).toUpperCase() + r.slice(1) : '';
}

export interface ParsedExpenseItem {
  a: number;
  n: string;
  c: string;
}

export function parsePhrase(
  t0: string,
  cats: CategoryTuple[],
  refDate: Date
): { date: string; method: string; items: ParsedExpenseItem[] } {
  const dtInfo = extractDateFromText(t0, refDate);
  const t = words2num(dtInfo.rest);
  const method = /налич/i.test(t0)
    ? 'Наличка'
    : /ипотек|кредит|займ/i.test(t0)
    ? 'Кредит / Ипотека'
    : 'Карта';
  const whole = catOf(t, cats) || 'Другое';

  const re = /(\d[\d\s]*(?:[.,]\d+)?)\s*(?:₽|руб[а-яё]*|р(?![а-яё]))/gi;
  let m: RegExpExecArray | null;
  let last = 0;
  const items: ParsedExpenseItem[] = [];

  while ((m = re.exec(t))) {
    const seg = t.slice(last, m.index + m[0].length);
    last = m.index + m[0].length;
    items.push({
      a: parseNum(m[1]) || 0,
      n: cleanName(seg.slice(0, seg.length - m[0].length)),
      c: catOf(seg, cats) || whole,
    });
  }

  const tail = t.slice(last);
  const re2 = /\d+(?:[.,]\d+)?(?!\d|[.,]\d)(?!\s*(?:кг|кило|килограмм|гр?(?![а-яё])|грамм|л(?![а-яё])|литр|шт|штук))/g;
  let m2: RegExpExecArray | null;
  let l2 = 0;
  while ((m2 = re2.exec(tail))) {
    const sg = tail.slice(l2, m2.index + m2[0].length);
    l2 = m2.index + m2[0].length;
    items.push({
      a: parseNum(m2[0]),
      n: cleanName(sg.slice(0, sg.length - m2[0].length)),
      c: catOf(sg, cats) || whole,
    });
  }

  if (!items.length) items.push({ a: 0, n: cleanName(t), c: whole });
  return { date: dtInfo.date, method, items };
}

export function isFixedExpense(t: Transaction): boolean {
  const h = `${t.n || ''} ${t.c || ''}`.toLowerCase();
  if (t.repeat && t.repeat !== 'none') return true;
  if (t.c === 'Кредиты и Ипотека') return true;
  if (/ипотек|кредит|займ|долг|жкх|коммунал|аренд|квартплат|садик|школ|логопед|секци|кружок|интернет|севстар/.test(h)) {
    return true;
  }
  return false;
}

export function isTaxDeductible(t: Transaction): 'med' | 'edu' | 'mort' | null {
  const h = `${t.n || ''} ${t.c || ''}`.toLowerCase();
  if (t.c === 'Здоровье') return 'med';
  if (/логопед|школ|обучен|кружок|репетитор|садик|секци|вуз|колледж/.test(h)) return 'edu';
  if (/аптек|врач|клиник|стоматолог|зуб|анализ|лечен|медицин/.test(h)) return 'med';
  if (/ипотек/.test(h)) return 'mort';
  return null;
}

export interface FinancialHealth {
  sumIn: number;
  sumOut: number;
  left: number;
  fixedSum: number;
  flexSum: number;
  flexByCat: Record<string, number>;
  topFlexCat: string | null;
  remDays: number;
  safeDaily: number;
  taxMed: number;
  taxEdu: number;
  taxMort: number;
  socialRefund: number;
}

export function analyzeFinancialHealth(pTx: Transaction[], refDate: Date): FinancialHealth {
  const inTx = pTx.filter((t) => t.t === 'in');
  const outTx = pTx.filter((t) => t.t !== 'in');
  const sumIn = inTx.reduce((a, t) => a + t.a, 0);
  const sumOut = outTx.reduce((a, t) => a + t.a, 0);
  const left = sumIn - sumOut;

  let fixedSum = 0;
  let flexSum = 0;
  const flexByCat: Record<string, number> = {};
  let taxMed = 0;
  let taxEdu = 0;
  let taxMort = 0;

  outTx.forEach((t) => {
    if (isFixedExpense(t)) {
      fixedSum += t.a;
    } else {
      flexSum += t.a;
      flexByCat[t.c] = (flexByCat[t.c] || 0) + t.a;
    }
    const txType = isTaxDeductible(t);
    if (txType === 'med') taxMed += t.a;
    else if (txType === 'edu') taxEdu += t.a;
    else if (txType === 'mort') taxMort += t.a;
  });

  const now = new Date();
  const dim = new Date(refDate.getFullYear(), refDate.getMonth() + 1, 0).getDate();
  const remDays =
    refDate.getMonth() === now.getMonth() && refDate.getFullYear() === now.getFullYear()
      ? Math.max(1, dim - now.getDate() + 1)
      : dim;

  const freeForLife = sumIn - fixedSum - flexSum;
  const safeDaily = freeForLife > 0 ? Math.round(freeForLife / remDays) : 0;
  const topFlexCat = Object.keys(flexByCat).sort((a, b) => flexByCat[b] - flexByCat[a])[0] || null;
  const socialRefund = Math.round((taxMed + taxEdu) * 0.13);

  return {
    sumIn,
    sumOut,
    left,
    fixedSum,
    flexSum,
    flexByCat,
    topFlexCat,
    remDays,
    safeDaily,
    taxMed,
    taxEdu,
    taxMort,
    socialRefund,
  };
}

const STOPQ = /^(сколько|потратил[аи]?|ушло|всего|сегодня|вчера|неделю|неделе|месяц|месяце|этом|этот|мне|было|трат[аы]?|денег|рублей|купил[аи]?|осталось|моих|средняя|средний|больше|самая|большая|день|дней|категории|категорию|все|время|на|за|по|что|где|какая|какой|я|мои|моя|это)$/i;

export function runLocalAdvisor(
  rawQ: string,
  state: AppState,
  periodTx: Transaction[],
  refDate: Date
): { matched: boolean; reply: string; sourceLabel?: string; statePatch?: Partial<AppState> } {
  const q = words2num(rawQ).toLowerCase();
  const outTx = periodTx.filter((t) => t.t !== 'in');
  const H = analyzeFinancialHealth(periodTx, refDate);

  const pctM = q.match(/(\d+(?:[.,]\d+)?)\s*(?:%|процент)/);
  if (pctM && /вклад|копил|отда|откладыв|остат|доход|сбереж/.test(q)) {
    const pct = parseFloat(pctM[1].replace(',', '.'));
    const rateM = q.match(/под\s*(\d+(?:[.,]\d+)?)/);
    const rate = rateM ? parseFloat(rateM[1].replace(',', '.')) : 18;
    const fromInc = /от доход|с зарплат/.test(q);
    const base = fromInc ? H.sumIn : Math.max(0, H.left);
    const monthlyAdd = Math.round(base * (pct / 100));
    const saveRule = {
      type: 'pct' as const,
      val: pct,
      rate,
      fromInc,
      label: `${pct}% от ${fromInc ? 'дохода' : 'остатка'}`,
    };
    const existingAssets = state.investments?.assets || [];
    const hasDeposit = existingAssets.some((a) => a.kind === 'deposit');
    const nextAssets = hasDeposit
      ? existingAssets
      : [
          {
            id: uid(),
            kind: 'deposit' as const,
            ticker: '',
            name: `Копилка (${saveRule.label})`,
            qty: 1,
            price: 0,
            annualYieldPct: rate,
            payoutMonths: [],
          },
          ...existingAssets,
        ];
    const y1 = Math.round(monthlyAdd * 12 * (1 + (rate / 100) * 0.55));
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Пассивный доход»',
      reply: `Закрепил правило: откладывать ${pct}% от ${fromInc ? 'дохода' : 'остатка'}.\n• К переводу за период: ${formatMoney(monthlyAdd)}\n• При ставке ${rate}% годовых за год накопится ~${formatMoney(y1)}.`,
      statePatch: {
        saveRule,
        investments: { ...state.investments, assets: nextAssets },
      },
    };
  }

  const rubM = q.match(/(\d[\d\s]*)\s*(?:₽|руб|р\b)/);
  if (rubM && /вклад|копил|отда|откладыв|сбереж/.test(q)) {
    const fix = parseNum(rubM[1]);
    const rM = q.match(/под\s*(\d+(?:[.,]\d+)?)/);
    const rVal = rM ? parseFloat(rM[1].replace(',', '.')) : 18;
    const saveRule = { type: 'fix' as const, val: fix, rate: rVal, label: `${formatMoney(fix)} в месяц` };
    const existingAssets = state.investments?.assets || [];
    const hasDeposit = existingAssets.some((a) => a.kind === 'deposit');
    const nextAssets = hasDeposit
      ? existingAssets
      : [
          {
            id: uid(),
            kind: 'deposit' as const,
            ticker: '',
            name: `Копилка (${saveRule.label})`,
            qty: 1,
            price: 0,
            annualYieldPct: rVal,
            payoutMonths: [],
          },
          ...existingAssets,
        ];
    const yr1 = Math.round(fix * 12 * (1 + (rVal / 100) * 0.55));
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Пассивный доход»',
      reply: `Закреплено: пополнять вклад на ${formatMoney(fix)}/мес.\n• За год под ~${rVal}% накопится ~${formatMoney(yr1)}.`,
      statePatch: {
        saveRule,
        investments: { ...state.investments, assets: nextAssets },
      },
    };
  }

  // Detect habit creation request in Advisor chat ("добавь привычку ...")
  const habitMatch = rawQ.match(
    /(?:добав\S*|созда\S*|завед\S*|хочу|начн\S*)\s+(?:нов\S*\s+)?привычк\S*[:\s—-]*([^.!?]+)/i
  );
  if (habitMatch && habitMatch[1]?.trim()) {
    const title = habitMatch[1].trim().replace(/^["«']|["»']$/g, '');
    const icon = /вод|пить/.test(title.toLowerCase())
      ? '💧'
      : /спорт|зарядк|прогул|бег|шаг/.test(title.toLowerCase())
      ? '🏃'
      : /книг|чит/.test(title.toLowerCase())
      ? '📖'
      : /отклад|копит|деньг|трат|бюджет/.test(title.toLowerCase())
      ? '💰'
      : '🌱';
    const nextHabit: HabitItem = {
      id: uid(),
      title: title.charAt(0).toUpperCase() + title.slice(1),
      icon,
      completedDates: [],
      createdAt: Date.now(),
    };
    return {
      matched: true,
      sourceLabel: 'Личный трекер «Привычки и забота»',
      reply: `✅ Отлично! Добавил привычку «${nextHabit.icon} ${nextHabit.title}» в ваш трекер «Привычки и забота» ниже. Будем отмечать прогресс каждый день!`,
      statePatch: {
        habits: [...(state.habits || []), nextHabit],
      },
    };
  }

  const invSummary = analyzeInvestments(state.investments, state.deposits);

  if (/портфел|актив|брокер|купон|дивиденд|капитал|пассивн/.test(q)) {
    const brokerName = getBrokerLabel(state.investments.broker, state.investments.brokerCustomName);
    const lines = [`Сводка портфеля и активов (${brokerName}):`];
    lines.push(`• Весь капитал: ${formatMoney(invSummary.grandCapitalTotal)} (включая свободный остаток ${formatMoney(invSummary.freeCash)})`);
    lines.push(`• Купоны (ОФЗ/облигации): ${formatMoney(invSummary.couponsTotal)} · Дивиденды (акции): ${formatMoney(invSummary.dividendsTotal)}`);
    lines.push(`• Банковские вклады и накопительные счета: ${formatMoney(invSummary.bankDepositsTotal + invSummary.budgetDepositsTotal)}`);
    lines.push(`• Прогноз пассивного дохода: ~${formatMoney(invSummary.monthlyPassiveIncome)}/мес (${formatMoney(invSummary.annualPassiveIncome)}/год)`);
    if (state.investments.monthlyPlan > 0) {
      lines.push(
        `• План пополнения ИИС: ${formatMoney(state.investments.monthlyPlan)}/мес → налоговый вычет 13%: +${formatMoney(invSummary.iisDeduction13)}/год.`
      );
    }
    if (state.investments.assets.length > 0) {
      const top = state.investments.assets
        .slice(0, 4)
        .map((a) => `${a.name}: ${formatMoney(getAssetTotalValue(a))}`)
        .join(', ');
      lines.push(`• Позиции: ${top}`);
    }
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Пассивный доход»',
      reply: lines.join('\n'),
    };
  }

  if (/вычет|13%|налог|ндфл|вернут|логопед|лечен/.test(q)) {
    const lines = ['Как вернуть деньги налоговым вычетом 13% по вашим данным:'];
    if (invSummary.iisDeduction13 > 0) {
      lines.push(
        `• По ИИС (ваш план ${formatMoney(state.investments.monthlyPlan)}/мес = ${formatMoney(invSummary.annualIisContribution)}/год): расчётный возврат 13% составит +${formatMoney(invSummary.iisDeduction13)}/год.`
      );
    } else {
      lines.push(
        '• По ИИС: план пополнения пока не задан (вычет 0 ₽). Пример: при пополнении 5 000 ₽/мес (60 000 ₽/год) вычет 13% составит +7 800 ₽/год.'
      );
    }
    if (H.taxEdu > 0 || H.taxMed > 0) {
      lines.push(
        `• По обучению и медицине найдено трат: ${formatMoney(H.taxEdu + H.taxMed)} — ориентировочный возврат +${formatMoney(H.socialRefund)}.`
      );
    } else {
      lines.push(
        '• За период не найдено трат на платную медицину или обучение (вычет 0 ₽). 13% возвращаются по чекам и справкам об оплате.'
      );
    }
    if (H.taxMort > 0) {
      lines.push(
        `• По ипотеке (${formatMoney(H.taxMort)}) доступен имущественный вычет до 260 000 ₽ и до 390 000 ₽ по процентам.`
      );
    }
    lines.push('Совет: прикрепляйте фото чеков прямо в разделе «Расходы», чтобы всё было под рукой при подаче декларации в ФНС.');
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Расчёт вычета 13% НДФЛ и ИИС',
      reply: lines.join('\n'),
    };
  }

  if (/минус|долг|кредит|ипотек|выбрат|не хватает|экономи|сократ/.test(q)) {
    const lines = ['План стабилизации бюджета:'];
    lines.push(`1. Обязательная база (${formatMoney(H.fixedSum)}): ипотека, кредиты и ЖКХ — фиксируем без просрочек.`);
    if (H.topFlexCat) {
      const save20 = Math.round(H.flexByCat[H.topFlexCat] * 0.2);
      lines.push(
        `2. Гибкие траты (${formatMoney(H.flexSum)}): больше всего уходит на «${H.topFlexCat}» (${formatMoney(H.flexByCat[H.topFlexCat])}). Сокращение на 20% вернёт +${formatMoney(save20)}.`
      );
    }
    if (H.left < 0) {
      lines.push(`3. Сейчас перерасход ${formatMoney(-H.left)}. Включите паузу 24 часа для любых покупок дороже 1 500 ₽.`);
    } else {
      lines.push(`3. Безопасный темп до конца месяца: до ${formatMoney(H.safeDaily)} в день.`);
    }
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Анализ бюджета и обязательств',
      reply: lines.join('\n'),
    };
  }

  if (/подушк|резерв|заначк|чёрный день|черный день|безопасн/.test(q)) {
    const curSaved =
      invSummary.bankDepositsTotal +
      invSummary.budgetDepositsTotal +
      invSummary.freeCash +
      (state.family.totalSavings || 0);
    const hasExpenses = H.fixedSum > 0 || H.sumOut > 0;
    if (!hasExpenses) {
      return {
        matched: true,
        sourceLabel: 'Личные финансы · Расчёт подушки безопасности',
        reply: `Ваши расходы за период ещё не внесены, поэтому точный размер подушки рассчитать пока нельзя.\n• Сейчас в накоплениях и вкладах: ${formatMoney(curSaved)}\n• Пример расчёта (для условных расходов 35 000 ₽/мес): минимум на 3 месяца — 105 000 ₽, комфорт на 6 месяцев — 210 000 ₽.\nВнесите траты в разделе «Расходы», и я рассчитаю подушку точно по вашим цифрам.`,
      };
    }
    const baseMonth = H.fixedSum > 0 ? H.fixedSum : H.sumOut;
    const minPad = baseMonth * 3;
    const optPad = baseMonth * 6;
    const pctReady = minPad > 0 ? Math.min(100, Math.round((curSaved / minPad) * 100)) : 0;
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Вклады, свободный кэш и семейные накопления',
      reply: `Расчёт подушки безопасности по вашим данным:\n• Базовые расходы в месяц: ${formatMoney(baseMonth)}\n• Минимум на 3 месяца: ${formatMoney(minPad)} (собрано ${formatMoney(curSaved)} — ${pctReady}%)\n• Комфорт на 6 месяцев: ${formatMoney(optPad)}\nДержите резерв на накопительном счёте с ежедневным остатком или в фондах ликвидности.`,
    };
  }

  if (/выгодн|вклад\s*vs|sbmm|lqdt|иис|офз|акци/.test(q) && !/лимит\S*\s+иис|закон|правил\S*\s+иис|новы\S*\s+иис|иис-?3/.test(q)) {
    const userBase =
      invSummary.freeCash > 0
        ? invSummary.freeCash
        : H.left > 0
        ? H.left
        : state.investments.monthlyPlan > 0
        ? state.investments.monthlyPlan
        : 0;
    const isExample = userBase === 0;
    const investBase = isExample ? 5000 : userBase;
    const dep1Y = Math.round(investBase * 1.17);
    const iis1Y = Math.round(investBase * 1.16 + investBase * 0.13);
    const ownLine =
      invSummary.investedSecuritiesTotal > 0
        ? `\n• Сейчас в вашем портфеле: ОФЗ ${formatMoney(invSummary.couponsTotal)}, акции ${formatMoney(invSummary.dividendsTotal)}${
            invSummary.iisDeduction13 > 0
              ? `, вычет 13% по плану ИИС: +${formatMoney(invSummary.iisDeduction13)}/год`
              : ''
          }.`
        : '';
    const heading = isExample
      ? `Свои суммы пока не заданы — привожу пример расчёта на условной сумме ${formatMoney(investBase)}:`
      : `Сравнение на вашей сумме ${formatMoney(investBase)}:`;
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Пассивный доход»',
      reply: `${heading}\n1. Накопительный счёт / фонд ликвидности (~16–17%): через год ~${formatMoney(dep1Y)}, доступ в любой день.\n2. ОФЗ на ИИС (~16% + вычет 13% НДФЛ): в первый год отдача до ~${formatMoney(iis1Y)}.${ownLine}\nПравило: сначала подушка на 3 месяца на вкладе, затем регулярные пополнения ИИС (подбор бумаг доступен во вкладке «Пассивный доход → Сканер рынка»).`,
    };
  }

  if (/мои вклад|вклады|депозит|копилк|накоплени|сбережени/.test(q)) {
    const depTotal = invSummary.budgetDepositsTotal + invSummary.bankDepositsTotal;
    const famSaved = state.family.totalSavings || 0;
    const lines = ['Ваши вклады и сбережения:'];
    if (state.deposits.length > 0) {
      state.deposits.forEach((d) => {
        lines.push(`• ${d.name}: ${formatMoney(d.sum)} под ${d.rate}%${d.rule ? ` (${d.rule})` : ''}`);
      });
    }
    const invBankDeps = state.investments.assets.filter((a) => a.kind === 'deposit');
    invBankDeps.forEach((a) => {
      lines.push(`• ${a.name}: ${formatMoney(a.price)}${a.annualYieldPct ? ` под ${a.annualYieldPct}%` : ''}`);
    });
    if (state.deposits.length === 0 && invBankDeps.length === 0) {
      lines.push('• Пока нет добавленных банковских вкладов (их можно внести в разделе «Пассивный доход»).');
    }
    if (famSaved > 0) {
      lines.push(`• Семейные накопления («Семья»): ${formatMoney(famSaved)}`);
    }
    lines.push(`• Итого вкладов и накоплений: ${formatMoney(depTotal + famSaved)}`);
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Пассивный доход»',
      reply: lines.join('\n'),
    };
  }

  if (/разбор|анализ|бюджет|доход|зарплат|лимит/.test(q)) {
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Бюджет и Расходы»',
      reply: `Разбор бюджета за выбранный период:\n• Доходы: ${formatMoney(H.sumIn)} · Расходы: ${formatMoney(H.sumOut)}\n• Обязательные платежи: ${formatMoney(H.fixedSum)}\n• Гибкие покупки: ${formatMoney(H.flexSum)}\n• Безопасный лимит: ${formatMoney(H.safeDaily)}/день (осталось дней: ${H.remDays})${H.socialRefund > 0 ? `\n• Возможный вычет 13% НДФЛ: +${formatMoney(H.socialRefund)}` : ''}`,
    };
  }

  if (/осталось|остаток|свободн/.test(q)) {
    if (!H.sumIn) {
      return {
        matched: true,
        sourceLabel: 'Личные финансы · Раздел «Бюджет»',
        reply: 'Сначала внесите доходы во вкладке «Бюджет», чтобы рассчитать свободный остаток.',
      };
    }
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Бюджет»',
      reply:
        H.left >= 0
          ? `Свободный остаток: ${formatMoney(H.left)} (безопасно тратить до ${formatMoney(H.safeDaily)} в день).`
          : `Перерасход: ${formatMoney(-H.left)}. Нажмите «План выхода из минуса» для рекомендаций.`,
    };
  }

  if (/больше всего|самая большая|топ\s*трат|крупн\S*\s+трат|расход|потратил|траты/.test(q)) {
    if (!outTx.length) {
      return {
        matched: true,
        sourceLabel: 'Личные финансы · Раздел «Расходы»',
        reply: 'Трат за выбранный период пока нет.',
      };
    }
    const bc: Record<string, number> = {};
    outTx.forEach((t) => (bc[t.c] = (bc[t.c] || 0) + t.a));
    const k = Object.keys(bc).sort((a, b) => bc[b] - bc[a])[0];
    const mx = outTx.slice().sort((a, b) => b.a - a.a)[0];
    return {
      matched: true,
      sourceLabel: 'Личные финансы · Раздел «Расходы»',
      reply: `За выбранный период потрачено ${formatMoney(H.sumOut)} (${outTx.length} записей). Больше всего уходит на «${k}»: ${formatMoney(bc[k])} (${Math.round((bc[k] / H.sumOut) * 100)}%). Самая крупная трата: ${mx.n || mx.c}, ${formatMoney(mx.a)}.`,
    };
  }

  if (outTx.length > 0) {
    const qw = q.replace(/[.,;!?:«»"]/g, ' ').split(/\s+/).filter(Boolean);
    const matchedCat = state.cats.find((c) => {
      const n = c[0].toLowerCase();
      return qw.some((w) =>
        n.length <= 3
          ? w.length <= 4 && w.slice(0, 2) === n.slice(0, 2)
          : w.startsWith(n.slice(0, Math.max(4, n.length - 2)))
      );
    });
    if (matchedCat) {
      const cs = outTx.filter((t) => t.c === matchedCat[0]).reduce((a, t) => a + t.a, 0);
      return {
        matched: true,
        sourceLabel: `Личные финансы · Категория «${matchedCat[0]}»`,
        reply: `По категории «${matchedCat[0]}» за выбранный период потрачено: ${formatMoney(cs)}.`,
      };
    }

    const words = q
      .replace(/[.,;!?:«»"]/g, ' ')
      .split(/\s+/)
      .filter((x) => x.length >= 4 && !STOPQ.test(x));
    if (words.length) {
      const st = words.map((x) => x.slice(0, Math.max(4, x.length - 2)));
      const s2 = outTx.filter((t) => {
        const h = `${t.n || ''} ${t.c}`.toLowerCase();
        return st.some((z) => h.includes(z));
      });
      if (s2.length) {
        return {
          matched: true,
          sourceLabel: 'Личные финансы · Поиск по вашим тратам',
          reply: `Найдено по вашим тратам («${words.join(' ')}»): ${formatMoney(s2.reduce((a, t) => a + t.a, 0))} (${s2.length} записей).`,
        };
      }
    }
  }

  return {
    matched: false,
    reply: '',
  };
}

// =========================================================================
// REPEATING TASKS & ANTI-DOUBLE-COUNTING HELPERS
// =========================================================================
export function isTaskOnDate(task: CalendarTask, targetIso: string): boolean {
  if (!task.date) return false;
  if (task.date === targetIso) return true;
  const rep = task.repeat || 'none';
  if (rep === 'none') return false;
  if (targetIso < task.date) return false;

  const [sy, sm, sd] = task.date.split('-').map(Number);
  const [ty, tm, td] = targetIso.split('-').map(Number);
  const sDate = new Date(sy, sm - 1, sd);
  const tDate = new Date(ty, tm - 1, td);

  if (rep === 'daily') return true;
  if (rep === 'weekly') return sDate.getDay() === tDate.getDay();
  if (rep === 'monthly') {
    const lastDayOfTargetMonth = new Date(ty, tm, 0).getDate();
    return td === Math.min(sd, lastDayOfTargetMonth);
  }
  if (rep === 'yearly') {
    const lastDayOfTargetMonth = new Date(ty, tm, 0).getDate();
    return sm === tm && td === Math.min(sd, lastDayOfTargetMonth);
  }
  return false;
}

export function isTaskDoneOnDate(task: CalendarTask, targetIso: string): boolean {
  const rep = task.repeat || 'none';
  if (rep === 'none') return Boolean(task.done);
  return Array.isArray(task.completedDates) && task.completedDates.includes(targetIso);
}

export function getTasksForDate(tasks: CalendarTask[], targetIso: string): CalendarTask[] {
  return tasks
    .filter((t) => isTaskOnDate(t, targetIso))
    .sort((a, b) => {
      const da = isTaskDoneOnDate(a, targetIso);
      const db = isTaskDoneOnDate(b, targetIso);
      if (da !== db) return da ? 1 : -1;
      return (a.time || '99:99').localeCompare(b.time || '99:99');
    });
}

export function getRepeatLabel(rep?: TaskRepeatFreq): string {
  switch (rep) {
    case 'daily':
      return 'Ежедневно';
    case 'weekly':
      return 'Еженедельно';
    case 'monthly':
      return 'Ежемесячно';
    case 'yearly':
      return 'Ежегодно';
    default:
      return '';
  }
}

export function getRemindBeforeLabel(min?: number): string {
  if (!min) return 'В момент';
  if (min === 15) return 'За 15 мин';
  if (min === 60) return 'За 1 час';
  if (min === 1440) return 'За 1 день';
  if (min === 2880) return 'За 2 дня';
  return `За ${min} мин`;
}

export interface DuplicateExpenseWarning {
  sourceLabel: string;
  matchedName: string;
  matchedAmount: number;
  reason: string;
}

export function findDuplicateExpenseWarning(
  title: string,
  amount: number | undefined,
  dateIso: string,
  state: AppState
): DuplicateExpenseWarning | null {
  const low = title.trim().toLowerCase();
  const words = low
    .split(/[\s,.;:!?()/-]+/)
    .filter((w) => w.length >= 4 && !/^(оплатить|заплатить|купить|внести|платёж|платеж|счёт|счет)$/.test(w));

  const monthKey = dateIso.slice(0, 7);

  // 1) Check recurring or same-month expenses in state.tx
  for (const t of state.tx) {
    if (t.t !== 'out') continue;
    const txLow = `${t.n || ''} ${t.c || ''}`.toLowerCase();
    const wordHit = words.some((w) => txLow.includes(w));
    const amountHit = amount && amount > 0 && Math.abs(t.a - amount) <= Math.max(50, amount * 0.03);
    const sameMonth = t.d.slice(0, 7) === monthKey;

    if (t.repeat && t.repeat !== 'none' && (wordHit || amountHit)) {
      return {
        sourceLabel: 'Регулярные траты',
        matchedName: t.n || t.c,
        matchedAmount: t.a,
        reason: `В разделе «Расходы» уже есть регулярный платёж «${t.n || t.c}» (${formatMoney(t.a)}). Если добавить снова, сумма посчитается дважды.`,
      };
    }

    if (sameMonth && wordHit && (amountHit || !amount)) {
      return {
        sourceLabel: 'Расходы за этот месяц',
        matchedName: t.n || t.c,
        matchedAmount: t.a,
        reason: `В этом месяце уже записана похожая трата «${t.n || t.c}» (${formatMoney(t.a)} от ${fmtShortDate(t.d)}). Проверьте, чтобы не задвоить расход.`,
      };
    }
  }

  // 2) Check fixed family expenses & loans
  const famFixed = [
    ...(state.family?.expenses || []).map((x) => ({ ...x, src: 'Семья → Постоянные расходы' })),
    ...(state.family?.loans || []).map((x) => ({ ...x, src: 'Семья → Кредиты и ипотека' })),
  ];
  for (const f of famFixed) {
    const fLow = (f.name || '').toLowerCase();
    const wordHit = words.some((w) => fLow.includes(w));
    const amountHit = amount && amount > 0 && f.amount > 0 && Math.abs(f.amount - amount) <= Math.max(50, amount * 0.03);
    if (wordHit || amountHit) {
      return {
        sourceLabel: f.src,
        matchedName: f.name,
        matchedAmount: f.amount,
        reason: `Платёж «${f.name}» (${formatMoney(f.amount)}) уже учтён в блоке «${f.src}». Вы можете просто отметить задачу выполненной без дублирования расхода.`,
      };
    }
  }

  return null;
}

// =========================================================================
// UNIVERSAL VOICE / TEXT COMMAND PARSER
// =========================================================================
export type UniversalCommandResult =
  | {
      kind: 'expense';
      date: string;
      method: string;
      items: ParsedExpenseItem[];
    }
  | {
      kind: 'income';
      date: string;
      title: string;
      amount: number;
      category: string;
    }
  | {
      kind: 'task';
      date: string;
      time: string;
      title: string;
      repeat: TaskRepeatFreq;
      remindBeforeMin: number;
      amount?: number;
    }
  | {
      kind: 'shopping';
      items: string[];
    }
  | {
      kind: 'habit';
      title: string;
      icon: string;
    };

export function parseUniversalCommand(rawPhrase: string, cats: CategoryTuple[]): UniversalCommandResult {
  const original = rawPhrase.trim();
  const normalized = words2num(original);
  const low = normalized.toLowerCase();

  // 1) Habit command
  const habitRe = /(?:добав\S*|созда\S*|нов\S*)\s+привычк\S*[:\s—-]*(.+)$/i;
  const hMatch = original.match(habitRe);
  if (hMatch && hMatch[1]?.trim()) {
    const title = hMatch[1].trim();
    const icon = /вод|пить/.test(title.toLowerCase())
      ? '💧'
      : /спорт|зарядк|прогул|бег/.test(title.toLowerCase())
      ? '🏃'
      : /книг|чит/.test(title.toLowerCase())
      ? '📖'
      : /копит|отклад|трат/.test(title.toLowerCase())
      ? '💰'
      : '🌱';
    return {
      kind: 'habit',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      icon,
    };
  }

  // 2) Shopping list command ("в магазин: хлеб, молоко", "список покупок: ...", "купить молоко и сыр" without price)
  const hasMoneyNumber = /\d[\d\s]*(?:[.,]\d+)?\s*(?:₽|руб|р(?![а-яё]))/i.test(normalized) || /\b\d{2,}\b/.test(normalized);
  const shopPrefixRe = /^(?:в\s+магазин|магазин|в\s+список\s+покупок|список\s+покупок|добавь\s+в\s+покупки|надо\s+купить|купить)\s*[:—-]?\s*(.+)$/i;
  const sMatch = original.match(shopPrefixRe);
  if (sMatch && !hasMoneyNumber && !/напомни|завтра\s+в\s+\d|позвонить|встреч|оплатить/i.test(low)) {
    const rawItems = sMatch[1]
      .split(/,|;|\s+и\s+/i)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
    if (rawItems.length > 0) {
      return { kind: 'shopping', items: rawItems };
    }
  }

  // 3) Calendar Task / Reminder command ("напомни...", "задача...", "завтра в 10...", "25 числа оплатить...", "каждый месяц...")
  const isTaskIntent =
    /^(?:напомни|напоминание|задача|запиши\s+задачу|запланируй|поставь\s+задачу)/i.test(low) ||
    /(?:завтра|послезавтра|сегодня)\s+в\s+\d{1,2}(?::|\s+\d{2})?/i.test(low) ||
    /(?:каждый\s+день|ежедневно|каждую\s+неделю|еженедельно|каждый\s+месяц|ежемесячно|каждый\s+год|ежегодно)/i.test(low) ||
    /(?:позвонить|сходить|встреча|врач|стоматолог|оплатить\s+(?:интернет|жкх|подписку|связь|кредит|ипотеку|садик|школу))/i.test(low);

  if (isTaskIntent) {
    const dt = extractDateFromText(normalized, new Date());
    let targetDate = dt.date;
    let rest = dt.rest;

    // Handle "завтра" / "послезавтра" / "25 числа"
    const now = new Date();
    if (/послезавтра/i.test(rest)) {
      targetDate = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
      rest = rest.replace(/послезавтра/gi, '');
    } else if (/завтра/i.test(rest)) {
      targetDate = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      rest = rest.replace(/завтра/gi, '');
    } else {
      const dayNum = rest.match(/(\d{1,2})\s*(?:-?го\s+)?числ[аоеу]/i);
      if (dayNum) {
        const dNum = Math.min(31, Math.max(1, parseInt(dayNum[1], 10)));
        const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
        const maxCur = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        let candidate = new Date(now.getFullYear(), now.getMonth(), Math.min(dNum, maxCur));
        if (candidate.getTime() < todayMidnight) {
          const maxNext = new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate();
          candidate = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(dNum, maxNext));
        }
        targetDate = isoDate(candidate);
        rest = rest.replace(dayNum[0], '');
      }
    }

    // Parse repeat
    let repeat: TaskRepeatFreq = 'none';
    if (/каждый\s+день|ежедневно/i.test(rest)) {
      repeat = 'daily';
      rest = rest.replace(/каждый\s+день|ежедневно/gi, '');
    } else if (/каждую\s+неделю|еженедельно/i.test(rest)) {
      repeat = 'weekly';
      rest = rest.replace(/каждую\s+неделю|еженедельно/gi, '');
    } else if (/каждый\s+месяц|ежемесячно/i.test(rest)) {
      repeat = 'monthly';
      rest = rest.replace(/каждый\s+месяц|ежемесячно/gi, '');
    } else if (/каждый\s+год|ежегодно/i.test(rest)) {
      repeat = 'yearly';
      rest = rest.replace(/каждый\s+год|ежегодно/gi, '');
    }

    // Parse remindBefore ("за 1 день", "за 2 дня", "за час", "за 15 минут")
    let remindBeforeMin = 0;
    if (/за\s+2\s+дня|за\s+два\s+дня/i.test(rest)) {
      remindBeforeMin = 2880;
      rest = rest.replace(/за\s+(?:2|два)\s+дня/gi, '');
    } else if (/за\s+1?\s*день|за\s+сутки/i.test(rest)) {
      remindBeforeMin = 1440;
      rest = rest.replace(/за\s+(?:1\s+)?(?:день|сутки)/gi, '');
    } else if (/за\s+(?:1\s+)?час/i.test(rest)) {
      remindBeforeMin = 60;
      rest = rest.replace(/за\s+(?:1\s+)?час[а]?/gi, '');
    } else if (/за\s+15\s+мин/i.test(rest)) {
      remindBeforeMin = 15;
      rest = rest.replace(/за\s+15\s+мин\S*/gi, '');
    }

    // Parse time ("в 10:30", "в 18 00", "в 9 утра", "в 19")
    let time = '09:00';
    const timeMatch = rest.match(/(?:в\s+)?(\d{1,2})\s*[:.]\s*(\d{2})/) || rest.match(/в\s+(\d{1,2})(?:\s*(?:час\S*|утр\S*|вечер\S*))?(?!\s*(?:₽|руб|р\b|числ))/i);
    if (timeMatch) {
      let hh = Math.min(23, Math.max(0, parseInt(timeMatch[1], 10)));
      const mm = timeMatch[2] ? Math.min(59, Math.max(0, parseInt(timeMatch[2], 10))) : 0;
      if (/вечер/i.test(timeMatch[0]) && hh < 12) hh += 12;
      time = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
      rest = rest.replace(timeMatch[0], '');
    }

    // Optional amount inside financial task ("700 рублей")
    let amount: number | undefined;
    const amtMatch = rest.match(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:₽|руб[а-яё]*|р(?![а-яё]))/i);
    if (amtMatch) {
      const val = parseNum(amtMatch[1]);
      if (val > 0) amount = val;
      rest = rest.replace(amtMatch[0], '');
    }

    const cleanTitle = rest
      .replace(/^(?:напомни|напоминание|задача|запиши\s+задачу|запланируй|поставь\s+задачу|мне|пожалуйста)\s*/gi, '')
      .replace(/^[\s,.:—-]+|[\s,.:—-]+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    return {
      kind: 'task',
      date: targetDate,
      time,
      title: cleanTitle ? cleanTitle.charAt(0).toUpperCase() + cleanTitle.slice(1) : original,
      repeat,
      remindBeforeMin,
      amount,
    };
  }

  // 4) Income command ("получил зарплату 55000", "пришёл аванс 20000", "доход 15000")
  if (/(?:получил[аи]?|приш[её]л|пришла|зачислил|зарплат|аванс|доход|преми|подработк|пенси|кэшбэк|вычет)/i.test(low)) {
    const dt = extractDateFromText(normalized, new Date());
    const numMatch = dt.rest.match(/(\d[\d\s]*(?:[.,]\d+)?)/);
    const amount = numMatch ? parseNum(numMatch[1]) : 0;
    const category = /зарплат/i.test(low)
      ? 'Зарплата'
      : /аванс/i.test(low)
      ? 'Аванс'
      : /подработк/i.test(low)
      ? 'Подработка'
      : /пенси/i.test(low)
      ? 'Пенсия'
      : /вычет/i.test(low)
      ? 'Налоговый вычет 13%'
      : /процент|вклад/i.test(low)
      ? 'Проценты по вкладу'
      : 'Иной доход';
    const title =
      dt.rest
        .replace(/(\d[\d\s]*(?:[.,]\d+)?)\s*(?:₽|руб[а-яё]*|р(?![а-яё]))?/gi, '')
        .replace(/(?:получил[аи]?|приш[её]л|пришла|зачислил[аи]?|доход)/gi, '')
        .replace(/\s+/g, ' ')
        .trim() || category;

    return {
      kind: 'income',
      date: dt.date,
      title: title.charAt(0).toUpperCase() + title.slice(1),
      amount,
      category,
    };
  }

  // 5) Default: Expense parser (already handles multiple items, dates, payment methods, categories!)
  const parsed = parsePhrase(original, cats, new Date());
  return {
    kind: 'expense',
    date: parsed.date,
    method: parsed.method,
    items: parsed.items,
  };
}

// Zero-dependency Excel (.xlsx) export
function crc32(b: Uint8Array): number {
  let c: number;
  const table: number[] = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = table[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function makeZip(files: { n: string; d: Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: BlobPart[] = [];
  const cd: BlobPart[] = [];
  let off = 0;
  files.forEach((f) => {
    const nm = enc.encode(f.n);
    const crc = crc32(f.d);
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(12, 0x21, true);
    h.setUint32(14, crc, true);
    h.setUint32(18, f.d.length, true);
    h.setUint32(22, f.d.length, true);
    h.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(h.buffer), nm, new Uint8Array(f.d));

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(14, 0x21, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, f.d.length, true);
    c.setUint32(24, f.d.length, true);
    c.setUint16(28, nm.length, true);
    c.setUint32(42, off, true);
    cd.push(new Uint8Array(c.buffer), nm);
    off += 30 + nm.length + f.d.length;
  });
  const cdl = cd.reduce((acc, x) => acc + (x as Uint8Array).length, 0);
  const e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, cdl, true);
  e.setUint32(16, off, true);
  return new Blob([...parts, ...cd, new Uint8Array(e.buffer)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

function esx(s: string): string {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildXlsxBlob(tx: Transaction[]): Blob {
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RN = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PR = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const en = new TextEncoder();
  const L = tx.slice().sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : a.id - b.id));
  const H = ['Дата', 'Название', 'Категория', 'Способ оплаты', 'Сумма', 'Тип'];
  let rows =
    '<row r="1">' +
    H.map((h, i) => `<c r="${'ABCDEF'.charAt(i)}1" s="1" t="inlineStr"><is><t>${h}</t></is></c>`).join('') +
    '</row>';
  L.forEach((t, i) => {
    const r = i + 2;
    const p = t.d.split('-');
    const ser = Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - Date.UTC(1899, 11, 30)) / 86400000);
    rows += `<row r="${r}"><c r="A${r}" s="2"><v>${ser}</v></c><c r="B${r}" t="inlineStr"><is><t>${esx(t.n || '')}</t></is></c><c r="C${r}" t="inlineStr"><is><t>${esx(t.c)}</t></is></c><c r="D${r}" t="inlineStr"><is><t>${esx(t.m)}</t></is></c><c r="E${r}" s="3"><v>${t.a}</v></c><c r="F${r}" t="inlineStr"><is><t>${t.t === 'in' ? 'Доход' : 'Расход'}</t></is></c></row>`;
  });
  const n = L.length + 1;
  const W = [13, 32, 18, 16, 15, 12]
    .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
    .join('');
  const sheet = `${X}<worksheet xmlns="${NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${W}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:F${n}"/></worksheet>`;
  const styles = `${X}<styleSheet xmlns="${NS}"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd.mm.yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00&quot; ₽&quot;"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0E6B5F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files: [string, string][] = [
    ['[Content_Types].xml', `${X}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ['_rels/.rels', `${X}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${OD}officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `${X}<workbook xmlns="${NS}" xmlns:r="${RN}"><sheets><sheet name="Траты" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `${X}<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${OD}worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${OD}styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', styles],
    ['xl/worksheets/sheet1.xml', sheet],
  ];
  return makeZip(files.map(([name, content]) => ({ n: name, d: en.encode(content) })));
}
