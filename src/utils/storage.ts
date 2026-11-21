import {
  AppState,
  AssetKind,
  BrokerId,
  CategoryTuple,
  EncryptedPackage,
  HabitItem,
  InvestmentsState,
  KnowledgeBaseState,
  KnowledgeRule,
  KnowledgeSource,
  NoteTab,
  PortfolioAsset,
  UiSettings,
} from '../types';

export const STORAGE_KEY = 'my-budget-v1';
const IDB_NAME = 'my-budget-idb-v2';
const KV_STORE = 'kv';
const AUDIO_STORE = 'audio_blobs';

export const DEFAULT_LOCAL_MODEL_ID = 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC';

export function createDefaultUiSettings(): UiSettings {
  return {
    themeStyle: 'premium',
    visibleTabs: {
      budget: true,
      expenses: true,
      invest: true,
      planner: true,
      advisor: true,
      family: true,
    },
    hiddenSections: [],
    heroTodayHub: true,
    heroSummaryStrip: true,
    heroSafePill: true,
    aiEnabled: true,
    aiMode: 'offline',
    aiVoiceEnabled: true,
    aiQuickPrompts: true,
    localModelId: DEFAULT_LOCAL_MODEL_ID,
    aiCloudProvider: 'auto',
    aiResponseStyle: 'balanced',
    aiStrictMode: true,
    aiHistoryTurns: 4,
    aiIncludeFinanceContext: true,
    aiUseKnowledgeBase: true,
    aiCustomInstruction: '',
    soundAlertsEnabled: true,
    remindDayBefore: true,
    reminderHour: 9,
  };
}

export function createDefaultHabits(): HabitItem[] {
  const now = Date.now();
  return [
    { id: 101, title: 'Записать все траты за день', icon: '📝', completedDates: [], createdAt: now },
    { id: 102, title: 'День без импульсивных покупок', icon: '🛡️', completedDates: [], createdAt: now + 1 },
    { id: 103, title: 'Вода и прогулка / зарядка', icon: '💧', completedDates: [], createdAt: now + 2 },
  ];
}

export const DEFAULT_KNOWLEDGE_SOURCES: KnowledgeSource[] = [
  {
    id: 'src-moex-index',
    name: 'Мосбиржа (MOEX ISS — Индекс IMOEX и ОФЗ RGBI)',
    url: 'https://iss.moex.com/iss/engines/stock/markets/index/boards/SNDX/securities.json?iss.meta=off&iss.only=securities,marketdata&securities=IMOEX,IMOEX2,RGBI,RGBITR',
    kind: 'moex',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'src-moex-shares',
    name: 'Мосбиржа (MOEX ISS — Популярные акции РФ)',
    url: 'https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities.json?iss.meta=off&iss.only=securities,marketdata&securities=SBER,GAZP,LKOH,YDEX,ROSN,VTBR,MOEX,NVTK,PLZL,GMKN',
    kind: 'moex',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'src-rbc-rss',
    name: 'Новости РБК (Финансы и экономика)',
    url: 'https://api.rss2json.com/v1/api.json?rss_url=https://rssexport.rbc.ru/rbcnews/news/20/full.rss',
    kind: 'rss',
    enabled: true,
    isDefault: true,
  },
];

export function createDefaultKnowledgeBase(): KnowledgeBaseState {
  return {
    rules: [],
    sources: DEFAULT_KNOWLEDGE_SOURCES.map((s) => ({ ...s })),
    onlineSearchEnabled: false,
    autoSyncOnLaunch: true,
    lastAutoSyncAt: null,
  };
}

export function createDefaultInvestments(): InvestmentsState {
  return {
    broker: 'sber',
    brokerCustomName: '',
    freeCash: 0,
    monthlyPlan: 0,
    assets: [],
    lastQuotesSyncAt: null,
  };
}

