import { Capacitor } from '@capacitor/core';
import { LocalNotifications, type LocalNotificationSchema } from '@capacitor/local-notifications';
import { AppState, PortfolioAsset, TabId } from '../types';
import {
  advanceRepeatDate,
  fmtShortDate,
  formatMoney,
  getTasksForDate,
  isTaskDoneOnDate,
  parseLocalIsoDate,
} from './finance';
import { getAssetAnnualIncome, getAssetTotalValue } from './investments';
import { isoDate, normDate } from './storage';

export type ReminderKind = 'task' | 'recurring' | 'deposit' | 'coupon' | 'dividend';

export interface UpcomingReminder {
  id: string;
  kind: ReminderKind;
  dateIso: string;
  time?: string;
  daysUntil: number; // 0 = today, 1 = tomorrow, 2+ = upcoming
  title: string;
  subtitle: string;
  amount?: number;
  targetTab: TabId;
  targetSectionId?: string;
  taskId?: number;
  remindBeforeMin?: number;
  isMonthEstimate?: boolean;
}

const CHANNEL_ID = 'finance-reminders';
const MAX_NATIVE_NOTIFS = 48;
const SHOWN_INAPP_KEY = 'my-budget-shown-rem-v1';

export function isNativeNotificationsPlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

function stableNotificationId(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  // Keep IDs strictly within [100000, 899999] so we never collide with user IDs or overflow Java int
  return 100000 + (Math.abs(hash) % 799999);
}

function diffDaysFromToday(targetIso: string, todayStart: Date): number {
  const dt = parseLocalIsoDate(targetIso);
  if (!dt) return 9999;
  dt.setHours(0, 0, 0, 0);
  return Math.round((dt.getTime() - todayStart.getTime()) / (24 * 60 * 60 * 1000));
}

function getNextMonthEstimateIso(payoutMonths: number[], todayStart: Date): string | null {
  if (!Array.isArray(payoutMonths) || payoutMonths.length === 0) return null;
  const sorted = Array.from(new Set(payoutMonths.filter((m) => m >= 1 && m <= 12))).sort((a, b) => a - b);
  if (sorted.length === 0) return null;

  const y = todayStart.getFullYear();
  const candidates: string[] = [];
  for (const year of [y, y + 1]) {
    for (const m of sorted) {
      // Use the 1st of the payout month as an ориентир when user hasn't set an exact day
      const d = new Date(year, m - 1, 1);
      if (d.getTime() >= todayStart.getTime()) {
        candidates.push(isoDate(d));
      }
    }
  }
  return candidates[0] || null;
}

function estimateSinglePayout(asset: PortfolioAsset): number {
  const annual = getAssetAnnualIncome(asset);
  if (!(annual > 0)) return 0;
  const count = asset.payoutMonths?.length || (asset.kind === 'coupon' ? 2 : 1);
  return Math.round(annual / Math.max(1, count));
}

export function formatReminderLeadLabel(daysUntil: number, dateIso: string): string {
  if (daysUntil === 0) return 'Сегодня';
  if (daysUntil === 1) return 'Завтра';
  if (daysUntil === 2) return 'Послезавтра';
  if (daysUntil > 2 && daysUntil <= 7) return `Через ${daysUntil} дн. · ${fmtShortDate(dateIso)}`;
  return fmtShortDate(dateIso);
}

/**
 * Collects all upcoming reminders across Calendar Tasks, Recurring Payments,
 * Bank Deposit Maturities, and Coupon / Dividend Payouts.
 */
