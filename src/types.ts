export type TxType = 'in' | 'out';
export type RepeatFreq = 'none' | 'weekly' | 'monthly' | 'yearly';
export type PeriodMode = 'day' | 'week' | 'month' | 'year' | 'custom';
export type GoalScope = 'week' | 'month' | 'year';
export type TabId = 'budget' | 'expenses' | 'invest' | 'planner' | 'advisor' | 'family';
export type FontScale = 'normal' | 'lg' | 'xl';

export interface Transaction {
  id: number;
  t: TxType;
  a: number;
  c: string;
  m: string;
  d: string; // YYYY-MM-DD
  n: string;
  repeat?: RepeatFreq;
  parentId?: number;
  img?: string | null;
}

export type CategoryTuple = [name: string, color: string, keywords: string];

export interface DepositItem {
  id: number;
  name: string;
  sum: number;
  rate: number;
  rule: string;
}

export interface SaveRule {
  type: 'pct' | 'fix';
  val: number;
  rate: number;
  fromInc?: boolean;
  label: string;
}

export interface FamilyNamedAmount {
  id: number;
  name: string;
  amount: number;
  d?: string;
  done?: boolean;
}

export interface FamilyHistoryEntry {
  month: string; // YYYY-MM
  label?: string;
  start: number;
  delta: number;
  total: number;
  savedAt?: string;
}

export interface FamilyState {
  income: number;
  balances: FamilyNamedAmount[];
  expenses: FamilyNamedAmount[];
  loans: FamilyNamedAmount[];
  totalSavings: number;
  history: FamilyHistoryEntry[];
  lastMonth: string;
}

export interface PeriodGoal {
  limit: number;
  target: number;
}

export type TaskRepeatFreq = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface CalendarTask {
  id: number;
  date: string; // YYYY-MM-DD (start date)
  time?: string; // HH:MM
  title: string;
  done: boolean;
  notify: boolean;
  notifiedAt?: string | null;
  snoozedUntil?: number | null;
  repeat?: TaskRepeatFreq;
  remindBeforeMin?: number; // 0, 15, 60, 1440 (1 day), 2880 (2 days)
  amount?: number; // optional planned financial amount (₽)
  completedDates?: string[]; // for repeating tasks: ISO dates completed
  createdAt: number;
}

export interface VoiceNoteItem {
  id: number;
  kind: 'voice' | 'text';
  createdAt: number;
  // For text notes / checklist items
  text?: string;
  checked?: boolean;
  // For voice notes
  audioId?: string;
  mimeType?: string;
  durationSec?: number;
  peaks?: number[];
  transcript?: string | null;
  transcriptVisible?: boolean;
}

export type NoteTabType = 'shopping' | 'daily-tasks' | 'notes';

export interface NoteTab {
  id: string;
  title: string;
  tabType?: NoteTabType;
  items: VoiceNoteItem[];
}

export interface HabitItem {
  id: number;
  title: string;
  icon: string;
  completedDates: string[]; // YYYY-MM-DD
  createdAt: number;
}

export type AiMode = 'offline' | 'local-llm' | 'cloud';
export type AiResponseStyle = 'concise' | 'balanced' | 'detailed';
export type AiCloudProvider = 'auto' | 'gemini-flash' | 'gemini-lite' | 'openai';
export type ThemeStyle = 'premium' | 'classic';

export interface UiSettings {
  themeStyle: ThemeStyle;
  visibleTabs: Record<TabId, boolean>;
  hiddenSections: string[];
  heroTodayHub: boolean;
  heroSummaryStrip: boolean;
  heroSafePill: boolean;
  aiEnabled: boolean;
  aiMode: AiMode;
  aiVoiceEnabled: boolean;
  aiQuickPrompts: boolean;
  localModelId: string;
  aiCloudProvider: AiCloudProvider;
  aiResponseStyle: AiResponseStyle;
  aiStrictMode: boolean;
  aiHistoryTurns: number;
  aiIncludeFinanceContext: boolean;
  aiUseKnowledgeBase: boolean;
  aiCustomInstruction: string;
  soundAlertsEnabled: boolean;
  remindDayBefore: boolean;
  reminderHour: number;
}

export interface KnowledgeRule {
  id: number;
  title: string;
  content: string;
  sourceType: 'manual' | 'file';
  fileName?: string;
  createdAt: number;
}

export interface KnowledgeSource {
  id: string;
  name: string;
  url: string;
  kind: 'moex' | 'rss' | 'json' | 'text';
  enabled: boolean;
  isDefault?: boolean;
}

export interface KnowledgeBaseState {
  rules: KnowledgeRule[];
  sources: KnowledgeSource[];
  onlineSearchEnabled: boolean;
  autoSyncOnLaunch: boolean;
  lastAutoSyncAt?: number | null;
}

export type BrokerId = 'sber' | 'tbank' | 'vtb' | 'alfa' | 'bks' | 'other';
export type AssetKind = 'coupon' | 'dividend' | 'deposit';

export interface PortfolioAsset {
  id: number;
  kind: AssetKind;
  ticker: string;
  name: string;
  qty: number;
  price: number;
  annualYieldPct: number;
  payoutMonths: number[]; // 1..12 for coupons/dividends; empty for bank deposits
  maturityDate?: string; // YYYY-MM-DD (for deposits: maturity / renewal date)
  nextPayoutDate?: string; // YYYY-MM-DD (for coupons/dividends: exact next payout date)
  remindEnabled?: boolean;
  moexBoard?: 'TQOB' | 'TQBR' | 'TQTF';
  lastUpdatedAt?: number;
}

export interface InvestmentsState {
  broker: BrokerId;
  brokerCustomName?: string;
  freeCash: number;
  monthlyPlan: number;
  assets: PortfolioAsset[];
  lastQuotesSyncAt?: number | null;
}

export interface AppState {
  tx: Transaction[];
  budget: number;
  cats: CategoryTuple[];
  deposits: DepositItem[];
  saveRule: SaveRule | null;
  family: FamilyState;
  periodGoals: Record<GoalScope, PeriodGoal>;
  fontScale: FontScale;
  tasks: CalendarTask[];
  noteTabs: NoteTab[];
  activeNoteTabId: string;
  habits: HabitItem[];
  uiSettings: UiSettings;
  knowledgeBase: KnowledgeBaseState;
  investments: InvestmentsState;
}

export interface EncryptedPackage {
  enc: true;
  alg: string;
  kdf: string;
  salt: string;
  iv: string;
  ct: string;
}

export interface ChatMessage {
  id: number;
  isUser: boolean;
  html: string;
  viaVoice?: boolean;
  isError?: boolean;
}