export const DEFAULT_CATS: CategoryTuple[] = [
  ['Еда', '#189A7C', 'карто|картош|капуст|помидор|огурц|яблок|банан|морков|лук|сыр|колбас|рыб|яйц|масл|сахар|чай|кефир|йогурт|хлеб|молок|овощ|фрукт|мяс|рынок|магазин|продукт|кафе|обед|ужин|завтрак|кофе|шоколад|мороженое|пятёрочк|пятерочк|магнит'],
  ['Кредиты и Ипотека', '#E05A44', 'ипотек|кредит|займ|долг|рассрочк|ссуд'],
  ['Дом', '#3B82D6', 'квартир|коммунал|жкх|электричеств|свет|вода|газ|интернет|связ|севстар|ремонт|мебел|хозяйств|бытов|уборк|аренд'],
  ['Транспорт', '#E5A93B', 'такси|метро|автобус|маршрутк|электричк|каршеринг|бензин|заправк|проезд|парковк|билет на поезд|самолёт'],
  ['Вещи', '#9B59B6', 'одежд|обув|куртк|джинс|кроссовк|вещи|футболк|кофт|плать'],
  ['Дети', '#D96B9E', 'ребён|ребен|школ|игрушк|садик|детск|кружок|подгузник|памперс|няня|логопед|репетитор'],
  ['Здоровье', '#D9534F', 'аптек|лекарств|врач|доктор|клиник|поликлиник|больниц|стоматолог|зуб|окулист|терапевт|медицин|массаж|лечен|анализ|витамин'],
  ['Досуг', '#7B68EE', 'кино|театр|концерт|игр|подписк|ресторан|бар|отдых|поездк|книг|развлеч'],
  ['Вклады', '#2ECC71', 'вклад|копилк|сбереж|депозит'],
  ['Другое', '#6B827E', ''],
];

export function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function normDate(v?: string | null): string {
  if (!v) return isoDate(new Date());
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s.slice(0, 10);
}

export function createInitialState(): AppState {
  const today = new Date();
  const todayIso = isoDate(today);
  const currentMonth = todayIso.slice(0, 7);

  return {
    tx: [],
    budget: 0,
    cats: DEFAULT_CATS.map((c) => [...c] as CategoryTuple),
    deposits: [],
    saveRule: null,
    family: {
      income: 0,
      balances: [],
      expenses: [],
      loans: [],
      totalSavings: 0,
      history: [],
      lastMonth: currentMonth,
    },
    periodGoals: {
      week: { limit: 0, target: 0 },
      month: { limit: 0, target: 0 },
      year: { limit: 0, target: 0 },
    },
    fontScale: 'normal',
    tasks: [],
    noteTabs: [
      { id: 'tab-shop', title: 'Список покупок', tabType: 'shopping', items: [] },
      { id: 'tab-daily', title: 'Задачи на день', tabType: 'daily-tasks', items: [] },
      { id: 'tab-home', title: 'Заметки', tabType: 'notes', items: [] },
    ],
    activeNoteTabId: 'tab-shop',
    habits: createDefaultHabits(),
    uiSettings: createDefaultUiSettings(),
    knowledgeBase: createDefaultKnowledgeBase(),
    investments: createDefaultInvestments(),
  };
}

function normalizeNoteTabs(rawTabs: NoteTab[] | undefined, fallback: NoteTab[]): NoteTab[] {
  if (!Array.isArray(rawTabs) || rawTabs.length === 0) return fallback;
  const migrated: NoteTab[] = rawTabs.map((t) => {
    if (t.tabType) return t;
    const low = (t.title || '').toLowerCase();
    if (t.id === 'tab-shop' || /магазин|покупк|продукт/.test(low)) {
      return { ...t, tabType: 'shopping' as const };
    }
    if (t.id === 'tab-daily' || /задачи на день|дела на день/.test(low)) {
      return { ...t, tabType: 'daily-tasks' as const };
    }
    return { ...t, tabType: 'notes' as const };
  });
  // Ensure the synced "Задачи на день" tab exists for upgrading users
  if (!migrated.some((t) => t.tabType === 'daily-tasks')) {
    migrated.splice(Math.min(1, migrated.length), 0, {
      id: 'tab-daily',
      title: 'Задачи на день',
      tabType: 'daily-tasks',
      items: [],
    });
  }
  return migrated;
}

