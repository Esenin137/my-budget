import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  CalendarCheck2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Monitor,
  Settings,
  ShoppingCart,
  Smartphone,
  Users,
  Wallet,
} from 'lucide-react';
import {
  AppState,
  CalendarTask,
  DepositItem,
  EncryptedPackage,
  FamilyNamedAmount,
  FontScale,
  GoalScope,
  PeriodMode,
  TabId,
  Transaction,
} from './types';
import {
  createInitialState,
  decryptPayload,
  hydrateState,
  isEncryptedPackage,
  isoDate,
  loadRawStoredPackage,
  normDate,
  persistAppState,
} from './utils/storage';
import {
  advanceRepeatDate,
  analyzeFinancialHealth,
  formatMoney,
  getPeriodTitle,
  getTasksForDate,
  isTaskDoneOnDate,
  isTaskOnDate,
  isTxInPeriod,
  parseLocalIsoDate,
  uid,
  UniversalCommandResult,
} from './utils/finance';
import { playReminderChime } from './utils/sound';
import PlannerTab from './components/PlannerTab';
import BudgetTab from './components/BudgetTab';
import ExpensesTab from './components/ExpensesTab';
import AdvisorTab from './components/AdvisorTab';
import FamilyTab from './components/FamilyTab';
import { HiddenSectionsContext } from './components/GlassSection';
import AppSettingsModal from './components/AppSettingsModal';
import TodayCalendarHub from './components/TodayCalendarHub';
import UniversalVoiceModal from './components/UniversalVoiceModal';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import {
  CategoriesModal,
  EditDepositModal,
  EditFamilyModal,
  EditTxModal,
  ModalShell,
  PeriodBreakdownModal,
  PinOverlay,
  ReminderAlertToast,
} from './components/Modals';

interface ToastState {
  message: string;
  undo?: () => void;
}

const ALL_SECTION_IDS = [
  'sec-inc-add',
  'sec-inc-list',
  'sec-goals-tank',
  'sec-deposits',
  'sec-security',
  'sec-exp-add',
  'sec-exp-list',
  'sec-charts',
  'sec-planner-cal',
  'sec-planner-notes',
  'sec-ai-doctor',
  'sec-habits',
  'sec-tips',
  'sec-fam-main',
  'sec-fam-rem',
  'sec-fam-hist',
];

const TAB_HEAD_META: Record<TabId, { title: string; accent: string }> = {
  budget: { title: 'Бюджет и Вклады', accent: '#10B981' },
  expenses: { title: 'Расходы и Чеки', accent: '#F06253' },
  planner: { title: 'Задачи и Заметки', accent: '#22D3EE' },
  advisor: { title: 'ИИ-Советник', accent: '#A78BFA' },
  family: { title: 'Семейный бюджет', accent: '#60A5FA' },
};

const NAV_ITEMS: { id: TabId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'budget', label: 'Бюджет', icon: Wallet },
  { id: 'expenses', label: 'Расходы', icon: ShoppingCart },
  { id: 'planner', label: 'Задачи', icon: CalendarCheck2 },
  { id: 'advisor', label: 'Советник', icon: Bot },
  { id: 'family', label: 'Семья', icon: Users },
];

const TAB_SECTIONS: Record<TabId, string[]> = {
  budget: ['sec-inc-add', 'sec-inc-list', 'sec-goals-tank', 'sec-deposits', 'sec-security'],
  expenses: ['sec-exp-add', 'sec-exp-list', 'sec-charts'],
  planner: ['sec-planner-cal', 'sec-planner-notes'],
  advisor: ['sec-ai-doctor', 'sec-habits', 'sec-tips'],
  family: ['sec-fam-main', 'sec-fam-rem', 'sec-fam-hist'],
};

const INITIAL_MOBILE_COLLAPSED = Object.values(TAB_SECTIONS).flatMap((secs) => secs.slice(1));

const PERIOD_LABELS: Record<PeriodMode, string> = {
  day: 'День',
  week: 'Неделя',
  month: 'Месяц',
  year: 'Год',
  custom: 'Даты',
};

