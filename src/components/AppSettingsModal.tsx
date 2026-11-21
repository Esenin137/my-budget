import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BookOpen,
  Bot,
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  Edit3,
  FileText,
  Globe,
  HardDrive,
  LayoutGrid,
  Link2,
  Loader2,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import {
  AiCloudProvider,
  AiMode,
  AiResponseStyle,
  AlertSoundPreset,
  KnowledgeBaseState,
  KnowledgeRule,
  KnowledgeSource,
  TabId,
  ThemeStyle,
  UiSettings,
} from '../types';
import { createDefaultUiSettings } from '../utils/storage';
import {
  deleteLocalModelCache,
  getLocalLlmState,
  isWebGpuSupported,
  loadLocalModel,
  LOCAL_LLM_MODELS,
  LocalLlmState,
  subscribeLocalLlm,
  unloadLocalModel,
} from '../utils/localLlm';
import {
  loadOnlineCacheMap,
  MAX_RULE_FILE_BYTES,
  OnlineCacheMap,
  PRESET_TRUSTED_SOURCES,
  SAMPLE_EXCERPT_TEMPLATE,
  syncEnabledOnlineSources,
  syncSingleOnlineSource,
  validateSafeSourceUrl,
} from '../utils/knowledgeBase';
import { uid } from '../utils/finance';
import { ALERT_SOUND_OPTIONS, playReminderChime } from '../utils/sound';
import {
  ensureAndroidNotificationChannel,
  getNotificationPermissionState,
  isAndroidNativePlatform,
  isNativeNotificationsPlatform,
  openAndroidNotificationSettings,
  requestNotificationPermissions,
} from '../utils/notifications';
import { ModalShell } from './Modals';
import { PWAInstallButton } from './PWAInstallButton';

interface AppSettingsModalProps {
  settings: UiSettings;
  knowledgeBase: KnowledgeBaseState;
  initialTab?: 'layout' | 'ai' | 'kb';
  activePin?: string | null;
  fontLabel?: string;
  onOpenPin?: () => void;
  onCycleFont?: () => void;
  onChange: (next: UiSettings) => void;
  onChangeKnowledgeBase: (next: KnowledgeBaseState) => void;
  onSyncNotifications?: () => void;
  onClose: () => void;
  onShowToast: (msg: string) => void;
}

interface ServerApiStatus {
  checked: boolean;
  loading: boolean;
  reachable: boolean;
  geminiAvailable: boolean;
  openaiAvailable: boolean;
  openaiModel: string | null;
}

interface SectionConfigGroup {
  tabId: TabId;
  icon: string;
  label: string;
  accent: string;
  sections: { id: string; label: string }[];
}

const SECTION_GROUPS: SectionConfigGroup[] = [
  {
    tabId: 'budget',
    icon: '💰',
    label: 'Бюджет',
    accent: '#19A886',
    sections: [
      { id: 'sec-inc-add', label: 'Записать доход' },
      { id: 'sec-inc-list', label: 'Список доходов за период' },
      { id: 'sec-goals-tank', label: 'Цель и Лимит (резервуары)' },
      { id: 'sec-security', label: 'ПИН-код, Excel и резервные копии' },
    ],
  },
  {
    tabId: 'expenses',
    icon: '🛒',
    label: 'Расходы и Чеки',
    accent: '#F06253',
    sections: [
      { id: 'sec-exp-add', label: 'Голосовой ввод, чеки и быстрый ввод' },
      { id: 'sec-exp-list', label: 'Последние траты и поиск' },
      { id: 'sec-charts', label: 'Графики «Куда уходят деньги»' },
    ],
  },
  {
    tabId: 'invest',
    icon: '📈',
    label: 'Пассивный доход',
    accent: '#E8B44C',
    sections: [
      { id: 'sec-inv-overview', label: 'Брокер, план ИИС 13% и Мосбиржа' },
      { id: 'sec-inv-assets', label: 'Мои активы и вклады' },
      { id: 'sec-inv-scanner', label: 'Сканер рынка и выплаты' },
    ],
  },
  {
    tabId: 'planner',
    icon: '📅',
    label: 'Задачи и Заметки',
    accent: '#1EB4C9',
    sections: [
      { id: 'sec-planner-cal', label: 'Календарь и ежедневник задач' },
      { id: 'sec-planner-notes', label: 'Вкладки заметок и диктофон' },
    ],
  },
  {
    tabId: 'advisor',
    icon: '🤖',
    label: 'ИИ-Советник и Привычки',
    accent: '#8B7AF0',
    sections: [
      { id: 'sec-ai-doctor', label: 'Чат ИИ-Помощника' },
      { id: 'sec-habits', label: 'Привычки и забота ассистента' },
      { id: 'sec-tips', label: 'Финансовый разбор и резервы' },
    ],
  },
  {
    tabId: 'family',
    icon: '👨‍👩‍👧',
    label: 'Семья',
    accent: '#4F8CF0',
    sections: [
      { id: 'sec-fam-main', label: 'Семейный капитал и остатки счетов' },
      { id: 'sec-fam-rem', label: 'Напоминания платежей и кредиты' },
      { id: 'sec-fam-hist', label: 'Динамика накоплений семьи' },
    ],
  },
];