export function collectUpcomingReminders(
  state: AppState,
  horizonDays = 30,
  nowDate: Date = new Date()
): UpcomingReminder[] {
  const todayStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const todayIso = isoDate(todayStart);
  const endDate = new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + horizonDays);
  const endIso = isoDate(endDate);

  const out: UpcomingReminder[] = [];
  const seenIds = new Set<string>();

  const pushUnique = (item: UpcomingReminder) => {
    if (seenIds.has(item.id)) return;
    seenIds.add(item.id);
    out.push(item);
  };

  // 1) Calendar Tasks (single + repeating)
  const dayIsos: string[] = [];
  for (let offset = 0; offset <= horizonDays; offset++) {
    dayIsos.push(isoDate(new Date(todayStart.getFullYear(), todayStart.getMonth(), todayStart.getDate() + offset)));
  }

  for (const dIso of dayIsos) {
    const dayTasks = getTasksForDate(state.tasks || [], dIso);
    const daysUntil = diffDaysFromToday(dIso, todayStart);
    for (const t of dayTasks) {
      if (isTaskDoneOnDate(t, dIso)) continue;
      pushUnique({
        id: `task:${t.id}:${dIso}`,
        kind: 'task',
        dateIso: dIso,
        time: t.time || undefined,
        daysUntil,
        title: t.title,
        subtitle: t.time ? `Календарь · ${t.time}` : 'Задача календаря',
        amount: t.amount,
        targetTab: 'planner',
        targetSectionId: 'sec-planner-cal',
        taskId: t.id,
        remindBeforeMin: t.remindBeforeMin || 0,
      });
    }
  }

  // 2) Recurring Payments (scheduled repeat transactions not yet recorded on that date)
  const recordedChildKeys = new Set<string>();
  (state.tx || []).forEach((tx) => {
    if (tx.parentId) {
      recordedChildKeys.add(`${tx.parentId}:${normDate(tx.d)}`);
    }
  });

  (state.tx || []).forEach((tx) => {
    if (!tx.repeat || tx.repeat === 'none' || tx.parentId) return;
    const baseDt = parseLocalIsoDate(tx.d);
    if (!baseDt) return;
    const by = baseDt.getFullYear();
    const bm = baseDt.getMonth();
    const bd = baseDt.getDate();

    for (let step = 1; step <= 400; step++) {
      const occ = advanceRepeatDate(by, bm, bd, step, tx.repeat);
      const occIso = isoDate(occ);
      if (occIso > endIso) break;
      if (occIso < todayIso) continue;
      if (recordedChildKeys.has(`${tx.id}:${occIso}`)) continue;
      const daysUntil = diffDaysFromToday(occIso, todayStart);
      pushUnique({
        id: `rec:${tx.id}:${occIso}`,
        kind: 'recurring',
        dateIso: occIso,
        daysUntil,
        title: tx.n || tx.c,
        subtitle: `Повторяющийся платёж · ${tx.c}`,
        amount: tx.a,
        targetTab: tx.t === 'in' ? 'budget' : 'expenses',
        targetSectionId: tx.t === 'in' ? 'sec-inc-list' : 'sec-exp-list',
      });
    }
  });

  // 3) Bank Deposits (maturity / renewal date) & Coupons / Dividends (exact date or next payout month)
  const assets = state.investments?.assets || [];
  for (const asset of assets) {
    if (asset.remindEnabled === false) continue;

    if (asset.kind === 'deposit' && asset.maturityDate) {
      const dIso = normDate(asset.maturityDate);
      const daysUntil = diffDaysFromToday(dIso, todayStart);
      if (daysUntil >= 0 && daysUntil <= horizonDays) {
        const total = getAssetTotalValue(asset);
        pushUnique({
          id: `deposit:${asset.id}:${dIso}`,
          kind: 'deposit',
          dateIso: dIso,
          daysUntil,
          title: `Срок вклада: ${asset.name}`,
          subtitle:
            asset.annualYieldPct > 0
              ? `Вклад ${asset.annualYieldPct}% · проверьте продление`
              : 'Окончание / продление вклада',
          amount: total > 0 ? total : undefined,
          targetTab: 'invest',
          targetSectionId: 'sec-inv-assets',
        });
      }
      continue;
    }

    if (asset.kind === 'coupon' || asset.kind === 'dividend') {
      let targetIso: string | null = null;
      let isMonthEstimate = false;

      if (asset.nextPayoutDate) {
        const exact = normDate(asset.nextPayoutDate);
        const diff = diffDaysFromToday(exact, todayStart);
        if (diff >= 0 && diff <= horizonDays) {
          targetIso = exact;
        }
      }

      if (!targetIso && Array.isArray(asset.payoutMonths) && asset.payoutMonths.length > 0) {
        const est = getNextMonthEstimateIso(asset.payoutMonths, todayStart);
        if (est) {
          const diff = diffDaysFromToday(est, todayStart);
          if (diff >= 0 && diff <= horizonDays) {
            targetIso = est;
            isMonthEstimate = true;
          }
        }
      }

      if (targetIso) {
        const daysUntil = diffDaysFromToday(targetIso, todayStart);
        const estPayout = estimateSinglePayout(asset);
        const isCoupon = asset.kind === 'coupon';
        pushUnique({
          id: `${asset.kind}:${asset.id}:${targetIso}`,
          kind: asset.kind,
          dateIso: targetIso,
          daysUntil,
          title: isCoupon ? `Купон: ${asset.name}` : `Дивиденды: ${asset.name}`,
          subtitle: isMonthEstimate
            ? `${isCoupon ? 'Ориентир месяца купона' : 'Ориентир месяца дивидендов'}${asset.ticker ? ` · ${asset.ticker}` : ''}`
            : `${isCoupon ? 'Выплата купона' : 'Выплата дивидендов'}${asset.ticker ? ` · ${asset.ticker}` : ''}`,
          amount: estPayout > 0 ? estPayout : undefined,
          targetTab: 'invest',
          targetSectionId: 'sec-inv-assets',
          isMonthEstimate,
        });
      }
    }
  }

  const kindOrder: Record<ReminderKind, number> = {
    deposit: 0,
    coupon: 1,
    dividend: 2,
    recurring: 3,
    task: 4,
  };

  return out.sort((a, b) => {
    if (a.daysUntil !== b.daysUntil) return a.daysUntil - b.daysUntil;
    if ((a.time || '09:00') !== (b.time || '09:00')) {
      return (a.time || '09:00').localeCompare(b.time || '09:00');
    }
    return kindOrder[a.kind] - kindOrder[b.kind];
  });
}