export default function App() {
  const [state, setState] = useState<AppState>(() => createInitialState());
  const [storageReady, setStorageReady] = useState(false);
  const [activePin, setActivePin] = useState<string | null>(null);

  // Navigation, layout view mode (auto / mobile / desktop), smart accordion collapsed windows
  const [activeTab, setActiveTab] = useState<TabId>('budget');
  const [viewLayout, setViewLayout] = useState<'auto' | 'mobile' | 'desktop'>('auto');
  const [collapsedSecs, setCollapsedSecs] = useState<string[]>(() =>
    typeof window !== 'undefined' && window.innerWidth < 1020 ? INITIAL_MOBILE_COLLAPSED : []
  );
  const [showPeriodPicker, setShowPeriodPicker] = useState(false);

  // Period filters
  const [viewMode, setViewMode] = useState<PeriodMode>('month');
  const [curDate, setCurDate] = useState<Date>(() => new Date());
  const [customStart, setCustomStart] = useState<string>(() => {
    const n = new Date();
    return isoDate(new Date(n.getFullYear(), n.getMonth(), 1));
  });
  const [customEnd, setCustomEnd] = useState<string>(() => isoDate(new Date()));

  // PIN flow
  const [pinOverlayMode, setPinOverlayMode] = useState<'unlock' | 'set1' | 'set2' | 'disable' | null>(null);
  const [pinBuffer, setPinBuffer] = useState('');
  const [pinFirstCode, setPinFirstCode] = useState('');
  const [pinError, setPinError] = useState('');
  const [lockedPkg, setLockedPkg] = useState<EncryptedPackage | null>(null);
  const [showPinManageModal, setShowPinManageModal] = useState(false);

  // Modals
  const [breakdownModal, setBreakdownModal] = useState<{
    kind: 'in' | 'out' | 'left';
    scope: PeriodMode;
    dayIso: string;
    cat: string | null;
  } | null>(null);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [editingDeposit, setEditingDeposit] = useState<DepositItem | null>(null);
  const [editingFam, setEditingFam] = useState<{
    listKey: 'balances' | 'expenses' | 'loans';
    item: FamilyNamedAmount;
  } | null>(null);
  const [showCategoriesModal, setShowCategoriesModal] = useState(false);
  const [settingsModalTab, setSettingsModalTab] = useState<'layout' | 'ai' | null>(null);
  const [showUniversalVoice, setShowUniversalVoice] = useState(false);
  const [plannerFocusDate, setPlannerFocusDate] = useState<string | null>(null);
  const [viewingReceipt, setViewingReceipt] = useState<Transaction | null>(null);
  const [restorePkgPrompt, setRestorePkgPrompt] = useState<EncryptedPackage | null>(null);
  const [restorePassInp, setRestorePassInp] = useState('');
  const [restoreErr, setRestoreErr] = useState('');

  // Alerts & Toast
  const [activeAlertTask, setActiveAlertTask] = useState<CalendarTask | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const showToast = useCallback((message: string, undo?: () => void) => {
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    setToast({ message, undo });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, undo ? 6000 : 3500);
  }, []);

  // Sync active tab atmosphere, theme style & view layout to body attributes
  useEffect(() => {
    document.body.setAttribute('data-tab', activeTab);
  }, [activeTab]);

  useEffect(() => {
    const theme = state.uiSettings.themeStyle || 'premium';
    document.body.setAttribute('data-theme', theme);
  }, [state.uiSettings.themeStyle]);

  useEffect(() => {
    if (viewLayout === 'auto') document.body.removeAttribute('data-view');
    else document.body.setAttribute('data-view', viewLayout);
  }, [viewLayout]);

  useEffect(() => {
    const sc = state.fontScale || 'normal';
    if (sc === 'normal') document.documentElement.removeAttribute('data-fsize');
    else document.documentElement.setAttribute('data-fsize', sc);
  }, [state.fontScale]);

  const visibleNavItems = useMemo(
    () => NAV_ITEMS.filter((item) => state.uiSettings.visibleTabs[item.id]),
    [state.uiSettings.visibleTabs]
  );

  // If the user hides the currently active tab, jump cleanly to the first visible tab
  useEffect(() => {
    if (!state.uiSettings.visibleTabs[activeTab] && visibleNavItems.length > 0) {
      setActiveTab(visibleNavItems[0].id);
    }
  }, [activeTab, state.uiSettings.visibleTabs, visibleNavItems]);

  // Load state on mount
  useEffect(() => {
    let mounted = true;
    loadRawStoredPackage().then((pkg) => {
      if (!mounted) return;
      if (isEncryptedPackage(pkg)) {
        setLockedPkg(pkg);
        setPinOverlayMode('unlock');
      } else if (pkg) {
        setState(hydrateState(pkg));
        setStorageReady(true);
      } else {
        setStorageReady(true);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  const commitState = useCallback(
    (updater: (prev: AppState) => AppState) => {
      setState((prev) => {
        const next = updater(prev);
        if (storageReady) persistAppState(next, activePin);
        return next;
      });
    },
    [storageReady, activePin]
  );

  // Reminder ticker every 15s (supports repeating tasks and remindBeforeMin lead times)
  useEffect(() => {
    if (!storageReady) return;
    const checkReminders = () => {
      const now = new Date();
      const nowMs = now.getTime();
      const candidateDays = [0, 1, 2].map((d) =>
        isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + d))
      );

      let found: { task: CalendarTask; occIso: string; notifKey: string } | null = null;

      for (const t of state.tasks) {
        if (!t.notify || !t.time) continue;
        if (t.snoozedUntil && nowMs < t.snoozedUntil) continue;

        const datesToCheck =
          t.repeat && t.repeat !== 'none'
            ? candidateDays
            : Array.from(new Set([t.date, ...candidateDays]));

        for (const occIso of datesToCheck) {
          if (!isTaskOnDate(t, occIso)) continue;
          if (isTaskDoneOnDate(t, occIso)) continue;

          const notifKey = `${occIso}|${t.time}`;
          if (
            !t.snoozedUntil &&
            t.notifiedAt &&
            (t.notifiedAt === notifKey || t.notifiedAt.startsWith(occIso))
          ) {
            continue;
          }

          const [oy, om, od] = occIso.split('-').map(Number);
          const [hh, mm] = t.time.split(':').map(Number);
          const occMs = new Date(oy, om - 1, od, hh || 9, mm || 0, 0).getTime();
          const leadMs = (t.remindBeforeMin || 0) * 60 * 1000;
          const triggerMs = occMs - leadMs;

          if (nowMs >= triggerMs) {
            found = { task: t, occIso, notifKey };
            break;
          }
        }
        if (found) break;
      }

      if (found) {
        const { task: due, occIso, notifKey } = found;
        playReminderChime();
        setActiveAlertTask({ ...due, date: occIso });
        commitState((prev) => ({
          ...prev,
          tasks: prev.tasks.map((t) =>
            t.id === due.id ? { ...t, notifiedAt: notifKey, snoozedUntil: null } : t
          ),
        }));
        if ('Notification' in window && Notification.permission === 'granted') {
          try {
            new Notification('Мои финансы — Напоминание', {
              body: `${due.time ? `${due.time} · ` : ''}${due.title}`,
              icon: `${import.meta.env.BASE_URL}pwa-192x192.png`,
            });
          } catch {
            // In-app alert already shown
          }
        }
      }
    };

    checkReminders();
    const timer = window.setInterval(checkReminders, 15000);
    return () => window.clearInterval(timer);
  }, [storageReady, state.tasks, commitState]);

  // Recurring transactions due (timezone-safe local dates + month-end clamp + loop guard)
  const dueRecurring = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = isoDate(today);
    const items: { parent: Transaction; next: Date; nextIso: string }[] = [];

    const existingChildDatesByParent = new Map<number, Set<string>>();
    const latestDateByParent = new Map<number, string>();

    state.tx.forEach((x) => {
      if (!x.parentId) return;
      const dIso = normDate(x.d);
      let set = existingChildDatesByParent.get(x.parentId);
      if (!set) {
        set = new Set<string>();
        existingChildDatesByParent.set(x.parentId, set);
      }
      set.add(dIso);
      const prevMax = latestDateByParent.get(x.parentId);
      if (!prevMax || dIso > prevMax) latestDateByParent.set(x.parentId, dIso);
    });

    state.tx.forEach((t) => {
      if (!t.repeat || t.repeat === 'none' || t.parentId) return;
      const baseDt = parseLocalIsoDate(t.d);
      if (!baseDt) return;

      const baseY = baseDt.getFullYear();
      const baseM = baseDt.getMonth();
      const baseD = baseDt.getDate();
      const baseIso = isoDate(baseDt);
      const existingSet = existingChildDatesByParent.get(t.id);
      const watermarkIso = latestDateByParent.get(t.id) || baseIso;

      for (let step = 1; step <= 500; step++) {
        const occ = advanceRepeatDate(baseY, baseM, baseD, step, t.repeat);
        const occIso = isoDate(occ);
        if (occIso > todayIso) break;
        if (occIso <= watermarkIso) continue;
        if (existingSet?.has(occIso)) continue;
        items.push({ parent: t, next: occ, nextIso: occIso });
      }
    });

    return items;
  }, [state.tx]);

  const handleApplyRecurring = () => {
    if (!dueRecurring.length) return;
    let addedCount = 0;
    const base = uid();
    commitState((prev) => {
      const existingKeys = new Set<string>();
      prev.tx.forEach((x) => {
        if (x.parentId) existingKeys.add(`${x.parentId}:${normDate(x.d)}`);
      });
      const additions: Transaction[] = [];
      dueRecurring.forEach((item, idx) => {
        const key = `${item.parent.id}:${item.nextIso}`;
        if (existingKeys.has(key)) return;
        existingKeys.add(key);
        additions.push({
          id: base + idx,
          parentId: item.parent.id,
          t: 'out',
          a: item.parent.a,
          c: item.parent.c,
          m: item.parent.m,
          d: item.nextIso,
          n: `${item.parent.n} (авто)`,
        });
      });
      addedCount = additions.length;
      if (!additions.length) return prev;
      return { ...prev, tx: [...prev.tx, ...additions] };
    });
    if (addedCount > 0) {
      showToast(`Проведено платежей: ${addedCount}`);
    }
  };

  const periodTx = useMemo(
    () => state.tx.filter((t) => isTxInPeriod(t.d, viewMode, curDate, customStart, customEnd)),
    [state.tx, viewMode, curDate, customStart, customEnd]
  );
  const periodInTx = useMemo(
    () =>
      periodTx
        .filter((t) => t.t === 'in')
        .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.id - a.id)),
    [periodTx]
  );
  const periodOutTx = useMemo(
    () =>
      periodTx
        .filter((t) => t.t !== 'in')
        .sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : b.id - a.id)),
    [periodTx]
  );
  const health = useMemo(() => analyzeFinancialHealth(periodTx, curDate), [periodTx, curDate]);

  const shiftPeriod = (dir: -1 | 1) => {
    setCurDate((prev) => {
      if (viewMode === 'day') {
        return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + dir);
      }
      if (viewMode === 'week') {
        return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + dir * 7);
      }
      if (viewMode === 'month') {
        return new Date(prev.getFullYear(), prev.getMonth() + dir, 1);
      }
      if (viewMode === 'year') {
        const targetYear = prev.getFullYear() + dir;
        const maxDay = new Date(targetYear, prev.getMonth() + 1, 0).getDate();
        return new Date(targetYear, prev.getMonth(), Math.min(prev.getDate(), maxDay));
      }
      return new Date(prev.getFullYear(), prev.getMonth(), prev.getDate());
    });
  };

  const isDesktopVisual =
    viewLayout === 'desktop' ||
    (viewLayout === 'auto' && typeof window !== 'undefined' && window.innerWidth >= 1020);

  const toggleSection = (id: string) => {
    setCollapsedSecs((prev) => {
      const isCurrentlyCollapsed = prev.includes(id);
      if (!isCurrentlyCollapsed) {
        return [...prev, id];
      }
      // On mobile, behave as a clean accordion inside each tab so opening sections never creates an endless scroll wall
      if (!isDesktopVisual) {
        const ownerGroup = Object.values(TAB_SECTIONS).find((group) => group.includes(id));
        if (ownerGroup) {
          const siblingsToCollapse = ownerGroup.filter((sec) => sec !== id);
          const withoutThis = prev.filter((x) => x !== id);
          return Array.from(new Set([...withoutThis, ...siblingsToCollapse]));
        }
      }
      return prev.filter((x) => x !== id);
    });
  };

  const getVisibleTabSections = (tabId: TabId) =>
    TAB_SECTIONS[tabId].filter((secId) => {
      if (state.uiSettings.hiddenSections.includes(secId)) return false;
      if (secId === 'sec-ai-doctor' && !state.uiSettings.aiEnabled) return false;
      return true;
    });

  const isTabAllCollapsed = (tabId: TabId) => {
    const secs = getVisibleTabSections(tabId);
    return secs.length > 0 && secs.every((secId) => collapsedSecs.includes(secId));
  };

  const handleFoldTab = (tabId: TabId) => {
    const secs = getVisibleTabSections(tabId);
    if (secs.length === 0) return;
    const allFolded = secs.every((secId) => collapsedSecs.includes(secId));
    setCollapsedSecs((prev) =>
      allFolded
        ? prev.filter((id) => !secs.includes(id))
        : Array.from(new Set([...prev, ...secs]))
    );
  };

  const renderTabHead = (tabId: TabId) => {
    const meta = TAB_HEAD_META[tabId];
    const visibleCount = getVisibleTabSections(tabId).length;
    const allFolded = isTabAllCollapsed(tabId);
    return (
      <div className="col-head">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2 h-2 rounded-full shrink-0"
            style={{ backgroundColor: meta.accent }}
            aria-hidden="true"
          />
          <span className="truncate">{meta.title}</span>
        </div>
        {visibleCount > 0 && (
          <button
            type="button"
            onClick={() => handleFoldTab(tabId)}
            className="fold-tab-btn"
            title={
              allFolded
                ? `Раскрыть все окна в разделе «${meta.title}»`
                : `Свернуть все окна в разделе «${meta.title}»`
            }
          >
            {allFolded ? (
              <>
                <ChevronsDown className="w-3.5 h-3.5" />
                <span>Раскрыть всё</span>
              </>
            ) : (
              <>
                <ChevronsUp className="w-3.5 h-3.5" />
                <span>Свернуть всё</span>
              </>
            )}
          </button>
        )}
      </div>
    );
  };

  const handleToggleViewLayout = () => {
    const currentlyDesktop =
      viewLayout === 'desktop' || (viewLayout === 'auto' && window.innerWidth >= 1020);
    const next = currentlyDesktop ? 'mobile' : 'desktop';
    setViewLayout(next);
    if (next === 'mobile') {
      setCollapsedSecs(INITIAL_MOBILE_COLLAPSED);
    }
  };

  const handlePinDigit = async (digit: string) => {
    if (pinBuffer.length >= 4 || !pinOverlayMode) return;
    const nextCode = pinBuffer + digit;
    setPinBuffer(nextCode);
    setPinError('');
    if (nextCode.length < 4) return;

    const mode = pinOverlayMode;
    setTimeout(async () => {
      setPinBuffer('');
      if (mode === 'unlock' && lockedPkg) {
        try {
          const dec = await decryptPayload<AppState>(lockedPkg, nextCode);
          setActivePin(nextCode);
          setLockedPkg(null);
          setState(hydrateState(dec));
          setStorageReady(true);
          setPinOverlayMode(null);
        } catch {
          setPinError('❌ Неверный ПИН-код.');
        }
      } else if (mode === 'set1') {
        setPinFirstCode(nextCode);
        setPinOverlayMode('set2');
      } else if (mode === 'set2') {
        if (nextCode !== pinFirstCode) {
          setPinError('ПИН-коды не совпали.');
          setPinOverlayMode('set1');
          return;
        }
        setActivePin(nextCode);
        await persistAppState(state, nextCode);
        setPinOverlayMode(null);
        showToast('🔒 ПИН-код установлен (AES-GCM-256).');
      } else if (mode === 'disable') {
        if (nextCode !== activePin) {
          setPinError('❌ Неверный текущий ПИН.');
          return;
        }
        setActivePin(null);
        await persistAppState(state, null);
        setPinOverlayMode(null);
        showToast('🔓 ПИН-код отключён.');
      }
    }, 100);
  };

  const handleImportJsonFile = (file: File, passHint: string) => {
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const parsed = JSON.parse(String(ev.target?.result || ''));
        if (isEncryptedPackage(parsed)) {
          const tryPw = passHint || activePin || '';
          if (tryPw) {
            try {
              const dec = await decryptPayload<AppState>(parsed, tryPw);
              const nextState = hydrateState(dec);
              setState(nextState);
              await persistAppState(nextState, activePin);
              showToast('✅ Зашифрованная копия восстановлена!');
              return;
            } catch {
              // Prompt password
            }
          }
          setRestorePkgPrompt(parsed);
          setRestorePassInp('');
          setRestoreErr('');
        } else if (parsed && Array.isArray(parsed.tx)) {
          const nextState = hydrateState(parsed);
          setState(nextState);
          await persistAppState(nextState, activePin);
          showToast('✅ Данные восстановлены из JSON!');
        } else {
          showToast('Неверный формат файла копии.');
        }
      } catch {
        showToast('Ошибка чтения файла.');
      }
    };
    reader.readAsText(file);
  };

  const handleCycleFont = () => {
    const order: FontScale[] = ['normal', 'lg', 'xl'];
    const next = order[(order.indexOf(state.fontScale || 'normal') + 1) % order.length];
    commitState((prev) => ({ ...prev, fontScale: next }));
  };

  const fontLabel =
    state.fontScale === 'xl' ? '🔍 А+++' : state.fontScale === 'lg' ? '🔍 А++' : '🔍 А+';

  const openTasksTodayCount = useMemo(() => {
    const td = isoDate(new Date());
    return getTasksForDate(state.tasks, td).filter((t) => !isTaskDoneOnDate(t, td)).length;
  }, [state.tasks]);

  const handleNavigateFromHub = useCallback(
    (tab: TabId, jumpDateIso?: string, targetSectionId?: string) => {
      if (!state.uiSettings.visibleTabs[tab]) {
        commitState((prev) => ({
          ...prev,
          uiSettings: {
            ...prev.uiSettings,
            visibleTabs: { ...prev.uiSettings.visibleTabs, [tab]: true },
          },
        }));
      }
      setActiveTab(tab);
      const secToOpen = targetSectionId || TAB_SECTIONS[tab][0];
      if (secToOpen) {
        setCollapsedSecs((prev) => {
          const withoutTarget = prev.filter((id) => id !== secToOpen);
          if (!isDesktopVisual) {
            const siblings = TAB_SECTIONS[tab].filter((id) => id !== secToOpen);
            return Array.from(new Set([...withoutTarget, ...siblings]));
          }
          return withoutTarget;
        });
      }
      if (jumpDateIso && /^\d{4}-\d{2}-\d{2}$/.test(jumpDateIso)) {
        const [y, m, d] = jumpDateIso.split('-').map(Number);
        if (tab === 'planner') {
          setPlannerFocusDate(jumpDateIso);
        } else {
          setCurDate(new Date(y, m - 1, d));
        }
      }
    },
    [state.uiSettings.visibleTabs, commitState, isDesktopVisual]
  );

  const handleExecuteUniversalCommand = useCallback(
    (cmd: UniversalCommandResult) => {
      if (cmd.kind === 'expense') {
        const baseId = uid();
        const additions: Transaction[] = cmd.items.map((item, idx) => ({
          id: baseId + idx,
          t: 'out',
          a: item.a,
          c: item.c,
          m: cmd.method,
          d: cmd.date,
          n: item.n,
        }));
        if (additions.length === 0) return;
        commitState((prev) => ({ ...prev, tx: [...prev.tx, ...additions] }));
        const [y, m, d] = cmd.date.split('-').map(Number);
        setCurDate(new Date(y, m - 1, d));
        setShowUniversalVoice(false);
        const total = additions.reduce((acc, x) => acc + x.a, 0);
        showToast(`💸 Записано в расходы: ${formatMoney(total)}`);
      } else if (cmd.kind === 'income') {
        const tx: Transaction = {
          id: uid(),
          t: 'in',
          a: cmd.amount,
          c: cmd.category,
          m: 'Карта',
          d: cmd.date,
          n: cmd.title,
        };
        commitState((prev) => ({ ...prev, tx: [...prev.tx, tx] }));
        const [y, m, d] = cmd.date.split('-').map(Number);
        setCurDate(new Date(y, m - 1, d));
        setShowUniversalVoice(false);
        showToast(`💰 Доход записан: +${formatMoney(cmd.amount)}`);
      } else if (cmd.kind === 'task') {
        const nextTask: CalendarTask = {
          id: uid(),
          date: cmd.date,
          time: cmd.time || undefined,
          title: cmd.title,
          done: false,
          notify: Boolean(cmd.time || cmd.remindBeforeMin > 0),
          notifiedAt: null,
          snoozedUntil: null,
          repeat: cmd.repeat,
          remindBeforeMin: cmd.remindBeforeMin,
          amount: cmd.amount,
          completedDates: [],
          createdAt: Date.now(),
        };
        commitState((prev) => ({ ...prev, tasks: [...prev.tasks, nextTask] }));
        setPlannerFocusDate(cmd.date);
        setShowUniversalVoice(false);
        showToast(`📅 Задача добавлена: ${cmd.title}`);
      } else if (cmd.kind === 'shopping') {
        const now = Date.now();
        const newItems = cmd.items.map((text, idx) => ({
          id: uid() + idx,
          kind: 'text' as const,
          createdAt: now - idx,
          text,
          checked: false,
        }));
        commitState((prev) => {
          const shopTab =
            prev.noteTabs.find((t) => t.tabType === 'shopping') || prev.noteTabs[0];
          if (!shopTab) return prev;
          return {
            ...prev,
            activeNoteTabId: shopTab.id,
            noteTabs: prev.noteTabs.map((t) =>
              t.id === shopTab.id ? { ...t, items: [...newItems, ...t.items] } : t
            ),
          };
        });
        setShowUniversalVoice(false);
        showToast(`🛒 Добавлено в список покупок: ${cmd.items.length}`);
      } else if (cmd.kind === 'habit') {
        commitState((prev) => ({
          ...prev,
          habits: [
            ...(prev.habits || []),
            {
              id: uid(),
              title: cmd.title,
              icon: cmd.icon,
              completedDates: [],
              createdAt: Date.now(),
            },
          ],
        }));
        setShowUniversalVoice(false);
        showToast(`🌱 Привычка добавлена: ${cmd.icon} ${cmd.title}`);
      }
    },
    [commitState, showToast]
  );

  return (
    <div className="app-shell">
      {/* ЧИСТАЯ ПРЕМИАЛЬНАЯ ШАПКА (1 СТРОКА БЕЗ НАГРОМОЖДЕНИЯ + ЦЕНТР «СЕГОДНЯ») */}
      <div className="hero">
        <header className="top-bar">
          <div className="brand-row">
            <div className="brand-wordmark">
              <img
                src={`${import.meta.env.BASE_URL}pwa-192x192.png`}
                alt="Мои финансы"
                className="brand-icon"
                referrerPolicy="no-referrer"
              />
              <span>Мои финансы</span>
            </div>

            <div className="top-actions">
              <PWAInstallButton variant="icon" onInstalledToast={showToast} />
              <button
                type="button"
                onClick={handleToggleViewLayout}
                className={`icon-action-btn ${viewLayout !== 'auto' ? 'active' : ''}`}
                title={isDesktopVisual ? 'Переключить на вид «Телефон»' : 'Переключить на вид «ПК»'}
                aria-label="Переключить вид Телефон или ПК"
              >
                {isDesktopVisual ? (
                  <Smartphone className="w-4 h-4" />
                ) : (
                  <Monitor className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => setSettingsModalTab('layout')}
                className={`icon-action-btn ${
                  activePin || state.uiSettings.hiddenSections.length > 0 ? 'active' : ''
                }`}
                title="Настройки приложения, ПИН, шрифт и ИИ"
                aria-label="Настройки приложения"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>
        </header>

        {dueRecurring.length > 0 && (
          <div className="recurring-banner">
            <span>Регулярных платежей к проводке: {dueRecurring.length}</span>
            <button
              type="button"
              onClick={handleApplyRecurring}
              className="fin-btn sm"
            >
              Провести
            </button>
          </div>
        )}

        {/* ЗАКРЕПЛЁННЫЙ МИНИ-ЭКРАН «СЕГОДНЯ / НЕДЕЛЯ / МЕСЯЦ» И ЕДИНЫЙ КАЛЕНДАРЬ */}
        {state.uiSettings.heroTodayHub && (
          <TodayCalendarHub
            state={state}
            curDate={curDate}
            periodTx={periodTx}
            showSafePill={state.uiSettings.heroSafePill}
            onNavigateToTab={handleNavigateFromHub}
            onOpenUniversalVoice={() => setShowUniversalVoice(true)}
          />
        )}
      </div>

      {/* КОМПАКТНАЯ СТРОКА ВЫБОРА ПЕРИОДА (ПОКАЗЫВАЕТСЯ АККУРАТНО ДЛЯ ФИНАНСОВЫХ РАЗДЕЛОВ) */}
      {(isDesktopVisual || activeTab !== 'planner') && (
        <div className="hub-wrap max-w-[1560px] w-full mx-auto px-3.5 mb-2.5">
          <div className="period-bar-card">
            <div className="period-head-row">
              <div className="flex items-center gap-2 min-w-0">
                <div className="period-stepper">
                  <button
                    type="button"
                    className="period-step-btn"
                    onClick={() => shiftPeriod(-1)}
                    aria-label="Предыдущий период"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-xs font-bold text-slate-200 px-1.5 tabular-nums whitespace-nowrap">
                    {getPeriodTitle(viewMode, curDate, customStart, customEnd)}
                  </span>
                  <button
                    type="button"
                    className="period-step-btn"
                    onClick={() => shiftPeriod(1)}
                    aria-label="Следующий период"
                  >
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowPeriodPicker((v) => !v)}
                className="h-7 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-[11px] font-bold text-slate-200 inline-flex items-center gap-1 cursor-pointer shrink-0 transition"
              >
                <span>{PERIOD_LABELS[viewMode]}</span>
                <ChevronDown
                  className={`w-3 h-3 transition-transform ${showPeriodPicker ? 'rotate-180' : ''}`}
                />
              </button>
            </div>

            {showPeriodPicker && (
              <div className="nav-period" role="group" aria-label="Выбор периода">
                {(['day', 'week', 'month', 'year', 'custom'] as PeriodMode[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => {
                      setViewMode(m);
                      if (m !== 'custom') setShowPeriodPicker(false);
                    }}
                    className={`nav-btn ${viewMode === m ? 'active' : ''}`}
                  >
                    {PERIOD_LABELS[m]}
                  </button>
                ))}
              </div>
            )}

            {viewMode === 'custom' && (
              <div className="custom-range-bar">
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  С:
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(normDate(e.target.value))}
                    className="fin-input"
                    style={{ padding: '4px 7px', fontSize: '.76rem' }}
                  />
                </label>
                <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                  По:
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(normDate(e.target.value))}
                    className="fin-input"
                    style={{ padding: '4px 7px', fontSize: '.76rem' }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* РАБОЧАЯ ОБЛАСТЬ: НАСТРАИВАЕМЫЕ РАЗДЕЛЫ (ВКЛАДКИ НА ТЕЛЕФОНЕ / КОЛОНКИ НА ПК) */}
      <HiddenSectionsContext.Provider value={state.uiSettings.hiddenSections}>
      <main
        className="workspace"
        style={{ ['--col-count' as string]: Math.max(1, visibleNavItems.length) }}
      >
        {state.uiSettings.visibleTabs.budget && (
        <div className={`tab-pane ${activeTab === 'budget' ? 'active' : ''}`} id="pane-budget">
          {renderTabHead('budget')}
          <BudgetTab
            state={state}
            curDate={curDate}
            periodInTx={periodInTx}
            sumIn={health.sumIn}
            sumOut={health.sumOut}
            left={health.left}
            safeDaily={health.safeDaily}
            showSummaryStrip={state.uiSettings.heroSummaryStrip}
            showSafePill={state.uiSettings.heroSafePill}
            activePin={activePin}
            collapsedSecs={collapsedSecs}
            onToggleSec={toggleSection}
            onOpenSummaryBreakdown={(kind) =>
              setBreakdownModal({ kind, scope: viewMode, dayIso: isoDate(curDate), cat: null })
            }
            onAddIncome={(tx) => {
              commitState((prev) => ({ ...prev, tx: [...prev.tx, tx] }));
              const [y, m, d] = tx.d.split('-').map(Number);
              setCurDate(new Date(y, m - 1, d));
              showToast(`Доход сохранён: +${formatMoney(tx.a)}`);
            }}
            onDeleteTx={(id) => {
              commitState((prev) => ({ ...prev, tx: prev.tx.filter((x) => x.id !== id) }));
              showToast('Запись удалена');
            }}
            onEditTx={(tx) => setEditingTx(tx)}
            onUpdateGoals={(scope: GoalScope, limit: number, target: number) => {
              commitState((prev) => ({
                ...prev,
                periodGoals: { ...prev.periodGoals, [scope]: { limit, target } },
              }));
            }}
            onAddDeposit={(dep) => {
              commitState((prev) => ({ ...prev, deposits: [...prev.deposits, dep] }));
              showToast('Вклад добавлен!');
            }}
            onDeleteDeposit={(id) =>
              commitState((prev) => ({
                ...prev,
                deposits: prev.deposits.filter((d) => d.id !== id),
              }))
            }
            onEditDeposit={(dep) => setEditingDeposit(dep)}
            onOpenPinManager={() =>
              activePin ? setShowPinManageModal(true) : setPinOverlayMode('set1')
            }
            onImportJsonFile={handleImportJsonFile}
            onShowToast={showToast}
          />
        </div>
        )}

        {state.uiSettings.visibleTabs.expenses && (
        <div className={`tab-pane ${activeTab === 'expenses' ? 'active' : ''}`} id="pane-expenses">
          {renderTabHead('expenses')}
          <ExpensesTab
            cats={state.cats}
            curDate={curDate}
            viewMode={viewMode}
            periodOutTx={periodOutTx}
            collapsedSecs={collapsedSecs}
            onToggleSec={toggleSection}
            onSaveExpenses={(items, jumpDate) => {
              commitState((prev) => ({ ...prev, tx: [...prev.tx, ...items] }));
              const [y, m, d] = jumpDate.split('-').map(Number);
              setCurDate(new Date(y, m - 1, d));
              showToast(`Сохранено трат: ${items.length}`);
            }}
            onDeleteTx={(id) => {
              commitState((prev) => ({ ...prev, tx: prev.tx.filter((x) => x.id !== id) }));
              showToast('Трата удалена');
            }}
            onEditTx={(tx) => setEditingTx(tx)}
            onStopRepeat={(id) => {
              commitState((prev) => ({
                ...prev,
                tx: prev.tx.map((x) => (x.id === id ? { ...x, repeat: 'none' } : x)),
              }));
              showToast('Автоповтор остановлен');
            }}
            onOpenCategories={() => setShowCategoriesModal(true)}
            onOpenReceipt={(tx) => setViewingReceipt(tx)}
            onOpenBreakdown={() =>
              setBreakdownModal({ kind: 'out', scope: viewMode, dayIso: isoDate(curDate), cat: null })
            }
            onOpenCategoryBreakdown={(cat) =>
              setBreakdownModal({
                kind: 'out',
                scope: viewMode === 'day' ? 'day' : 'month',
                dayIso: isoDate(curDate),
                cat,
              })
            }
            onOpenDayBreakdown={(dayIso) =>
              setBreakdownModal({ kind: 'out', scope: 'day', dayIso, cat: null })
            }
          />
        </div>
        )}

        {state.uiSettings.visibleTabs.planner && (
        <div className={`tab-pane ${activeTab === 'planner' ? 'active' : ''}`} id="pane-planner">
          {renderTabHead('planner')}
          <PlannerTab
            state={state}
            tasks={state.tasks}
            noteTabs={state.noteTabs}
            activeNoteTabId={state.activeNoteTabId}
            focusDateIso={plannerFocusDate}
            collapsedSecs={collapsedSecs}
            onToggleSec={toggleSection}
            onUpdateTasks={(nextTasks) => commitState((prev) => ({ ...prev, tasks: nextTasks }))}
            onUpdateNotes={(tabs, activeTabId) =>
              commitState((prev) => ({ ...prev, noteTabs: tabs, activeNoteTabId: activeTabId }))
            }
            onAddExpenseFromPlanner={(tx) => {
              commitState((prev) => ({ ...prev, tx: [...prev.tx, tx] }));
              showToast(`💸 Расход записан: ${tx.n || tx.c} (${formatMoney(tx.a)})`);
            }}
            onShowToast={showToast}
            onTestReminder={(sampleTitle) => {
              playReminderChime();
              setActiveAlertTask({
                id: -1,
                date: isoDate(new Date()),
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                title: sampleTitle,
                done: false,
                notify: true,
                createdAt: Date.now(),
              });
            }}
          />
        </div>
        )}

        {state.uiSettings.visibleTabs.advisor && (
        <div className={`tab-pane ${activeTab === 'advisor' ? 'active' : ''}`} id="pane-advisor">
          {renderTabHead('advisor')}
          <AdvisorTab
            state={state}
            curDate={curDate}
            viewMode={viewMode}
            periodTx={periodTx}
            collapsedSecs={collapsedSecs}
            uiSettings={state.uiSettings}
            onToggleSec={toggleSection}
            onApplyAdvisorPatch={(patch) => commitState((prev) => ({ ...prev, ...patch }))}
            onOpenAiSettings={() => setSettingsModalTab('ai')}
          />
        </div>
        )}

        {state.uiSettings.visibleTabs.family && (
        <div className={`tab-pane ${activeTab === 'family' ? 'active' : ''}`} id="pane-family">
          {renderTabHead('family')}
          <FamilyTab
            family={state.family}
            curDate={curDate}
            allTx={state.tx}
            collapsedSecs={collapsedSecs}
            onToggleSec={toggleSection}
            onUpdateFamily={(nextFam) => commitState((prev) => ({ ...prev, family: nextFam }))}
            onEditFamilyItem={(listKey, item) => setEditingFam({ listKey, item })}
            onShowToast={showToast}
          />
        </div>
        )}
      </main>
      </HiddenSectionsContext.Provider>

      {/* ПАРЯЩАЯ НИЖНЯЯ ДОК-ПАНЕЛЬ (АДАПТИВНОЕ ЧИСЛО ВКЛАДОК) */}
      <nav
        className="bottom-tabs"
        aria-label="Навигация"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, visibleNavItems.length)}, 1fr)` }}
      >
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setActiveTab(item.id)}
              className={`tab-btn ${active ? 'active' : ''}`}
            >
              <span className="ti">
                <Icon className="w-[18px] h-[18px]" />
              </span>
              <span className="truncate max-w-full">
                {item.label}
                {item.id === 'planner' && openTasksTodayCount > 0 ? ` (${openTasksTodayCount})` : ''}
              </span>
            </button>
          );
        })}
      </nav>

      {/* БАННЕР ОПОВЕЩЕНИЯ ЕЖЕДНЕВНИКА */}
      {activeAlertTask && (
        <ReminderAlertToast
          task={activeAlertTask}
          onComplete={(id) => {
            if (id > 0) {
              const occDate = activeAlertTask.date;
              commitState((prev) => ({
                ...prev,
                tasks: prev.tasks.map((t) => {
                  if (t.id !== id) return t;
                  if (t.repeat && t.repeat !== 'none') {
                    const prevDates = Array.isArray(t.completedDates) ? t.completedDates : [];
                    return { ...t, completedDates: Array.from(new Set([...prevDates, occDate])) };
                  }
                  return { ...t, done: true };
                }),
              }));
            }
            setActiveAlertTask(null);
          }}
          onSnooze={(id) => {
            if (id > 0) {
              const snoozedUntil = Date.now() + 15 * 60 * 1000;
              commitState((prev) => ({
                ...prev,
                tasks: prev.tasks.map((t) =>
                  t.id === id ? { ...t, snoozedUntil, notifiedAt: null } : t
                ),
              }));
              showToast('Отложено на 15 минут');
            }
            setActiveAlertTask(null);
          }}
          onDismiss={() => setActiveAlertTask(null)}
        />
      )}

      {/* ИНДИКАТОР ОФЛАЙН-РЕЖИМА (ПОЯВЛЯЕТСЯ ТОЛЬКО БЕЗ СЕТИ) */}
      <OfflineIndicator />

      {/* УВЕДОМЛЕНИЕ С КНОПКОЙ «ОТМЕНИТЬ» */}
      {toast && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[85] max-w-[92vw] rounded-2xl bg-[#132623] border border-white/20 px-4 py-2.5 shadow-2xl flex items-center gap-3 text-xs font-semibold text-white">
          <span>{toast.message}</span>
          {toast.undo && (
            <button
              type="button"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
              className="fin-btn sm"
              style={{ padding: '4px 9px' }}
            >
              Отменить
            </button>
          )}
        </div>
      )}

      {/* ПИН-КОД */}
      {pinOverlayMode && (
        <PinOverlay
          mode={pinOverlayMode}
          errorText={pinError}
          filledCount={pinBuffer.length}
          onDigit={handlePinDigit}
          onBackspace={() => setPinBuffer((p) => p.slice(0, -1))}
          onCancel={
            pinOverlayMode === 'unlock'
              ? undefined
              : () => {
                  setPinOverlayMode(null);
                  setPinBuffer('');
                  setPinError('');
                }
          }
        />
      )}

      {showPinManageModal && (
        <ModalShell title="🔐 Управление ПИН-кодом" onClose={() => setShowPinManageModal(false)}>
          <p className="fin-sub mb-3">
            Данные зашифрованы алгоритмом AES-GCM-256 на вашем устройстве.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowPinManageModal(false);
                setPinOverlayMode('set1');
              }}
              className="fin-btn sm flex-1"
            >
              Изменить ПИН
            </button>
            <button
              type="button"
              onClick={() => {
                setShowPinManageModal(false);
                setPinOverlayMode('disable');
              }}
              className="fin-btn danger sm flex-1"
            >
              Отключить ПИН
            </button>
          </div>
        </ModalShell>
      )}

      {breakdownModal && (
        <PeriodBreakdownModal
          kind={breakdownModal.kind}
          initialScope={breakdownModal.scope}
          dayIso={breakdownModal.dayIso}
          initialCategory={breakdownModal.cat}
          allTx={state.tx}
          customStart={customStart}
          customEnd={customEnd}
          onClose={() => setBreakdownModal(null)}
          onEditTx={(tx) => setEditingTx(tx)}
          onDeleteTx={(id) => {
            commitState((prev) => ({ ...prev, tx: prev.tx.filter((x) => x.id !== id) }));
            showToast('Запись удалена');
          }}
        />
      )}

      {editingTx && (
        <EditTxModal
          tx={editingTx}
          cats={state.cats}
          onClose={() => setEditingTx(null)}
          onSave={(updated) => {
            commitState((prev) => ({
              ...prev,
              tx: prev.tx.map((x) => (x.id === updated.id ? updated : x)),
            }));
            setEditingTx(null);
            showToast('Изменения сохранены');
          }}
        />
      )}

      {editingDeposit && (
        <EditDepositModal
          deposit={editingDeposit}
          onClose={() => setEditingDeposit(null)}
          onSave={(updated) => {
            commitState((prev) => ({
              ...prev,
              deposits: prev.deposits.map((d) => (d.id === updated.id ? updated : d)),
            }));
            setEditingDeposit(null);
            showToast('Вклад обновлён');
          }}
        />
      )}

      {editingFam && (
        <EditFamilyModal
          listKey={editingFam.listKey}
          item={editingFam.item}
          onClose={() => setEditingFam(null)}
          onSave={(key, updated) => {
            commitState((prev) => ({
              ...prev,
              family: {
                ...prev.family,
                [key]: prev.family[key].map((x) => (x.id === updated.id ? updated : x)),
              },
            }));
            setEditingFam(null);
            showToast('Запись обновлена');
          }}
        />
      )}

      {showCategoriesModal && (
        <CategoriesModal
          cats={state.cats}
          onUpdateCats={(nextCats) => commitState((prev) => ({ ...prev, cats: nextCats }))}
          onClose={() => setShowCategoriesModal(false)}
        />
      )}

      {viewingReceipt && viewingReceipt.img && (
        <ModalShell
          title={`${viewingReceipt.n || viewingReceipt.c} — ${formatMoney(viewingReceipt.a)}`}
          onClose={() => setViewingReceipt(null)}
        >
          <img src={viewingReceipt.img} alt="Фото чека" className="w-full rounded-xl" />
        </ModalShell>
      )}

      {restorePkgPrompt && (
        <ModalShell title="🔐 Копия защищена паролем" onClose={() => setRestorePkgPrompt(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const dec = await decryptPayload<AppState>(restorePkgPrompt, restorePassInp);
                const nextState = hydrateState(dec);
                setState(nextState);
                await persistAppState(nextState, activePin);
                setRestorePkgPrompt(null);
                showToast('✅ Зашифрованная копия восстановлена!');
              } catch {
                setRestoreErr('❌ Неверный пароль.');
              }
            }}
            className="space-y-2.5"
          >
            <p className="fin-sub">Введите пароль или ПИН-код от резервной копии:</p>
            <input
              type="password"
              value={restorePassInp}
              onChange={(e) => setRestorePassInp(e.target.value)}
              placeholder="Пароль"
              autoFocus
              className="fin-input w-full"
            />
            {restoreErr && <div className="text-xs text-rose-400">{restoreErr}</div>}
            <div className="flex gap-2">
              <button type="submit" className="fin-btn flex-1">
                🔓 Расшифровать
              </button>
              <button
                type="button"
                onClick={() => setRestorePkgPrompt(null)}
                className="fin-btn ghost"
              >
                Отмена
              </button>
            </div>
          </form>
        </ModalShell>
      )}
      {settingsModalTab && (
        <AppSettingsModal
          settings={state.uiSettings}
          initialTab={settingsModalTab}
          activePin={activePin}
          fontLabel={fontLabel}
          onOpenPin={() => (activePin ? setShowPinManageModal(true) : setPinOverlayMode('set1'))}
          onCycleFont={handleCycleFont}
          onChange={(nextSettings) => commitState((prev) => ({ ...prev, uiSettings: nextSettings }))}
          onClose={() => setSettingsModalTab(null)}
          onShowToast={showToast}
        />
      )}

      {showUniversalVoice && (
        <UniversalVoiceModal
          cats={state.cats}
          aiMode={state.uiSettings.aiMode}
          onExecute={handleExecuteUniversalCommand}
          onClose={() => setShowUniversalVoice(false)}
        />
      )}
    </div>
  );
}