function ToggleSwitch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 cursor-pointer disabled:opacity-40 ${
        checked ? 'bg-emerald-500' : 'bg-white/15'
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

export default function AppSettingsModal({
  settings,
  knowledgeBase,
  initialTab = 'layout',
  activePin,
  fontLabel = 'А+',
  onOpenPin,
  onCycleFont,
  onChange,
  onChangeKnowledgeBase,
  onSyncNotifications,
  onClose,
  onShowToast,
}: AppSettingsModalProps) {
  const [innerTab, setInnerTab] = useState<'layout' | 'ai' | 'kb'>(initialTab);
  const [llmState, setLlmState] = useState<LocalLlmState>(() => getLocalLlmState());
  const [notifPerm, setNotifPerm] = useState<'granted' | 'denied' | 'prompt' | 'unsupported'>('prompt');
  const [requestingNotif, setRequestingNotif] = useState(false);
  const webGpuOk = isWebGpuSupported();
  const isNativeApk = isNativeNotificationsPlatform();
  const isAndroidApk = isAndroidNativePlatform();
  const currentSoundPreset: AlertSoundPreset = settings.soundPreset || 'soft';

  // Server API status state
  const [apiStatus, setApiStatus] = useState<ServerApiStatus>({
    checked: false,
    loading: false,
    reachable: false,
    geminiAvailable: false,
    openaiAvailable: false,
    openaiModel: null,
  });

  // Knowledge Base form state
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<number | null>(null);
  const [showAddSourceForm, setShowAddSourceForm] = useState(false);
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [sourceUrlError, setSourceUrlError] = useState<string | null>(null);
  const [onlineCache, setOnlineCache] = useState<OnlineCacheMap>({});
  const [syncingSources, setSyncingSources] = useState(false);
  const [syncingSourceId, setSyncingSourceId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const importKbInputRef = useRef<HTMLInputElement | null>(null);
  const sourceUrlInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return subscribeLocalLlm(setLlmState);
  }, []);

  useEffect(() => {
    getNotificationPermissionState()
      .then(setNotifPerm)
      .catch(() => setNotifPerm('unsupported'));
  }, []);

  useEffect(() => {
    if (innerTab === 'kb') {
      loadOnlineCacheMap()
        .then(setOnlineCache)
        .catch(() => {});
    }
  }, [innerTab]);

  const checkServerApiStatus = async (silent = false) => {
    setApiStatus((prev) => ({ ...prev, loading: true }));
    try {
      const resp = await fetch('/api/ai/status', { cache: 'no-store' });
      const text = await resp.text();
      const json = JSON.parse(text) as {
        ok?: boolean;
        geminiAvailable?: boolean;
        openaiAvailable?: boolean;
        openaiModel?: string | null;
      };
      if (!resp.ok || !json.ok) throw new Error('unavailable');
      const next: ServerApiStatus = {
        checked: true,
        loading: false,
        reachable: true,
        geminiAvailable: Boolean(json.geminiAvailable),
        openaiAvailable: Boolean(json.openaiAvailable),
        openaiModel: json.openaiModel || null,
      };
      setApiStatus(next);
      if (!silent) {
        if (next.geminiAvailable || next.openaiAvailable) {
          onShowToast('Серверный API доступен и готов к работе.');
        } else {
          onShowToast('Сервер отвечает, но ключ API не задан в Settings → Secrets.');
        }
      }
    } catch {
      setApiStatus({
        checked: true,
        loading: false,
        reachable: false,
        geminiAvailable: false,
        openaiAvailable: false,
        openaiModel: null,
      });
      if (!silent) {
        onShowToast('Серверный API недоступен (статический хостинг). Используйте Офлайн-аналитик или WebLLM.');
      }
    }
  };

  useEffect(() => {
    if (innerTab === 'ai' && !apiStatus.checked && !apiStatus.loading) {
      void checkServerApiStatus(true);
    }
  }, [innerTab]);

  const visibleTabsCount = Object.values(settings.visibleTabs).filter(Boolean).length;

  const toggleTab = (tabId: TabId, nextVal: boolean) => {
    if (!nextVal && visibleTabsCount <= 1) {
      onShowToast('Должен остаться включён хотя бы один раздел.');
      return;
    }
    onChange({
      ...settings,
      visibleTabs: {
        ...settings.visibleTabs,
        [tabId]: nextVal,
      },
    });
  };

  const toggleSection = (secId: string, show: boolean) => {
    const nextHidden = show
      ? settings.hiddenSections.filter((id) => id !== secId)
      : Array.from(new Set([...settings.hiddenSections, secId]));

    // Keep aiEnabled synced if user toggles sec-ai-doctor directly
    const aiSync = secId === 'sec-ai-doctor' ? { aiEnabled: show } : {};

    onChange({
      ...settings,
      ...aiSync,
      hiddenSections: nextHidden,
    });
  };

  const toggleAiEnabled = (enabled: boolean) => {
    const nextHidden = enabled
      ? settings.hiddenSections.filter((id) => id !== 'sec-ai-doctor')
      : Array.from(new Set([...settings.hiddenSections, 'sec-ai-doctor']));
    onChange({
      ...settings,
      aiEnabled: enabled,
      hiddenSections: nextHidden,
    });
  };

  const setAiMode = async (mode: AiMode) => {
    if (mode !== 'local-llm' && llmState.status === 'ready') {
      try {
        await unloadLocalModel();
      } catch {
        // ignore unload errors
      }
    }
    onChange({ ...settings, aiMode: mode });
  };

  const handleSelectLocalModel = async (modelId: string) => {
    if (settings.localModelId === modelId) return;
    if (llmState.status === 'ready' && llmState.modelId && llmState.modelId !== modelId) {
      try {
        await unloadLocalModel();
      } catch {
        // ignore unload errors
      }
    }
    onChange({ ...settings, localModelId: modelId });
  };

  const handleLoadSelectedModel = async () => {
    const ok = await loadLocalModel(settings.localModelId);
    if (ok) {
      onShowToast('Локальная ИИ-модель загружена в телефон и готова офлайн!');
    }
  };

  const handleClearCache = async () => {
    await deleteLocalModelCache(settings.localModelId);
    onShowToast('Кэш локальной модели очищен.');
  };

  // Knowledge Base handlers
  const handleAddOrSaveRule = () => {
    const content = ruleText.trim();
    if (!content) {
      onShowToast('Введите текст правила или выжимки.');
      return;
    }
    const autoTitle =
      ruleTitle.trim() ||
      content.split(/\n/)[0].replace(/^#+\s*/, '').trim().slice(0, 60) ||
      'Правило из базы знаний';

    if (editingRuleId !== null) {
      onChangeKnowledgeBase({
        ...knowledgeBase,
        rules: knowledgeBase.rules.map((r) =>
          r.id === editingRuleId ? { ...r, title: autoTitle, content } : r
        ),
      });
      setEditingRuleId(null);
      setRuleTitle('');
      setRuleText('');
      onShowToast('Выжимка обновлена.');
      return;
    }

    const nextRule: KnowledgeRule = {
      id: uid(),
      title: autoTitle,
      content,
      sourceType: 'manual',
      createdAt: Date.now(),
    };
    onChangeKnowledgeBase({
      ...knowledgeBase,
      rules: [nextRule, ...knowledgeBase.rules],
    });
    setRuleTitle('');
    setRuleText('');
    onShowToast('Выжимка сохранена в Базу знаний (IndexedDB).');
  };

  const handleStartEditRule = (rule: KnowledgeRule) => {
    setEditingRuleId(rule.id);
    setRuleTitle(rule.title);
    setRuleText(rule.content);
  };

  const handleCancelEditRule = () => {
    setEditingRuleId(null);
    setRuleTitle('');
    setRuleText('');
  };

  const handleInsertSampleTemplate = () => {
    setEditingRuleId(null);
    setRuleTitle(SAMPLE_EXCERPT_TEMPLATE.title);
    setRuleText(SAMPLE_EXCERPT_TEMPLATE.content);
    onShowToast('Шаблон подставлен в форму — отредактируйте и нажмите «Сохранить выжимку».');
  };

  const handleUploadRuleFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = Array.from(e.target.files || []);
    e.target.value = '';
    if (!fileList.length) return;

    const addedRules: KnowledgeRule[] = [];
    let skipped = 0;

    for (const file of fileList) {
      if (!/\.(txt|md|csv)$/i.test(file.name)) {
        skipped += 1;
        continue;
      }
      if (file.size > MAX_RULE_FILE_BYTES) {
        skipped += 1;
        continue;
      }
      try {
        const text = (await file.text()).trim();
        if (!text) {
          skipped += 1;
          continue;
        }
        const cleanName = file.name.replace(/\.(txt|md|csv)$/i, '');
        addedRules.push({
          id: uid() + addedRules.length,
          title: cleanName || 'Загруженный документ',
          content: text,
          sourceType: 'file',
          fileName: file.name,
          createdAt: Date.now(),
        });
      } catch {
        skipped += 1;
      }
    }

    if (addedRules.length > 0) {
      onChangeKnowledgeBase({
        ...knowledgeBase,
        rules: [...addedRules, ...knowledgeBase.rules],
      });
      onShowToast(
        skipped > 0
          ? `Загружено файлов: ${addedRules.length} (пропущено ${skipped}: нужен .txt/.md/.csv до 512 КБ).`
          : `Загружено в Базу знаний: ${addedRules.length} файл(ов).`
      );
    } else {
      onShowToast('Поддерживаются текстовые файлы .txt, .md, .csv размером до 512 КБ.');
    }
  };

  const handleExportKnowledgeBase = () => {
    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      rules: knowledgeBase.rules,
      sources: knowledgeBase.sources,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `my-finance-ai-kb-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    onShowToast('База знаний и список ссылок экспортированы в JSON.');
  };

  const handleImportKnowledgeBase = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onShowToast('Файл базы знаний слишком большой (максимум 2 МБ).');
      return;
    }
    try {
      const parsed = JSON.parse(await file.text()) as {
        rules?: KnowledgeRule[];
        sources?: KnowledgeSource[];
      };
      const existingRuleTitles = new Set(knowledgeBase.rules.map((r) => `${r.title}|${r.content.slice(0, 60)}`));
      const importedRules: KnowledgeRule[] = Array.isArray(parsed.rules)
        ? parsed.rules
            .filter((r) => r && typeof r.content === 'string' && r.content.trim())
            .map((r, idx) => ({
              id: uid() + idx,
              title: typeof r.title === 'string' && r.title.trim() ? r.title.trim() : 'Импортированная выжимка',
              content: r.content.trim(),
              sourceType: r.sourceType === 'file' ? ('file' as const) : ('manual' as const),
              fileName: typeof r.fileName === 'string' ? r.fileName : undefined,
              createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
            }))
            .filter((r) => !existingRuleTitles.has(`${r.title}|${r.content.slice(0, 60)}`))
        : [];

      const existingUrls = new Set(knowledgeBase.sources.map((s) => s.url));
      const importedSources: KnowledgeSource[] = Array.isArray(parsed.sources)
        ? parsed.sources
            .map((s, idx) => {
              const check = validateSafeSourceUrl(String(s?.url || ''));
              if (!check.ok || existingUrls.has(check.url)) return null;
              existingUrls.add(check.url);
              return {
                id: `src-imp-${uid()}-${idx}`,
                name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim() : new URL(check.url).hostname,
                url: check.url,
                kind: check.inferredKind,
                enabled: s?.enabled !== false,
                isDefault: false,
              } as KnowledgeSource;
            })
            .filter((x): x is KnowledgeSource => Boolean(x))
        : [];

      if (importedRules.length === 0 && importedSources.length === 0) {
        onShowToast('Новых выжимок или ссылок в файле не найдено.');
        return;
      }

      onChangeKnowledgeBase({
        ...knowledgeBase,
        rules: [...importedRules, ...knowledgeBase.rules],
        sources: [...knowledgeBase.sources, ...importedSources],
      });
      onShowToast(`Импортировано: ${importedRules.length} выжимок и ${importedSources.length} ссылок.`);
    } catch {
      onShowToast('Не удалось прочитать JSON-файл Базы знаний.');
    }
  };

  const handleDeleteRule = (id: number) => {
    if (editingRuleId === id) {
      handleCancelEditRule();
    }
    onChangeKnowledgeBase({
      ...knowledgeBase,
      rules: knowledgeBase.rules.filter((r) => r.id !== id),
    });
    onShowToast('Выжимка удалена из Базы знаний.');
  };

  const handleToggleOnlineSearch = async (enabled: boolean) => {
    onChangeKnowledgeBase({
      ...knowledgeBase,
      onlineSearchEnabled: enabled,
    });
    if (enabled) {
      setSyncingSources(true);
      try {
        const updated = await syncEnabledOnlineSources(knowledgeBase.sources, { force: true });
        setOnlineCache(updated);
        onShowToast('Доверенные источники включены и обновлены в кэше.');
      } catch {
        onShowToast('Источники включены. Нажмите «Обновить сейчас» при наличии сети.');
      } finally {
        setSyncingSources(false);
      }
    } else {
      onShowToast('Доверенные онлайн-источники отключены (100% офлайн).');
    }
  };

  const handleRefreshOnlineSources = async () => {
    if (syncingSources) return;
    setSyncingSources(true);
    try {
      const updated = await syncEnabledOnlineSources(knowledgeBase.sources, { force: true });
      setOnlineCache(updated);
      const enabledCount = knowledgeBase.sources.filter((s) => s.enabled).length;
      const okCount = knowledgeBase.sources.filter(
        (s) => s.enabled && updated[s.id]?.status === 'ok'
      ).length;
      onChangeKnowledgeBase({
        ...knowledgeBase,
        lastAutoSyncAt: Date.now(),
      });
      onShowToast(`Обновлено источников: ${okCount} из ${enabledCount}.`);
    } catch {
      onShowToast('Не удалось обновить часть источников.');
    } finally {
      setSyncingSources(false);
    }
  };

  const handleRefreshSingleSource = async (src: KnowledgeSource) => {
    if (syncingSourceId || syncingSources) return;
    setSyncingSourceId(src.id);
    try {
      const updated = await syncSingleOnlineSource(src);
      setOnlineCache(updated);
      const rec = updated[src.id];
      if (rec?.status === 'ok') {
        onShowToast(`«${src.name}» обновлён (${rec.entries.length} записей).`);
      } else {
        onShowToast(rec?.error || `Не удалось обновить «${src.name}».`);
      }
    } finally {
      setSyncingSourceId(null);
    }
  };

  const addAndFetchSource = async (name: string, url: string, kind: KnowledgeSource['kind'], fixedId?: string) => {
    const nextSrc: KnowledgeSource = {
      id: fixedId || `src-custom-${uid()}`,
      name,
      url,
      kind,
      enabled: true,
      isDefault: false,
    };
    const nextSources = [...knowledgeBase.sources, nextSrc];
    onChangeKnowledgeBase({
      ...knowledgeBase,
      onlineSearchEnabled: true,
      autoSyncOnLaunch: true,
      sources: nextSources,
    });
    setSyncingSourceId(nextSrc.id);
    try {
      const updated = await syncSingleOnlineSource(nextSrc);
      setOnlineCache(updated);
      const rec = updated[nextSrc.id];
      if (rec?.status === 'ok') {
        onShowToast(`Источник «${name}» добавлен и загружен (${rec.entries.length} записей).`);
      } else {
        onShowToast(`Источник «${name}» добавлен. ${rec?.error || 'Обновится при следующем запуске.'}`);
      }
    } finally {
      setSyncingSourceId(null);
    }
  };

  const handleAddCustomSource = async () => {
    setSourceUrlError(null);
    const check = validateSafeSourceUrl(newSourceUrl);
    if (!check.ok) {
      setSourceUrlError(check.error);
      return;
    }
    if (knowledgeBase.sources.some((s) => s.url === check.url)) {
      setSourceUrlError('Эта ссылка уже есть в списке доверенных источников.');
      return;
    }
    const label = newSourceName.trim() || new URL(check.url).hostname;
    setNewSourceName('');
    setNewSourceUrl('');
    setShowAddSourceForm(false);
    await addAndFetchSource(label, check.url, check.inferredKind);
  };

  const handleAddPresetSource = async (preset: (typeof PRESET_TRUSTED_SOURCES)[number]) => {
    if (knowledgeBase.sources.some((s) => s.url === preset.url)) {
      onShowToast('Этот источник уже подключён.');
      return;
    }
    await addAndFetchSource(preset.name, preset.url, preset.kind, preset.id);
  };

  const handleToggleSource = (id: string, enabled: boolean) => {
    onChangeKnowledgeBase({
      ...knowledgeBase,
      sources: knowledgeBase.sources.map((s) => (s.id === id ? { ...s, enabled } : s)),
    });
  };

  const handleDeleteSource = (id: string) => {
    onChangeKnowledgeBase({
      ...knowledgeBase,
      sources: knowledgeBase.sources.filter((s) => s.id !== id),
    });
    onShowToast('Источник удалён.');
  };

  const handlePreviewSound = (preset: AlertSoundPreset = currentSoundPreset) => {
    const ok = playReminderChime(preset);
    const opt = ALERT_SOUND_OPTIONS.find((o) => o.id === preset);
    if (ok) {
      if (preset === 'system') {
        onShowToast('🔔 На Android будет звучать системный рингтон уведомлений телефона.');
      } else {
        onShowToast(`▶ Мелодия: «${opt?.label || 'Мягкий звон'}»`);
      }
    } else {
      onShowToast('Звук заблокирован браузером — проверьте громкость устройства.');
    }
  };

  const handleSelectSoundPreset = async (nextPreset: AlertSoundPreset) => {
    onChange({ ...settings, soundPreset: nextPreset });
    if (isNativeApk) {
      await ensureAndroidNotificationChannel(nextPreset);
      onSyncNotifications?.();
    }
    const opt = ALERT_SOUND_OPTIONS.find((o) => o.id === nextPreset);
    onShowToast(`Мелодия оповещения: «${opt?.label || nextPreset}»`);
  };

  const handleOpenAndroidSoundSettings = async () => {
    const opened = await openAndroidNotificationSettings(currentSoundPreset);
    if (!opened) {
      onShowToast('Откройте: Настройки телефона → Приложения → Мои финансы → Уведомления.');
    }
  };

  const handleEnableSystemNotifications = async () => {
    if (requestingNotif) return;
    setRequestingNotif(true);
    try {
      const nextPerm = await requestNotificationPermissions(currentSoundPreset);
      setNotifPerm(nextPerm);
      if (nextPerm === 'granted') {
        if (settings.soundAlertsEnabled !== false) {
          playReminderChime(currentSoundPreset);
        }
        onSyncNotifications?.();
        onShowToast(
          isNativeApk
            ? '🔔 Уведомления Android включены и синхронизированы!'
            : '🔔 Системные уведомления включены!'
        );
      } else if (nextPerm === 'denied') {
        onShowToast('Уведомления запрещены в настройках системы — работают баннеры и звук внутри приложения.');
      } else {
        onShowToast('Используются встроенные оповещения со звуком.');
      }
    } finally {
      setRequestingNotif(false);
    }
  };

  const handleResetDefaults = () => {
    const def = createDefaultUiSettings();
    onChange({
      ...def,
      themeStyle: settings.themeStyle,
      soundAlertsEnabled: settings.soundAlertsEnabled,
      soundPreset: settings.soundPreset,
      remindDayBefore: settings.remindDayBefore,
      reminderHour: settings.reminderHour,
      aiMode: settings.aiMode,
      localModelId: settings.localModelId,
      aiCloudProvider: settings.aiCloudProvider,
      aiResponseStyle: settings.aiResponseStyle,
      aiStrictMode: settings.aiStrictMode,
      aiHistoryTurns: settings.aiHistoryTurns,
      aiIncludeFinanceContext: settings.aiIncludeFinanceContext,
      aiUseKnowledgeBase: settings.aiUseKnowledgeBase,
      aiCustomInstruction: settings.aiCustomInstruction,
    });
    onShowToast('Все разделы и блоки возвращены по умолчанию.');
  };

  const setThemeStyle = (theme: ThemeStyle) => {
    if (settings.themeStyle === theme) return;
    onChange({ ...settings, themeStyle: theme });
    onShowToast(
      theme === 'classic'
        ? 'Включена классическая тема (оригинальный стиль).'
        : 'Включена премиальная тема (Обсидиан).'
    );
  };

  const isSectionVisible = (secId: string) => !settings.hiddenSections.includes(secId);

  return (
    <ModalShell title="⚙️ Настройки приложения" onClose={onClose}>
      {/* Быстрые инструменты приложения */}
      {(onOpenPin || onCycleFont) && (
        <div className="grid grid-cols-2 gap-1.5">
          {onOpenPin && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenPin();
              }}
              className={`py-2 px-2 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1 cursor-pointer transition ${
                activePin
                  ? 'bg-amber-500/15 border-amber-400/40 text-amber-200'
                  : 'bg-white/[0.04] border-white/[0.08] text-slate-200 hover:bg-white/[0.08]'
              }`}
            >
              <span>{activePin ? '🔒 ПИН включён' : '🔐 ПИН-код'}</span>
            </button>
          )}
          {onCycleFont && (
            <button
              type="button"
              onClick={onCycleFont}
              className="py-2 px-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-[11px] font-bold text-slate-200 flex items-center justify-center gap-1 cursor-pointer transition"
            >
              <span>Шрифт: {fontLabel.replace(/^🔍\s*/, '')}</span>
            </button>
          )}
        </div>
      )}

      {/* Переключатель 3 вкладок настроек */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-[var(--fld)] border border-[var(--line)]">
        <button
          type="button"
          onClick={() => setInnerTab('layout')}
          className={`py-2 px-2 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer transition ${
            innerTab === 'layout'
              ? 'bg-white/[0.14] text-white shadow-sm'
              : 'text-[var(--mute)] hover:text-white'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Блоки и вид</span>
        </button>
        <button
          type="button"
          onClick={() => setInnerTab('ai')}
          className={`py-2 px-2 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer transition ${
            innerTab === 'ai'
              ? 'bg-[#7A68E6]/35 text-white border border-[#8B7AF0]/40'
              : 'text-[var(--mute)] hover:text-white'
          }`}
        >
          <Bot className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Движок и API</span>
        </button>
        <button
          type="button"
          onClick={() => setInnerTab('kb')}
          className={`py-2 px-2 rounded-xl text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer transition ${
            innerTab === 'kb'
              ? 'bg-emerald-500/25 text-white border border-emerald-400/45'
              : 'text-[var(--mute)] hover:text-white'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">Обучение ИИ</span>
        </button>
      </div>

      {innerTab === 'layout' ? (
        <div className="space-y-3">
          {/* Установка приложения на телефон (PWA) */}
          <PWAInstallButton variant="card" onInstalledToast={onShowToast} />

          {/* Выбор темы оформления: Премиум vs Классическая (оригинал) */}
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
              <Palette className="w-3.5 h-3.5 text-emerald-400" />
              <span>Тема оформления</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setThemeStyle('premium')}
                className={`text-left rounded-xl p-2.5 border transition cursor-pointer ${
                  (settings.themeStyle || 'premium') === 'premium'
                    ? 'bg-emerald-500/12 border-emerald-400/60 shadow-sm'
                    : 'bg-black/25 border-white/10 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-1 mb-2">
                  <span className="h-2.5 flex-1 rounded-sm bg-[#0D1518] border border-white/15" />
                  <span className="h-2.5 w-3 rounded-sm bg-[#1FB892]" />
                  <span className="h-2.5 w-3 rounded-sm bg-[#E8B44C]" />
                </div>
                <div className="text-xs font-extrabold text-white leading-tight">
                  Премиум
                </div>
                <div className="text-[10px] text-[var(--mute)] mt-0.5 leading-snug">
                  Тёмный обсидиан, спокойные акценты
                </div>
              </button>

              <button
                type="button"
                onClick={() => setThemeStyle('classic')}
                className={`text-left rounded-xl p-2.5 border transition cursor-pointer ${
                  settings.themeStyle === 'classic'
                    ? 'bg-emerald-500/15 border-emerald-400/70 shadow-sm'
                    : 'bg-black/25 border-white/10 hover:border-white/25'
                }`}
              >
                <div className="flex items-center gap-1 mb-2">
                  <span
                    className="h-2.5 flex-1 rounded-sm"
                    style={{ background: 'linear-gradient(135deg, #199E76, #0D6349)' }}
                  />
                  <span
                    className="h-2.5 w-3.5 rounded-sm"
                    style={{ background: 'linear-gradient(135deg, #DC5443, #9E2E20)' }}
                  />
                  <span
                    className="h-2.5 w-3.5 rounded-sm"
                    style={{ background: 'linear-gradient(135deg, #DF9F26, #A36C0E)' }}
                  />
                </div>
                <div className="text-xs font-extrabold text-white leading-tight">
                  Классическая
                </div>
                <div className="text-[10px] text-[var(--mute)] mt-0.5 leading-snug">
                  Ваш исходный стиль с яркими 3D-плитками
                </div>
              </button>
            </div>
          </div>

          {/* Шапка (Hero) и сводка */}
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2.5">
            <div className="text-xs font-extrabold text-white">📌 Верхняя шапка и сводка</div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <div>
                <div className="font-bold text-slate-100">Мини-экран «Сегодня» и Единый календарь</div>
                <div className="fin-sub">Закреплён сверху: дела, траты и быстрые команды</div>
              </div>
              <ToggleSwitch
                checked={settings.heroTodayHub}
                onChange={(v) => onChange({ ...settings, heroTodayHub: v })}
                label="Мини-экран Сегодня и Единый календарь"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-white/10">
              <div>
                <div className="font-bold text-slate-100">Карточки Доход / Расход / Остаток</div>
                <div className="fin-sub">3D-плитки сводки внутри раздела «Бюджет»</div>
              </div>
              <ToggleSwitch
                checked={settings.heroSummaryStrip}
                onChange={(v) => onChange({ ...settings, heroSummaryStrip: v })}
                label="Карточки сводки в Бюджете"
              />
            </div>
            {(settings.heroSummaryStrip || settings.heroTodayHub) && (
              <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-white/10">
                <div>
                  <div className="font-bold text-slate-100">Строка «Безопасно в день»</div>
                  <div className="fin-sub">Расчёт свободного дневного лимита</div>
                </div>
                <ToggleSwitch
                  checked={settings.heroSafePill}
                  onChange={(v) => onChange({ ...settings, heroSafePill: v })}
                  label="Безопасно в день"
                />
              </div>
            )}
          </div>

          {/* Оповещения, напоминания и звук (Web Audio API + Android LocalNotifications) */}
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
                <Bell className="w-3.5 h-3.5 text-amber-300" />
                <span>Оповещения и звук</span>
              </div>
              <span className="text-[10.5px] text-slate-400">
                {isAndroidApk ? 'Android APK' : 'Web Audio'}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs">
              <div>
                <div className="font-bold text-slate-100">Звук оповещений</div>
                <div className="fin-sub">Лёгкий сигнал при наступлении задач, вкладов и выплат</div>
              </div>
              <ToggleSwitch
                checked={settings.soundAlertsEnabled !== false}
                onChange={(v) => onChange({ ...settings, soundAlertsEnabled: v })}
                label="Звук оповещений"
              />
            </div>

            <div className="space-y-1.5 pt-2 border-t border-white/10 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="font-bold text-slate-100">Мелодия оповещения</div>
                <span className="fin-sub truncate">
                  {ALERT_SOUND_OPTIONS.find((o) => o.id === currentSoundPreset)?.hint}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <select
                  aria-label="Мелодия оповещения"
                  className="fin-select flex-1 min-w-0 text-xs py-1.5 px-2.5"
                  value={currentSoundPreset}
                  onChange={(e) =>
                    void handleSelectSoundPreset(e.target.value as AlertSoundPreset)
                  }
                >
                  {ALERT_SOUND_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => handlePreviewSound(currentSoundPreset)}
                  className="px-2.5 py-1.5 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-400/35 text-[11px] font-bold text-emerald-200 flex items-center gap-1 shrink-0 cursor-pointer transition"
                >
                  <Volume2 className="w-3.5 h-3.5" />
                  <span>▶ Прослушать</span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-white/10">
              <div>
                <div className="font-bold text-slate-100">Напоминать за 1 день («Завтра…»)</div>
                <div className="fin-sub">За день до срока вклада, купона, дивидендов и платежей</div>
              </div>
              <ToggleSwitch
                checked={settings.remindDayBefore !== false}
                onChange={(v) => onChange({ ...settings, remindDayBefore: v })}
                label="Напоминать за 1 день"
              />
            </div>

            <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-white/10">
              <div>
                <div className="font-bold text-slate-100">Время дневных напоминаний</div>
                <div className="fin-sub">Для вкладов, купонов и задач без точного времени</div>
              </div>
              <select
                className="fin-select text-xs py-1 px-2 tabular-nums"
                value={settings.reminderHour ?? 9}
                onChange={(e) =>
                  onChange({ ...settings, reminderHour: Number(e.target.value) || 9 })
                }
              >
                {[8, 9, 10, 12, 15, 18, 20].map((h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs pt-2 border-t border-white/10">
              <div className="min-w-0">
                <div className="font-bold text-slate-100">
                  {isNativeApk ? 'Уведомления Android (APK)' : 'Системные уведомления'}
                </div>
                <div className="fin-sub">
                  {notifPerm === 'granted'
                    ? 'Разрешены — ближайшие события планируются автоматически'
                    : notifPerm === 'denied'
                    ? 'Отключены в системе — работают баннеры и звук в приложении'
                    : 'Разрешите для напоминаний, когда приложение свёрнуто'}
                </div>
              </div>
              <button
                type="button"
                disabled={requestingNotif}
                onClick={() => void handleEnableSystemNotifications()}
                className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0 cursor-pointer transition border ${
                  notifPerm === 'granted'
                    ? 'bg-emerald-500/15 border-emerald-400/35 text-emerald-200 hover:bg-emerald-500/25'
                    : 'bg-white/10 border-white/20 text-white hover:bg-white/15'
                }`}
              >
                {notifPerm === 'granted' ? 'Обновить' : 'Включить'}
              </button>
            </div>

            {isAndroidApk && (
              <div className="pt-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => void handleOpenAndroidSoundSettings()}
                  className="w-full py-2 px-3 rounded-xl bg-white/[0.06] hover:bg-white/[0.11] border border-white/15 text-xs font-bold text-slate-100 flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <span>⚙️ Системные настройки звука Android</span>
                </button>
                <div className="fin-sub mt-1">
                  Откроет системный канал уведомлений — можно выбрать любой рингтон из памяти телефона.
                </div>
              </div>
            )}
          </div>

          {/* Разделы и вложенные окна */}
          <div className="space-y-2.5">
            {SECTION_GROUPS.map((group) => {
              const tabEnabled = settings.visibleTabs[group.tabId];
              return (
                <div
                  key={group.tabId}
                  className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-extrabold text-xs text-white flex items-center gap-2">
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ backgroundColor: group.accent }}
                      />
                      <span>{group.label}</span>
                    </div>
                    <ToggleSwitch
                      checked={tabEnabled}
                      onChange={(v) => toggleTab(group.tabId, v)}
                      label={`Раздел ${group.label}`}
                    />
                  </div>

                  {tabEnabled && (
                    <div className="space-y-1.5 pt-2 border-t border-white/10">
                      {group.sections.map((sec) => {
                        const checked = isSectionVisible(sec.id);
                        return (
                          <label
                            key={sec.id}
                            className="flex items-center justify-between gap-2 text-xs text-slate-200 cursor-pointer py-0.5"
                          >
                            <span className={checked ? '' : 'opacity-50 line-through'}>
                              {sec.label}
                            </span>
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => toggleSection(sec.id, e.target.checked)}
                              className="w-4 h-4 accent-emerald-500 rounded cursor-pointer"
                            />
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <button
            type="button"
            onClick={handleResetDefaults}
            className="fin-btn ghost w-full flex items-center justify-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Вернуть все блоки по умолчанию</span>
          </button>
        </div>
      ) : innerTab === 'ai' ? (
        <div className="space-y-3">
          {/* Главный тумблер чата ИИ */}
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-extrabold text-xs text-white">Чат ИИ-Помощника</div>
                <div className="fin-sub">Включить или полностью скрыть окно чата</div>
              </div>
              <ToggleSwitch
                checked={settings.aiEnabled && isSectionVisible('sec-ai-doctor')}
                onChange={toggleAiEnabled}
                label="Чат ИИ-Помощника"
              />
            </div>

            {settings.aiEnabled && isSectionVisible('sec-ai-doctor') && (
              <div className="space-y-2 pt-2 border-t border-white/10">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-200">Кнопка голосового вопроса (🎙️)</span>
                  <ToggleSwitch
                    checked={settings.aiVoiceEnabled}
                    onChange={(v) => onChange({ ...settings, aiVoiceEnabled: v })}
                    label="Голосовой ввод в чате"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-slate-200">Быстрые карточки-подсказки</span>
                  <ToggleSwitch
                    checked={settings.aiQuickPrompts}
                    onChange={(v) => onChange({ ...settings, aiQuickPrompts: v })}
                    label="Быстрые карточки"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Выбор режима работы ИИ */}
          <div className="space-y-2">
            <div className="text-xs font-extrabold text-white px-0.5">
              Движок ИИ-Советника
            </div>

            {/* 1. Офлайн-Советник (0 МБ) */}
            <button
              type="button"
              onClick={() => void setAiMode('offline')}
              className={`w-full text-left rounded-2xl p-3 border transition cursor-pointer ${
                settings.aiMode === 'offline'
                  ? 'bg-emerald-500/15 border-emerald-400/60'
                  : 'bg-[var(--fld)] border-[var(--line)] hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Встроенный локальный ИИ-аналитик (0 МБ)</span>
                </div>
                <span className="text-[10px] font-bold text-emerald-300">
                  По умолчанию · 100% офлайн
                </span>
              </div>
              <div className="fin-sub mt-1">
                Мгновенный расчёт бюджета, вкладов, ОФЗ, вычета 13% по ИИС + поиск по вашим выжимкам
                и кэшу доверенных источников без нагрузки на видеопамять.
              </div>
            </button>

            {/* 2. Локальная ИИ-модель в телефоне (WebLLM) */}
            <div
              className={`rounded-2xl p-3 border transition space-y-2.5 ${
                settings.aiMode === 'local-llm'
                  ? 'bg-cyan-500/12 border-cyan-400/60'
                  : 'bg-[var(--fld)] border-[var(--line)]'
              }`}
            >
              <button
                type="button"
                onClick={() => void setAiMode('local-llm')}
                className="w-full text-left cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                    <Cpu className="w-4 h-4 text-cyan-300 shrink-0" />
                    <span>Локальная нейросеть на устройстве (WebLLM)</span>
                  </div>
                  <span className="text-[10px] font-bold text-cyan-200">
                    Офлайн-нейросеть
                  </span>
                </div>
                <div className="fin-sub mt-1">
                  Скачивается 1 раз в кэш браузера, использует ваши выжимки и доверенные источники,
                  отвечает свободным текстом без отправки данных в интернет.
                </div>
              </button>

              {settings.aiMode === 'local-llm' && (
                <div className="space-y-2.5 pt-2 border-t border-white/10">
                  <div
                    className={`rounded-xl px-2.5 py-2 text-[11px] flex items-center gap-2 ${
                      webGpuOk
                        ? 'bg-emerald-500/12 border border-emerald-400/30 text-emerald-200'
                        : 'bg-amber-500/12 border border-amber-400/35 text-amber-200'
                    }`}
                  >
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>
                      {webGpuOk
                        ? 'WebGPU поддерживается этим браузером — можно загрузить локальную модель.'
                        : 'WebGPU не обнаружен. Нужен Chrome (Android/ПК) или Safari с WebGPU, либо режим «Офлайн-аналитик (0 МБ)».'}
                    </span>
                  </div>

                  {/* Выбор компактной модели */}
                  <div className="space-y-1.5">
                    {LOCAL_LLM_MODELS.map((m) => {
                      const selected = settings.localModelId === m.id;
                      const isLoaded = llmState.status === 'ready' && llmState.modelId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => void handleSelectLocalModel(m.id)}
                          className={`w-full text-left p-2.5 rounded-xl border transition cursor-pointer ${
                            selected
                              ? 'bg-white/10 border-cyan-400/60'
                              : 'bg-black/20 border-white/10 hover:border-white/25'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2 text-xs font-extrabold text-white">
                            <span>{m.name}</span>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="text-[10px] font-bold text-cyan-200">
                                {m.sizeLabel}
                              </span>
                              {isLoaded && (
                                <span className="text-[10px] font-bold text-emerald-300">● Готова</span>
                              )}
                            </div>
                          </div>
                          <div className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                            {m.description}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  {/* Статус и прогресс загрузки */}
                  {llmState.status === 'loading' && (
                    <div className="rounded-xl bg-black/30 border border-cyan-400/30 p-2.5 space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold text-cyan-200">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Загрузка модели...
                        </span>
                        <span className="tabular-nums">{llmState.progress}%</span>
                      </div>
                      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all"
                          style={{ width: `${llmState.progress}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-slate-400 truncate">{llmState.statusText}</div>
                    </div>
                  )}

                  {llmState.error && (
                    <div className="rounded-xl bg-rose-500/15 border border-rose-400/35 px-2.5 py-2 text-[11px] text-rose-200">
                      {llmState.error}
                    </div>
                  )}

                  <div className="flex gap-1.5 flex-wrap">
                    <button
                      type="button"
                      disabled={llmState.status === 'loading' || !webGpuOk}
                      onClick={handleLoadSelectedModel}
                      className="fin-btn sm flex-1 flex items-center justify-center gap-1.5 disabled:opacity-50"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>
                        {llmState.status === 'ready' &&
                        (llmState.modelId === settings.localModelId ||
                          llmState.modelId === settings.localModelId.replace('q4f16_1', 'q4f32_1'))
                          ? 'Модель готова офлайн'
                          : 'Загрузить в телефон'}
                      </span>
                    </button>
                    {llmState.status === 'ready' && (
                      <button
                        type="button"
                        onClick={() => unloadLocalModel()}
                        className="fin-btn ghost sm flex items-center gap-1"
                        title="Освободить оперативную память"
                      >
                        <HardDrive className="w-3.5 h-3.5" />
                        <span>Выгрузить</span>
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={llmState.status === 'loading'}
                      onClick={handleClearCache}
                      className="fin-btn ghost sm flex items-center gap-1 text-rose-300"
                      title="Удалить скачанные файлы модели из кэша браузера"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Очистить кэш</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 3. Облачный API (серверный шлюз Gemini / OpenAI-compatible) */}
            <div
              className={`rounded-2xl p-3 border transition space-y-2.5 ${
                settings.aiMode === 'cloud'
                  ? 'bg-[#7A68E6]/18 border-[#9B8AFB]/60'
                  : 'bg-[var(--fld)] border-[var(--line)]'
              }`}
            >
              <button
                type="button"
                onClick={() => void setAiMode('cloud')}
                className="w-full text-left cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                    <Cloud className="w-4 h-4 text-[#9B8AFB] shrink-0" />
                    <span>Облачный API (серверный шлюз)</span>
                  </div>
                  <span className="text-[10px] font-bold text-violet-200">
                    Gemini / OpenAI API
                  </span>
                </div>
                <div className="fin-sub mt-1">
                  Мощные ответы через защищённый серверный API с учётом вашей Базы знаний и
                  доверенных ссылок. Ключи хранятся только на сервере (Settings → Secrets).
                </div>
              </button>

              {settings.aiMode === 'cloud' && (
                <div className="space-y-2.5 pt-2 border-t border-white/10">
                  {/* Статус подключения к серверному API */}
                  <div className="rounded-xl bg-black/25 border border-white/10 p-2.5 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        {apiStatus.loading ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-300" />
                        ) : apiStatus.reachable && (apiStatus.geminiAvailable || apiStatus.openaiAvailable) ? (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                        ) : (
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-300" />
                        )}
                        <span>
                          {apiStatus.loading
                            ? 'Проверка серверного API...'
                            : !apiStatus.reachable
                            ? 'Сервер API не обнаружен (статический режим)'
                            : apiStatus.geminiAvailable || apiStatus.openaiAvailable
                            ? 'Серверный API подключён'
                            : 'Сервер работает, но ключ API не задан'}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={apiStatus.loading}
                        onClick={() => void checkServerApiStatus(false)}
                        className="px-2 py-1 rounded-lg bg-white/10 hover:bg-white/15 text-[11px] font-bold text-slate-200 cursor-pointer flex items-center gap-1"
                      >
                        <RefreshCw className={`w-3 h-3 ${apiStatus.loading ? 'animate-spin' : ''}`} />
                        <span>Проверить</span>
                      </button>
                    </div>

                    {apiStatus.reachable && (
                      <div className="text-[11px] text-slate-300 space-y-0.5">
                        <div>
                          • Gemini API: {apiStatus.geminiAvailable ? 'активен на сервере' : 'не задан (Settings → Secrets)'}
                        </div>
                        <div>
                          • OpenAI-совместимый шлюз:{' '}
                          {apiStatus.openaiAvailable
                            ? `активен (${apiStatus.openaiModel || 'gpt-4o-mini'})`
                            : 'не задан (опционально в переменных сервера)'}
                        </div>
                      </div>
                    )}

                    {/* Выбор провайдера / модели API */}
                    <div className="space-y-1 pt-1">
                      <div className="text-[11px] font-bold text-slate-300">Модель серверного API:</div>
                      <div className="grid grid-cols-2 gap-1.5">
                        {(
                          [
                            { id: 'auto', label: 'Автовыбор', sub: 'Gemini → OpenAI' },
                            { id: 'gemini-flash', label: 'Gemini 4 Flash', sub: 'Точный и быстрый' },
                            { id: 'gemini-lite', label: 'Gemini 3.1 Lite', sub: 'Максимальная скорость' },
                            { id: 'openai', label: 'OpenAI шлюз', sub: 'Серверный OPENAI_API' },
                          ] as { id: AiCloudProvider; label: string; sub: string }[]
                        ).map((opt) => {
                          const active = (settings.aiCloudProvider || 'auto') === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => onChange({ ...settings, aiCloudProvider: opt.id })}
                              className={`text-left px-2.5 py-2 rounded-xl border transition cursor-pointer ${
                                active
                                  ? 'bg-[#7A68E6]/25 border-[#9B8AFB]/70 text-white'
                                  : 'bg-black/25 border-white/10 text-slate-300 hover:border-white/25'
                              }`}
                            >
                              <div className="text-[11px] font-extrabold leading-tight">{opt.label}</div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{opt.sub}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Предупреждение о приватности и статическом хостинге */}
                  <div className="rounded-xl bg-amber-500/12 border border-amber-400/35 p-2.5 space-y-1.5">
                    {typeof window !== 'undefined' &&
                      /\.github\.io$|\.pages\.dev$|\.netlify\.app$/i.test(window.location.hostname) && (
                        <p className="text-[11px] leading-relaxed text-amber-200 font-semibold">
                          ℹ️ На GitHub Pages нет Node.js-сервера для облачного API — ответы будут
                          автоматически выполняться встроенным Офлайн-аналитиком. Для облачного API
                          открывайте приложение на сервере с настроенным ключом в Settings → Secrets.
                        </p>
                      )}
                    <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-200">
                      <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
                      <span>Конфиденциальность облачного API</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-amber-100/90">
                      При включённой передаче сводки в облако отправляются вопрос, найденные фрагменты
                      Базы знаний и агрегированные суммы за период. ПИН-код и фото чеков{' '}
                      <b>никогда не отправляются</b>. Вы можете отключить передачу сводки ниже.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ДЕТАЛЬНЫЕ НАСТРОЙКИ ПОВЕДЕНИЯ ИИ (для всех режимов) */}
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-3">
            <div className="flex items-center gap-2 text-xs font-extrabold text-white">
              <SlidersHorizontal className="w-4 h-4 text-[#9B8AFB] shrink-0" />
              <span>Детальные настройки поведения ИИ</span>
            </div>

            {/* Стиль ответов */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300">Формат и глубина ответов</div>
              <div className="grid grid-cols-3 gap-1.5">
                {(
                  [
                    { id: 'concise', label: 'Кратко', sub: '3–5 пунктов' },
                    { id: 'balanced', label: 'Баланс', sub: 'Оптимально' },
                    { id: 'detailed', label: 'Подробно', sub: 'С расчётами' },
                  ] as { id: AiResponseStyle; label: string; sub: string }[]
                ).map((st) => {
                  const active = (settings.aiResponseStyle || 'balanced') === st.id;
                  return (
                    <button
                      key={st.id}
                      type="button"
                      onClick={() => onChange({ ...settings, aiResponseStyle: st.id })}
                      className={`py-2 px-2 rounded-xl border text-center cursor-pointer transition ${
                        active
                          ? 'bg-emerald-500/18 border-emerald-400/60 text-white'
                          : 'bg-black/20 border-white/10 text-slate-300 hover:border-white/25'
                      }`}
                    >
                      <div className="text-[11px] font-extrabold">{st.label}</div>
                      <div className="text-[10px] text-slate-400">{st.sub}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Глубина памяти диалога */}
            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10">
              <div>
                <div className="text-xs font-bold text-slate-100">Память диалога</div>
                <div className="fin-sub">Сколько последних реплик учитывать</div>
              </div>
              <div className="flex gap-1">
                {[2, 4, 6].map((turns) => (
                  <button
                    key={turns}
                    type="button"
                    onClick={() => onChange({ ...settings, aiHistoryTurns: turns })}
                    className={`w-8 h-8 rounded-lg text-xs font-extrabold border cursor-pointer transition ${
                      (settings.aiHistoryTurns || 4) === turns
                        ? 'bg-emerald-500/20 border-emerald-400/60 text-white'
                        : 'bg-black/25 border-white/10 text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {turns}
                  </button>
                ))}
              </div>
            </div>

            {/* Тумблеры контекста и строгости */}
            <div className="space-y-2.5 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-slate-100">Строго по фактам и Базе знаний</div>
                  <div className="fin-sub">Запрещает выдумывать цифры и законы без источников</div>
                </div>
                <ToggleSwitch
                  checked={settings.aiStrictMode !== false}
                  onChange={(v) => onChange({ ...settings, aiStrictMode: v })}
                  label="Строгий режим по фактам"
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-slate-100">Передавать сводку бюджета и ИИС</div>
                  <div className="fin-sub">Учитывать ваши реальные доходы, траты и активы</div>
                </div>
                <ToggleSwitch
                  checked={settings.aiIncludeFinanceContext !== false}
                  onChange={(v) => onChange({ ...settings, aiIncludeFinanceContext: v })}
                  label="Передавать финансовую сводку"
                />
              </div>

              <div className="flex items-center justify-between gap-2 text-xs">
                <div>
                  <div className="font-bold text-slate-100">Подключать Базу знаний и ссылки</div>
                  <div className="fin-sub">Искать ответы в выжимках и доверенных источниках</div>
                </div>
                <ToggleSwitch
                  checked={settings.aiUseKnowledgeBase !== false}
                  onChange={(v) => onChange({ ...settings, aiUseKnowledgeBase: v })}
                  label="Подключать Базу знаний"
                />
              </div>
            </div>

            {/* Персональная инструкция для ИИ */}
            <div className="space-y-1.5 pt-2 border-t border-white/10">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-bold text-slate-200">Персональная инструкция для ИИ</span>
                <span className="text-slate-400 tabular-nums">
                  {(settings.aiCustomInstruction || '').length}/800
                </span>
              </div>
              <textarea
                rows={2}
                maxLength={800}
                value={settings.aiCustomInstruction || ''}
                onChange={(e) => onChange({ ...settings, aiCustomInstruction: e.target.value })}
                placeholder="Например: Всегда оценивай траты с точки зрения накопления на подушку 300 000 ₽ и сравнивай вклады с ОФЗ..."
                className="fin-input w-full text-xs resize-y"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setInnerTab('kb')}
            className="fin-btn ghost w-full flex items-center justify-center gap-2 text-emerald-200 border-emerald-400/35"
          >
            <BookOpen className="w-4 h-4" />
            <span>Перейти к обучению ИИ, выжимкам и ссылкам →</span>
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Краткая памятка «Как обучать ИИ» */}
          <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/30 p-3 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-200">
              <Sparkles className="w-4 h-4 shrink-0" />
              <span>Как обучать ИИ-Советника</span>
            </div>
            <div className="text-[11px] text-slate-200 leading-relaxed space-y-1">
              <div>
                <b>1. Выжимки и файлы:</b> вставляйте тексты или загружайте <b>.txt / .md / .csv</b> —
                они сохраняются локально и сразу работают даже без интернета.
              </div>
              <div>
                <b>2. Доверенные ссылки:</b> добавляйте открытые источники (ЦБ РФ, Мосбиржа, RSS,
                справочные страницы) — приложение само обновляет их при каждом запуске.
              </div>
              <div>
                <b>3. Применение везде:</b> выжимки и свежий кэш ссылок используются и в Офлайн-аналитике,
                и в локальной нейросети, и в Облачном API.
              </div>
            </div>
          </div>

          {/* БЛОК 1: ВЫЖИМКИ И ФАЙЛЫ ДЛЯ ЛОКАЛЬНОГО ИИ */}
          <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Выжимки для локального ИИ ({knowledgeBase.rules.length})</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleInsertSampleTemplate}
                  className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[10px] font-bold text-slate-200 cursor-pointer transition"
                  title="Подставить шаблон для редактирования"
                >
                  Шаблон
                </button>
                <button
                  type="button"
                  onClick={handleExportKnowledgeBase}
                  className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[10px] font-bold text-slate-200 cursor-pointer transition"
                  title="Сохранить Базу знаний в JSON"
                >
                  Экспорт
                </button>
                <button
                  type="button"
                  onClick={() => importKbInputRef.current?.click()}
                  className="px-2 py-1 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-[10px] font-bold text-slate-200 cursor-pointer transition"
                  title="Загрузить Базу знаний из JSON"
                >
                  Импорт
                </button>
                <input
                  ref={importKbInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={(e) => void handleImportKnowledgeBase(e)}
                  className="hidden"
                />
              </div>
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={ruleTitle}
                onChange={(e) => setRuleTitle(e.target.value)}
                placeholder="Тема выжимки (например: Лимиты ИИС-3, НДФЛ 13%, условия вклада)"
                className="fin-input w-full text-xs"
              />
              <textarea
                rows={3}
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                placeholder="Вставьте выжимку из закона, лимиты, тарифы банка или свои правила для ИИ..."
                className="fin-input w-full text-xs resize-y"
              />
              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleAddOrSaveRule}
                  className="fin-btn sm flex-1 flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{editingRuleId !== null ? 'Сохранить изменения' : 'Добавить выжимку'}</span>
                </button>
                {editingRuleId !== null && (
                  <button
                    type="button"
                    onClick={handleCancelEditRule}
                    className="fin-btn ghost sm"
                  >
                    Отмена
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="fin-btn ghost sm flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>Загрузить .txt / .md</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.md,.csv,text/plain,text/markdown,text/csv"
                  onChange={(e) => void handleUploadRuleFiles(e)}
                  className="hidden"
                />
              </div>
            </div>

            {/* Список сохранённых выжимок */}
            {knowledgeBase.rules.length > 0 ? (
              <div className="space-y-1.5 max-h-52 overflow-y-auto pr-0.5 pt-1">
                {knowledgeBase.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className={`rounded-xl bg-black/25 border p-2.5 flex items-start justify-between gap-2 ${
                      editingRuleId === rule.id ? 'border-emerald-400/60' : 'border-white/10'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white">
                        <FileText className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                        <span className="truncate">{rule.title}</span>
                      </div>
                      <div className="text-[11px] text-slate-300 line-clamp-2 mt-0.5 leading-snug">
                        {rule.content}
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => handleStartEditRule(rule)}
                        className="p-1.5 rounded-lg text-slate-300 hover:bg-white/10 cursor-pointer"
                        title="Редактировать выжимку"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteRule(rule.id)}
                        className="p-1.5 rounded-lg text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                        title="Удалить выжимку"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[11px] text-slate-400 text-center py-2 border border-dashed border-white/10 rounded-xl">
                Выжимок пока нет — добавьте первую заметку или загрузите файл .txt / .md.
              </div>
            )}
          </div>

          {/* БЛОК 2: ДОВЕРЕННЫЕ ССЫЛКИ С АВТООБНОВЛЕНИЕМ ПРИ КАЖДОМ ЗАПУСКЕ */}
          <div className="rounded-2xl bg-[var(--fld)] border border-cyan-400/30 p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
                  <Globe className="w-4 h-4 text-cyan-300 shrink-0" />
                  <span>Доверенные онлайн-источники</span>
                </div>
                <div className="fin-sub">
                  ИИ опирается на свежие данные с указанных вами сайтов и API
                </div>
              </div>
              <ToggleSwitch
                checked={knowledgeBase.onlineSearchEnabled}
                onChange={(v) => void handleToggleOnlineSearch(v)}
                label="Включить доверенные онлайн-источники"
              />
            </div>

            <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/10 text-xs">
              <div className="min-w-0">
                <div className="font-bold text-slate-100">Обновлять при каждом запуске</div>
                <div className="fin-sub">
                  Свежая загрузка включённых ссылок при открытии приложения
                  {knowledgeBase.lastAutoSyncAt
                    ? ` · обновлено в ${new Date(knowledgeBase.lastAutoSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </div>
              </div>
              <ToggleSwitch
                checked={knowledgeBase.autoSyncOnLaunch !== false}
                disabled={!knowledgeBase.onlineSearchEnabled}
                onChange={(v) =>
                  onChangeKnowledgeBase({
                    ...knowledgeBase,
                    autoSyncOnLaunch: v,
                  })
                }
                label="Обновлять при каждом запуске"
              />
            </div>

            <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/25 px-2.5 py-2 text-[11px] text-emerald-100/90 leading-snug flex items-start gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <span>
                <b>Безопасная загрузка:</b> ваши вопросы, суммы и активы <b>не передаются</b> на эти
                сайты. Программа лишь скачивает открытую ленту в локальный кэш, очищает HTML и ищет
                нужные факты у вас на устройстве.
              </span>
            </div>

            {/* Главная кнопка добавления доверенной ссылки + кнопка обновления */}
            <div className="flex gap-1.5 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setShowAddSourceForm((v) => !v);
                  window.setTimeout(() => sourceUrlInputRef.current?.focus(), 60);
                }}
                className="fin-btn sm flex-1 flex items-center justify-center gap-1.5"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>+ Добавить доверенную ссылку</span>
              </button>
              <button
                type="button"
                disabled={syncingSources || !knowledgeBase.onlineSearchEnabled}
                onClick={() => void handleRefreshOnlineSources()}
                className="fin-btn ghost sm flex items-center justify-center gap-1.5 disabled:opacity-45"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncingSources ? 'animate-spin' : ''}`} />
                <span>{syncingSources ? 'Загрузка...' : 'Обновить все'}</span>
              </button>
            </div>

            {/* Форма добавления доверенной ссылки */}
            {showAddSourceForm && (
              <div className="rounded-xl bg-black/30 border border-cyan-400/40 p-2.5 space-y-2">
                <div className="text-[11px] font-bold text-cyan-200">
                  Новая доверенная ссылка (HTTPS — RSS, JSON, API или статья)
                </div>
                <input
                  type="text"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="Название (например: Курсы ЦБ РФ, Блог брокера, Новости)"
                  className="fin-input w-full text-xs"
                />
                <input
                  ref={sourceUrlInputRef}
                  type="url"
                  value={newSourceUrl}
                  onChange={(e) => {
                    setNewSourceUrl(e.target.value);
                    setSourceUrlError(null);
                  }}
                  placeholder="https://..."
                  className="fin-input w-full text-xs"
                />
                {sourceUrlError && (
                  <div className="text-[11px] text-rose-300">{sourceUrlError}</div>
                )}
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => void handleAddCustomSource()}
                    className="fin-btn sm flex-1 flex items-center justify-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Сохранить и загрузить</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddSourceForm(false);
                      setSourceUrlError(null);
                    }}
                    className="fin-btn ghost sm"
                  >
                    Отмена
                  </button>
                </div>
              </div>
            )}

            {/* Быстрое добавление проверенных источников */}
            {PRESET_TRUSTED_SOURCES.some((p) => !knowledgeBase.sources.some((s) => s.url === p.url)) && (
              <div className="space-y-1.5">
                <div className="text-[11px] font-bold text-slate-300">
                  Быстро подключить проверенный источник:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESET_TRUSTED_SOURCES.filter(
                    (p) => !knowledgeBase.sources.some((s) => s.url === p.url)
                  ).map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      disabled={syncingSourceId !== null}
                      onClick={() => void handleAddPresetSource(preset)}
                      className="px-2.5 py-1 rounded-lg bg-cyan-500/12 hover:bg-cyan-500/22 border border-cyan-400/35 text-[11px] font-bold text-cyan-200 cursor-pointer transition disabled:opacity-50"
                    >
                      + {preset.name.split(' (')[0]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Список доверенных источников */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-bold text-slate-300">
                Подключённые источники ({knowledgeBase.sources.filter((s) => s.enabled).length} актив. из{' '}
                {knowledgeBase.sources.length})
              </div>
              {knowledgeBase.sources.map((src) => {
                const rec = onlineCache[src.id];
                const entriesCount = rec?.entries?.length || 0;
                const isSyncingOne = syncingSourceId === src.id;
                return (
                  <div
                    key={src.id}
                    className="rounded-xl bg-black/25 border border-white/10 px-2.5 py-2 flex items-start justify-between gap-2"
                  >
                    <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={src.enabled}
                        onChange={(e) => handleToggleSource(src.id, e.target.checked)}
                        className="mt-0.5 w-4 h-4 accent-cyan-400 rounded shrink-0 cursor-pointer"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold text-white leading-tight break-words">
                          {src.name}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">{src.url}</div>
                        {rec && (
                          <div
                            className={`text-[10px] mt-0.5 ${
                              rec.status === 'ok' ? 'text-emerald-300' : 'text-amber-300'
                            }`}
                          >
                            {rec.status === 'ok'
                              ? `В кэше: ${entriesCount} записей · ${new Date(rec.fetchedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                              : rec.error || 'Не удалось обновить'}
                          </div>
                        )}
                      </div>
                    </label>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        disabled={isSyncingOne || syncingSources}
                        onClick={() => void handleRefreshSingleSource(src)}
                        className="p-1.5 rounded-lg text-cyan-200 hover:bg-cyan-500/15 cursor-pointer disabled:opacity-45"
                        title="Обновить этот источник сейчас"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isSyncingOne ? 'animate-spin' : ''}`} />
                      </button>
                      {!src.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSource(src.id)}
                          className="p-1.5 rounded-lg text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                          title="Удалить источник"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-[var(--line)] flex items-center justify-between gap-2 text-[11px] text-slate-400">
        <span>Версия 2.7 · ИИС + База знаний + Android APK</span>
        <button
          type="button"
          onClick={async () => {
            try {
              if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map((r) => r.unregister()));
              }
              if (typeof caches !== 'undefined') {
                const keys = await caches.keys();
                await Promise.all(
                  keys
                    .filter((k) => !k.toLowerCase().includes('webllm') && !k.toLowerCase().includes('mlc'))
                    .map((k) => caches.delete(k))
                );
              }
            } catch {
              // ignore
            }
            window.location.reload();
          }}
          className="px-2.5 py-1 rounded-lg bg-[var(--fld)] border border-[var(--line)] text-slate-200 font-semibold hover:bg-white/10 cursor-pointer transition"
        >
          Обновить кэш
        </button>
      </div>
    </ModalShell>
  );
}