// =========================================================================
// IN-APP DAILY REMINDER DEDUPLICATION (TODAY / TOMORROW)
// =========================================================================

function loadShownInAppKeys(): Record<string, number> {
  try {
    const raw = localStorage.getItem(SHOWN_INAPP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function markInAppReminderShown(key: string): void {
  try {
    const map = loadShownInAppKeys();
    const cutoff = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const pruned: Record<string, number> = {};
    for (const [k, ts] of Object.entries(map)) {
      if (typeof ts === 'number' && ts >= cutoff) pruned[k] = ts;
    }
    pruned[key] = Date.now();
    localStorage.setItem(SHOWN_INAPP_KEY, JSON.stringify(pruned));
  } catch {
    // ignore storage limits
  }
}

/**
 * Finds the next approaching financial reminder (deposit maturity, coupon/dividend payout,
 * recurring payment, or all-day task) for Today or Tomorrow that hasn't been alerted yet today.
 */
export function findNextDueApproachingReminder(
  state: AppState,
  nowDate: Date = new Date()
): { reminder: UpcomingReminder; stage: 'today' | 'tomorrow'; dedupKey: string } | null {
  const remindDayBefore = state.uiSettings?.remindDayBefore !== false;
  const reminderHour = state.uiSettings?.reminderHour ?? 9;

  // Respect morning reminder hour for day-level alerts (deposits, coupons, recurring)
  if (nowDate.getHours() < reminderHour) {
    return null;
  }

  const upcoming = collectUpcomingReminders(state, 2, nowDate);
  const shown = loadShownInAppKeys();
  const todayIso = isoDate(nowDate);

  for (const rem of upcoming) {
    // Exact-time tasks are handled by the precision minute ticker in App.tsx
    if (rem.kind === 'task' && rem.time) continue;
    if (rem.daysUntil === 0) {
      const dedupKey = `${rem.id}|${todayIso}|today`;
      if (!shown[dedupKey]) {
        return { reminder: rem, stage: 'today', dedupKey };
      }
    } else if (rem.daysUntil === 1 && remindDayBefore) {
      const dedupKey = `${rem.id}|${todayIso}|tomorrow`;
      if (!shown[dedupKey]) {
        return { reminder: rem, stage: 'tomorrow', dedupKey };
      }
    }
  }
  return null;
}

// =========================================================================
// CAPACITOR NATIVE LOCAL NOTIFICATIONS (ANDROID APK) + WEB NOTIFICATION API
// =========================================================================

export async function getNotificationPermissionState(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (isNativeNotificationsPlatform()) {
    try {
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display === 'granted') return 'granted';
      if (perm.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return 'prompt';
  }
  return 'unsupported';
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (!isNativeNotificationsPlatform()) return;
  try {
    await LocalNotifications.createChannel({
      id: CHANNEL_ID,
      name: 'Финансовые напоминания',
      description: 'Уведомления о задачах календаря, сроках вкладов, купонах и платежах',
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#1FB892',
    });
  } catch {
    // Safe fallback if channel creation unsupported on current platform
  }
}

export async function requestNotificationPermissions(): Promise<'granted' | 'denied' | 'prompt' | 'unsupported'> {
  if (isNativeNotificationsPlatform()) {
    try {
      await ensureAndroidNotificationChannel();
      const current = await LocalNotifications.checkPermissions();
      if (current.display === 'granted') return 'granted';
      const requested = await LocalNotifications.requestPermissions();
      if (requested.display === 'granted') return 'granted';
      if (requested.display === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }

  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      const res = await Notification.requestPermission();
      if (res === 'granted') return 'granted';
      if (res === 'denied') return 'denied';
      return 'prompt';
    } catch {
      return 'unsupported';
    }
  }
  return 'unsupported';
}

/**
 * Schedules native Android/iOS LocalNotifications via @capacitor/local-notifications
 * for upcoming calendar tasks, recurring payments, bank deposit maturities, and coupon/dividend payouts.
 * Safely no-ops in standard Web/PWA browsers without throwing errors.
 */
export async function syncNativeLocalNotifications(
  state: AppState
): Promise<{ scheduled: number; granted: boolean }> {
  if (!isNativeNotificationsPlatform()) {
    return { scheduled: 0, granted: false };
  }

  try {
    const perm = await LocalNotifications.checkPermissions();
    if (perm.display !== 'granted') {
      return { scheduled: 0, granted: false };
    }

    await ensureAndroidNotificationChannel();

    // Clear previously scheduled finance reminders managed by our app
    try {
      const pending = await LocalNotifications.getPending();
      const toCancel = (pending.notifications || []).filter((n) => n.id >= 100000 && n.id < 900000);
      if (toCancel.length > 0) {
        await LocalNotifications.cancel({
          notifications: toCancel.map((n) => ({ id: n.id })),
        });
      }
    } catch {
      // Ignore cancel errors on fresh install
    }

    const now = new Date();
    const nowMs = now.getTime();
    const remindDayBefore = state.uiSettings?.remindDayBefore !== false;
    const reminderHour = state.uiSettings?.reminderHour ?? 9;

    const upcoming = collectUpcomingReminders(state, 30, now);
    const toSchedule: LocalNotificationSchema[] = [];

    for (const rem of upcoming) {
      const dt = parseLocalIsoDate(rem.dateIso);
      if (!dt) continue;

      const amountSuffix = rem.amount && rem.amount > 0 ? ` · ${formatMoney(rem.amount)}` : '';

      // A) 1 day before ("Завтра: ...")
      if (remindDayBefore) {
        const dayBefore = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - 1, reminderHour, 0, 0);
        if (dayBefore.getTime() > nowMs + 15_000) {
          toSchedule.push({
            id: stableNotificationId(`${rem.id}|before1d`),
            title: `Завтра · ${rem.title}`,
            body: `${rem.subtitle}${amountSuffix}`,
            schedule: { at: dayBefore, allowWhileIdle: true },
            channelId: CHANNEL_ID,
            smallIcon: 'ic_stat_finance',
            iconColor: '#1FB892',
            extra: {
              targetTab: rem.targetTab,
              targetSectionId: rem.targetSectionId || '',
              dateIso: rem.dateIso,
            },
          });
        }
      }

      // B) On the event day (respecting task exact time & lead time if set)
      let eventHour = reminderHour;
      let eventMin = 0;
      if (rem.time && /^\d{1,2}:\d{2}$/.test(rem.time)) {
        const [hh, mm] = rem.time.split(':').map(Number);
        if (Number.isFinite(hh) && Number.isFinite(mm)) {
          eventHour = hh;
          eventMin = mm;
        }
      }
      const eventAtMs =
        new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), eventHour, eventMin, 0).getTime() -
        (rem.remindBeforeMin || 0) * 60 * 1000;

      if (eventAtMs > nowMs + 15_000) {
        toSchedule.push({
          id: stableNotificationId(`${rem.id}|ofday`),
          title: `Сегодня · ${rem.title}`,
          body: `${rem.subtitle}${amountSuffix}`,
          schedule: { at: new Date(eventAtMs), allowWhileIdle: true },
          channelId: CHANNEL_ID,
          smallIcon: 'ic_stat_finance',
          iconColor: '#1FB892',
          extra: {
            targetTab: rem.targetTab,
            targetSectionId: rem.targetSectionId || '',
            dateIso: rem.dateIso,
          },
        });
      }
    }

    // Sort chronologically and cap to MAX_NATIVE_NOTIFS
    toSchedule.sort((a, b) => {
      const ta = a.schedule?.at ? new Date(a.schedule.at).getTime() : 0;
      const tb = b.schedule?.at ? new Date(b.schedule.at).getTime() : 0;
      return ta - tb;
    });

    const batch = toSchedule.slice(0, MAX_NATIVE_NOTIFS);
    if (batch.length > 0) {
      await LocalNotifications.schedule({ notifications: batch });
    }

    return { scheduled: batch.length, granted: true };
  } catch {
    return { scheduled: 0, granted: false };
  }
}