export function hydrateState(raw: Partial<AppState> | null | undefined): AppState {
  const base = createInitialState();
  if (!raw || typeof raw !== 'object') return base;

  const tx = Array.isArray(raw.tx)
    ? raw.tx.map((x) => ({
        ...x,
        t: x.t === 'in' ? ('in' as const) : ('out' as const),
        d: normDate(x.d),
      }))
    : [];

  const currentMonthStr = isoDate(new Date()).slice(0, 7);
  const fam = raw.family
    ? {
        income: raw.family.income || 0,
        balances: Array.isArray(raw.family.balances) ? raw.family.balances : [],
        expenses: Array.isArray(raw.family.expenses) ? raw.family.expenses : [],
        loans: Array.isArray(raw.family.loans) ? raw.family.loans : [],
        totalSavings: raw.family.totalSavings || 0,
        history: Array.isArray(raw.family.history) ? raw.family.history : [],
        lastMonth: raw.family.lastMonth || currentMonthStr,
      }
    : base.family;

  const noteTabs = normalizeNoteTabs(raw.noteTabs, base.noteTabs);

  const activeNoteTabId =
    raw.activeNoteTabId && noteTabs.some((t) => t.id === raw.activeNoteTabId)
      ? raw.activeNoteTabId
      : noteTabs[0].id;

  const defUi = createDefaultUiSettings();
  const rawUi = raw.uiSettings;
  const rawVis = rawUi?.visibleTabs;
  const mergedVisibleTabs = {
    budget: rawVis?.budget !== false,
    expenses: rawVis?.expenses !== false,
    invest: rawVis?.invest !== false,
    planner: rawVis?.planner !== false,
    advisor: rawVis?.advisor !== false,
    family: rawVis?.family !== false,
  };
  if (!Object.values(mergedVisibleTabs).some(Boolean)) {
    mergedVisibleTabs.budget = true;
  }

  const uiSettings: UiSettings = {
    themeStyle: rawUi?.themeStyle === 'classic' ? 'classic' : 'premium',
    visibleTabs: mergedVisibleTabs,
    hiddenSections: Array.isArray(rawUi?.hiddenSections)
      ? rawUi.hiddenSections.filter((s) => s !== 'sec-deposits')
      : [],
    heroTodayHub: rawUi?.heroTodayHub !== false,
    heroSummaryStrip: rawUi?.heroSummaryStrip !== false,
    heroSafePill: rawUi?.heroSafePill !== false,
    aiEnabled: rawUi?.aiEnabled !== false,
    aiMode:
      rawUi?.aiMode === 'offline' || rawUi?.aiMode === 'local-llm' || rawUi?.aiMode === 'cloud'
        ? rawUi.aiMode
        : defUi.aiMode,
    aiVoiceEnabled: rawUi?.aiVoiceEnabled !== false,
    aiQuickPrompts: rawUi?.aiQuickPrompts !== false,
    localModelId: rawUi?.localModelId || defUi.localModelId,
    aiCloudProvider:
      rawUi?.aiCloudProvider === 'auto' ||
      rawUi?.aiCloudProvider === 'gemini-flash' ||
      rawUi?.aiCloudProvider === 'gemini-lite' ||
      rawUi?.aiCloudProvider === 'openai'
        ? rawUi.aiCloudProvider
        : defUi.aiCloudProvider,
    aiResponseStyle:
      rawUi?.aiResponseStyle === 'concise' ||
      rawUi?.aiResponseStyle === 'balanced' ||
      rawUi?.aiResponseStyle === 'detailed'
        ? rawUi.aiResponseStyle
        : defUi.aiResponseStyle,
    aiStrictMode: rawUi?.aiStrictMode !== false,
    aiHistoryTurns:
      typeof rawUi?.aiHistoryTurns === 'number' && [2, 4, 6].includes(rawUi.aiHistoryTurns)
        ? rawUi.aiHistoryTurns
        : defUi.aiHistoryTurns,
    aiIncludeFinanceContext: rawUi?.aiIncludeFinanceContext !== false,
    aiUseKnowledgeBase: rawUi?.aiUseKnowledgeBase !== false,
    aiCustomInstruction:
      typeof rawUi?.aiCustomInstruction === 'string'
        ? rawUi.aiCustomInstruction.slice(0, 800)
        : '',
    soundAlertsEnabled: rawUi?.soundAlertsEnabled !== false,
    remindDayBefore: rawUi?.remindDayBefore !== false,
    reminderHour:
      typeof rawUi?.reminderHour === 'number' &&
      Number.isInteger(rawUi.reminderHour) &&
      rawUi.reminderHour >= 6 &&
      rawUi.reminderHour <= 22
        ? rawUi.reminderHour
        : defUi.reminderHour,
  };

  const rawKb = raw.knowledgeBase;
  const defKb = createDefaultKnowledgeBase();
  const hydratedRules: KnowledgeRule[] = Array.isArray(rawKb?.rules)
    ? rawKb.rules
        .filter((r) => r && typeof r.content === 'string' && r.content.trim().length > 0)
        .map((r) => ({
          id: typeof r.id === 'number' ? r.id : Date.now() + Math.floor(Math.random() * 1000),
          title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : 'Правило из базы знаний',
          content: r.content.trim(),
          sourceType: r.sourceType === 'file' ? 'file' : 'manual',
          fileName: typeof r.fileName === 'string' ? r.fileName : undefined,
          createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
        }))
    : [];

  const hydratedSources: KnowledgeSource[] =
    Array.isArray(rawKb?.sources) && rawKb.sources.length > 0
      ? rawKb.sources
          .filter((s) => s && typeof s.url === 'string' && /^https:\/\//i.test(s.url.trim()))
          .map((s) => ({
            id: typeof s.id === 'string' && s.id ? s.id : `src-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : s.url.trim(),
            url: s.url.trim(),
            kind: s.kind === 'moex' || s.kind === 'rss' || s.kind === 'json' || s.kind === 'text' ? s.kind : 'text',
            enabled: s.enabled !== false,
            isDefault: Boolean(s.isDefault),
          }))
      : defKb.sources;

  const knowledgeBase: KnowledgeBaseState = {
    rules: hydratedRules,
    sources: hydratedSources,
    onlineSearchEnabled: rawKb?.onlineSearchEnabled === true,
    autoSyncOnLaunch: rawKb?.autoSyncOnLaunch !== false,
    lastAutoSyncAt: typeof rawKb?.lastAutoSyncAt === 'number' ? rawKb.lastAutoSyncAt : null,
  };

  const validBrokers: BrokerId[] = ['sber', 'tbank', 'vtb', 'alfa', 'bks', 'other'];
  const validKinds: AssetKind[] = ['coupon', 'dividend', 'deposit'];
  const rawInv = raw.investments;
  const defInv = createDefaultInvestments();
  const hydratedAssets: PortfolioAsset[] = Array.isArray(rawInv?.assets)
    ? rawInv.assets
        .filter((a) => a && typeof a.name === 'string' && a.name.trim().length > 0)
        .map((a) => ({
          id: typeof a.id === 'number' ? a.id : Date.now() + Math.floor(Math.random() * 1000),
          kind: validKinds.includes(a.kind) ? a.kind : 'coupon',
          ticker: typeof a.ticker === 'string' ? a.ticker.trim().toUpperCase() : '',
          name: a.name.trim(),
          qty: a.kind === 'deposit' ? 1 : Math.max(0, Number(a.qty) || 0),
          price: Math.max(0, Number(a.price) || 0),
          annualYieldPct: Math.max(0, Number(a.annualYieldPct) || 0),
          payoutMonths:
            a.kind === 'deposit'
              ? []
              : Array.isArray(a.payoutMonths)
              ? a.payoutMonths.filter((m) => Number.isInteger(m) && m >= 1 && m <= 12)
              : [],
          maturityDate:
            a.kind === 'deposit' && typeof a.maturityDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.maturityDate)
              ? a.maturityDate
              : undefined,
          nextPayoutDate:
            a.kind !== 'deposit' && typeof a.nextPayoutDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(a.nextPayoutDate)
              ? a.nextPayoutDate
              : undefined,
          remindEnabled: a.remindEnabled !== false,
          moexBoard: a.moexBoard === 'TQOB' || a.moexBoard === 'TQBR' || a.moexBoard === 'TQTF' ? a.moexBoard : undefined,
          lastUpdatedAt: typeof a.lastUpdatedAt === 'number' ? a.lastUpdatedAt : undefined,
        }))
    : [];

  // Seamless one-time migration of legacy budget deposits into Пассивный доход
  const legacyDeposits = Array.isArray(raw.deposits) ? raw.deposits : [];
  if (legacyDeposits.length > 0) {
    const existingKeys = new Set(
      hydratedAssets
        .filter((a) => a.kind === 'deposit')
        .map((a) => `${a.name.trim().toLowerCase()}|${Math.round(a.price)}`)
    );
    legacyDeposits.forEach((dep, idx) => {
      const cleanName = typeof dep?.name === 'string' && dep.name.trim() ? dep.name.trim() : 'Вклад';
      const sum = Math.max(0, Number(dep?.sum) || 0);
      const rate = Math.max(0, Number(dep?.rate) || 0);
      const key = `${cleanName.toLowerCase()}|${Math.round(sum)}`;
      if (existingKeys.has(key)) return;
      existingKeys.add(key);
      hydratedAssets.push({
        id: typeof dep.id === 'number' ? dep.id : Date.now() + 500 + idx,
        kind: 'deposit',
        ticker: '',
        name: cleanName,
        qty: 1,
        price: sum,
        annualYieldPct: rate,
        payoutMonths: [],
      });
    });
  }

  const investments: InvestmentsState = {
    broker: rawInv?.broker && validBrokers.includes(rawInv.broker) ? rawInv.broker : defInv.broker,
    brokerCustomName: typeof rawInv?.brokerCustomName === 'string' ? rawInv.brokerCustomName : '',
    freeCash: Math.max(0, Number(rawInv?.freeCash) || 0),
    monthlyPlan:
      typeof rawInv?.monthlyPlan === 'number' && Number.isFinite(rawInv.monthlyPlan)
        ? Math.max(0, rawInv.monthlyPlan)
        : defInv.monthlyPlan,
    assets: hydratedAssets,
    lastQuotesSyncAt: typeof rawInv?.lastQuotesSyncAt === 'number' ? rawInv.lastQuotesSyncAt : null,
  };

  return {
    tx,
    budget: raw.budget || 0,
    cats: Array.isArray(raw.cats) && raw.cats.length ? raw.cats : base.cats,
    deposits: [],
    saveRule: raw.saveRule || null,
    family: fam,
    periodGoals: {
      week: raw.periodGoals?.week || { limit: 0, target: 0 },
      month: raw.periodGoals?.month || { limit: 0, target: 0 },
      year: raw.periodGoals?.year || { limit: 0, target: 0 },
    },
    fontScale: raw.fontScale || 'normal',
    tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
    noteTabs,
    activeNoteTabId,
    habits: Array.isArray(raw.habits) ? raw.habits : base.habits,
    uiSettings,
    knowledgeBase,
    investments,
  };
}

// Crypto helpers (PBKDF2 + AES-GCM-256)
function u8ToB64(u8: Uint8Array): string {
  let bin = '';
  const chunk = 8192;
  for (let i = 0; i < u8.length; i += chunk) {
    bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function b64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

async function deriveAesKey(pass: string, saltU8: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(pass), { name: 'PBKDF2' }, false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltU8 as BufferSource, iterations: 120000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptPayload(plainObj: unknown, pass: string): Promise<EncryptedPackage> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(pass, salt);
  const rawBytes = new TextEncoder().encode(JSON.stringify(plainObj));
  const cipherBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, rawBytes);
  return {
    enc: true,
    alg: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256-120000',
    salt: u8ToB64(salt),
    iv: u8ToB64(iv),
    ct: u8ToB64(new Uint8Array(cipherBuf)),
  };
}

export async function decryptPayload<T = AppState>(pkg: EncryptedPackage, pass: string): Promise<T> {
  const salt = b64ToU8(pkg.salt);
  const iv = b64ToU8(pkg.iv);
  const ct = b64ToU8(pkg.ct);
  const key = await deriveAesKey(pass, salt);
  const plainBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, ct as BufferSource);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(plainBuf))) as T;
}

export function isEncryptedPackage(data: unknown): data is EncryptedPackage {
  return Boolean(data && typeof data === 'object' && (data as EncryptedPackage).enc === true && (data as EncryptedPackage).ct);
}

// IndexedDB with separate audio store + cached connection + sequential write queue
let cachedIdbPromise: Promise<IDBDatabase> | null = null;

function openIdb(): Promise<IDBDatabase> {
  if (cachedIdbPromise) return cachedIdbPromise;
  cachedIdbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (!('indexedDB' in window)) {
      cachedIdbPromise = null;
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if (!db.objectStoreNames.contains(AUDIO_STORE)) db.createObjectStore(AUDIO_STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        cachedIdbPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        cachedIdbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      cachedIdbPromise = null;
      reject(req.error);
    };
    req.onblocked = () => {
      cachedIdbPromise = null;
      reject(new Error('IndexedDB open blocked'));
    };
  });
  return cachedIdbPromise;
}

export async function idbGetKv<T>(key: string): Promise<T | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readonly');
    const req = tx.objectStore(KV_STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function idbPutKv(key: string, value: unknown): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(KV_STORE, 'readwrite');
    const req = tx.objectStore(KV_STORE).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveAudioBlob(audioId: string, blob: Blob): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    const req = tx.objectStore(AUDIO_STORE).put(blob, audioId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAudioBlob(audioId: string): Promise<Blob | undefined> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readonly');
    const req = tx.objectStore(AUDIO_STORE).get(audioId);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAudioBlob(audioId: string): Promise<void> {
  const db = await openIdb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_STORE, 'readwrite');
    const req = tx.objectStore(AUDIO_STORE).delete(audioId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// Serialized save queue so fast consecutive edits never overwrite newer state
let saveChain: Promise<void> = Promise.resolve();

export function persistAppState(state: AppState, activePin: string | null): Promise<void> {
  saveChain = saveChain
    .then(async () => {
      const payload = activePin ? await encryptPayload(state, activePin) : state;
      await idbPutKv(STORAGE_KEY, payload).catch(() => {});
      try {
        // Keep lightweight mirror in localStorage only if it fits (<3.5MB)
        const str = JSON.stringify(payload);
        if (str.length < 3_500_000) {
          localStorage.setItem(STORAGE_KEY, str);
        }
      } catch {
        // IndexedDB is primary storage; ignore localStorage quota overflow
      }
    })
    .catch(() => {});
  return saveChain;
}

const LEGACY_IDB_NAME = 'my-budget-idb-v1';

async function readLegacyIdbV1<T>(key: string): Promise<T | undefined> {
  if (!('indexedDB' in window)) return undefined;
  try {
    // When supported, avoid creating an empty legacy DB if it never existed
    if (typeof indexedDB.databases === 'function') {
      const list = await indexedDB.databases();
      if (!list.some((d) => d.name === LEGACY_IDB_NAME)) {
        return undefined;
      }
    }
    return await new Promise<T | undefined>((resolve) => {
      const req = indexedDB.open(LEGACY_IDB_NAME, 1);
      req.onupgradeneeded = () => {
        // DB didn't exist before — abort creation cleanly
        try {
          req.transaction?.abort();
        } catch {
          // ignore
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KV_STORE)) {
          db.close();
          resolve(undefined);
          return;
        }
        try {
          const tx = db.transaction(KV_STORE, 'readonly');
          const getReq = tx.objectStore(KV_STORE).get(key);
          getReq.onsuccess = () => {
            const val = getReq.result as T | undefined;
            db.close();
            resolve(val);
          };
          getReq.onerror = () => {
            db.close();
            resolve(undefined);
          };
        } catch {
          db.close();
          resolve(undefined);
        }
      };
      req.onerror = () => resolve(undefined);
    });
  } catch {
    return undefined;
  }
}

export async function loadRawStoredPackage(): Promise<AppState | EncryptedPackage | null> {
  try {
    const fromIdb = await idbGetKv<AppState | EncryptedPackage>(STORAGE_KEY);
    if (fromIdb) return fromIdb;
  } catch {
    // Fallback to legacy IndexedDB and localStorage
  }

  // Migrate seamlessly from original single-file HTML IndexedDB ('my-budget-idb-v1')
  try {
    const fromLegacyIdb = await readLegacyIdbV1<AppState | EncryptedPackage>(STORAGE_KEY);
    if (fromLegacyIdb) {
      await idbPutKv(STORAGE_KEY, fromLegacyIdb).catch(() => {});
      return fromLegacyIdb;
    }
  } catch {
    // Ignore legacy IDB error
  }

  // Also check legacy localStorage key from original single-file HTML
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState | EncryptedPackage;
      await idbPutKv(STORAGE_KEY, parsed).catch(() => {});
      return parsed;
    }
  } catch {
    // Ignore parse error
  }

  return null;
}
