import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Bot,
  Cloud,
  Cpu,
  Download,
  FileText,
  Globe,
  HardDrive,
  LayoutGrid,
  Loader2,
  Lock,
  Palette,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  AiMode,
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
  syncEnabledOnlineSources,
  validateSafeSourceUrl,
} from '../utils/knowledgeBase';
import { uid } from '../utils/finance';
import { ModalShell } from './Modals';
import { PWAInstallButton } from './PWAInstallButton';

interface AppSettingsModalProps {
  settings: UiSettings;
  knowledgeBase: KnowledgeBaseState;
  initialTab?: 'layout' | 'ai';
  activePin?: string | null;
  fontLabel?: string;
  onOpenPin?: () => void;
  onCycleFont?: () => void;
  onChange: (next: UiSettings) => void;
  onChangeKnowledgeBase: (next: KnowledgeBaseState) => void;
  onClose: () => void;
  onShowToast: (msg: string) => void;
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
  onClose,
  onShowToast,
}: AppSettingsModalProps) {
  const [innerTab, setInnerTab] = useState<'layout' | 'ai'>(initialTab);
  const [llmState, setLlmState] = useState<LocalLlmState>(() => getLocalLlmState());
  const webGpuOk = isWebGpuSupported();

  // Knowledge Base form state
  const [ruleTitle, setRuleTitle] = useState('');
  const [ruleText, setRuleText] = useState('');
  const [newSourceName, setNewSourceName] = useState('');
  const [newSourceUrl, setNewSourceUrl] = useState('');
  const [sourceUrlError, setSourceUrlError] = useState<string | null>(null);
  const [onlineCache, setOnlineCache] = useState<OnlineCacheMap>({});
  const [syncingSources, setSyncingSources] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return subscribeLocalLlm(setLlmState);
  }, []);

  useEffect(() => {
    if (innerTab === 'ai') {
      loadOnlineCacheMap()
        .then(setOnlineCache)
        .catch(() => {});
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
  const handleAddRule = () => {
    const content = ruleText.trim();
    if (!content) {
      onShowToast('Введите текст правила или выжимки.');
      return;
    }
    const autoTitle =
      ruleTitle.trim() ||
      content.split(/\n/)[0].replace(/^#+\s*/, '').trim().slice(0, 60) ||
      'Правило из базы знаний';
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
    onShowToast('Правило сохранено в Базу знаний (IndexedDB).');
  };

  const handleUploadRuleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name)) {
      onShowToast('Поддерживаются только текстовые файлы .txt и .md.');
      return;
    }
    if (file.size > MAX_RULE_FILE_BYTES) {
      onShowToast('Файл слишком большой (максимум 512 КБ). Разделите текст на выжимки.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result.trim() : '';
      if (!text) {
        onShowToast('Файл пустой.');
        return;
      }
      const cleanName = file.name.replace(/\.(txt|md)$/i, '');
      const nextRule: KnowledgeRule = {
        id: uid(),
        title: cleanName || 'Загруженный документ',
        content: text,
        sourceType: 'file',
        fileName: file.name,
        createdAt: Date.now(),
      };
      onChangeKnowledgeBase({
        ...knowledgeBase,
        rules: [nextRule, ...knowledgeBase.rules],
      });
      onShowToast(`Файл «${file.name}» добавлен в Базу знаний.`);
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleDeleteRule = (id: number) => {
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
        const updated = await syncEnabledOnlineSources(knowledgeBase.sources);
        setOnlineCache(updated);
        onShowToast('Онлайн-источники включены и загружены в локальный кэш.');
      } catch {
        onShowToast('Онлайн-поиск включён. Нажмите «Обновить» при наличии интернета.');
      } finally {
        setSyncingSources(false);
      }
    } else {
      onShowToast('Поиск в онлайн-источниках отключён (100% офлайн).');
    }
  };

  const handleRefreshOnlineSources = async () => {
    if (syncingSources) return;
    setSyncingSources(true);
    try {
      const updated = await syncEnabledOnlineSources(knowledgeBase.sources, { force: true });
      setOnlineCache(updated);
      const okCount = knowledgeBase.sources.filter(
        (s) => s.enabled && updated[s.id]?.status === 'ok'
      ).length;
      onShowToast(`Обновлено источников: ${okCount} из ${knowledgeBase.sources.filter((s) => s.enabled).length}.`);
    } catch {
      onShowToast('Не удалось обновить часть источников.');
    } finally {
      setSyncingSources(false);
    }
  };

  const handleAddCustomSource = () => {
    setSourceUrlError(null);
    const check = validateSafeSourceUrl(newSourceUrl);
    if (!check.ok) {
      setSourceUrlError(check.error);
      return;
    }
    const label = newSourceName.trim() || new URL(check.url).hostname;
    const nextSrc: KnowledgeSource = {
      id: `src-custom-${uid()}`,
      name: label,
      url: check.url,
      kind: check.inferredKind,
      enabled: true,
      isDefault: false,
    };
    onChangeKnowledgeBase({
      ...knowledgeBase,
      sources: [...knowledgeBase.sources, nextSrc],
    });
    setNewSourceName('');
    setNewSourceUrl('');
    onShowToast(`Источник «${label}» добавлен.`);
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

  const handleResetDefaults = () => {
    const def = createDefaultUiSettings();
    onChange({
      ...def,
      themeStyle: settings.themeStyle,
      aiMode: settings.aiMode,
      localModelId: settings.localModelId,
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

      {/* Переключатель вкладок настроек */}
      <div className="grid grid-cols-2 gap-1.5 p-1 rounded-2xl bg-[var(--fld)] border border-[var(--line)]">
        <button
          type="button"
          onClick={() => setInnerTab('layout')}
          className={`py-2 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition ${
            innerTab === 'layout'
              ? 'bg-white/[0.14] text-white shadow-sm'
              : 'text-[var(--mute)] hover:text-white'
          }`}
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>Блоки и разделы</span>
        </button>
        <button
          type="button"
          onClick={() => setInnerTab('ai')}
          className={`py-2 px-3 rounded-xl text-xs font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition ${
            innerTab === 'ai'
              ? 'bg-[#7A68E6]/35 text-white border border-[#8B7AF0]/40'
              : 'text-[var(--mute)] hover:text-white'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>ИИ и Приватность</span>
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
      ) : (
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
              Режим работы ИИ-Советника
            </div>

            {/* 1. Офлайн-Советник (0 МБ) */}
            <button
              type="button"
              onClick={() => setAiMode('offline')}
              className={`w-full text-left rounded-2xl p-3 border transition cursor-pointer ${
                settings.aiMode === 'offline'
                  ? 'bg-emerald-500/15 border-emerald-400/60'
                  : 'bg-[var(--fld)] border-[var(--line)] hover:border-white/25'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Встроенный локальный ИИ-аналитик (0 МБ)</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                  По умолчанию · 100% приватно
                </span>
              </div>
              <div className="fin-sub mt-1">
                Мгновенный анализ бюджета, расходов, вкладов, ОФЗ, акций, вычета 13% по ИИС и
                подушки безопасности прямо на устройстве без интернета и без сбоев видеопамяти.
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
                onClick={() => setAiMode('local-llm')}
                className="w-full text-left cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                    <Cpu className="w-4 h-4 text-cyan-300 shrink-0" />
                    <span>Локальная нейросеть на телефоне</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-200">
                    Офлайн-ИИ
                  </span>
                </div>
                <div className="fin-sub mt-1">
                  Компактная нейросеть скачивается один раз в кэш браузера (лучше по Wi-Fi), а затем
                  отвечает на вопросы полностью без интернета и без отправки данных наружу.
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
                        : 'WebGPU в этом браузере не обнаружен. Для локальной нейросети нужен Chrome (Android/ПК) или Safari с WebGPU. Либо выберите «Офлайн-Советник (0 МБ)».'}
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
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] font-bold text-cyan-200 bg-cyan-500/20 px-1.5 py-0.5 rounded-md">
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

            {/* 3. Облачный ИИ-Советник (серверный Gemini) */}
            <div
              className={`rounded-2xl p-3 border transition space-y-2.5 ${
                settings.aiMode === 'cloud'
                  ? 'bg-[#7A68E6]/18 border-[#9B8AFB]/60'
                  : 'bg-[var(--fld)] border-[var(--line)]'
              }`}
            >
              <button
                type="button"
                onClick={() => setAiMode('cloud')}
                className="w-full text-left cursor-pointer"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                    <Cloud className="w-4 h-4 text-[#9B8AFB] shrink-0" />
                    <span>Облачный ИИ-Советник (онлайн)</span>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#7A68E6]/30 text-violet-200">
                    Интернет
                  </span>
                </div>
                <div className="fin-sub mt-1">
                  Точные ответы через защищённый серверный шлюз (поддерживаются Gemini и
                  OpenAI-совместимые серверы через переменные окружения на сервере — ключи никогда
                  не вводятся и не хранятся в браузере).
                </div>
              </button>

              {settings.aiMode === 'cloud' && (
                <div className="rounded-xl bg-amber-500/12 border border-amber-400/40 p-2.5 space-y-1.5">
                  {typeof window !== 'undefined' &&
                    /\.github\.io$|\.pages\.dev$|\.netlify\.app$/i.test(window.location.hostname) && (
                      <p className="text-[11px] leading-relaxed text-amber-200 font-semibold">
                        ℹ️ На GitHub Pages нет серверного бэкенда для облачного ИИ — ответы будут
                        автоматически рассчитываться встроенным Офлайн-Советником. Рекомендуем
                        выбрать «Офлайн-Советник (0 МБ)» или «Локальную нейросеть (Adreno / f32)».
                      </p>
                    )}
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-200">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-300" />
                    <span>Предупреждение о конфиденциальности</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-amber-100/90">
                    При использовании облачного ИИ ваши вопросы (и голосовые записи при диктовке),
                    а также агрегированная сводка бюджета за выбранный период (суммы доходов,
                    расходов, категорий и вкладов) передаются через интернет на внешний сервер ИИ
                    для формирования ответа.
                  </p>
                  <p className="text-[11px] leading-relaxed text-amber-100/80">
                    ПИН-код и фотографии чеков <b>не отправляются</b>, однако при любом выходе в
                    сеть сохраняется риск обработки данных сторонним облачным сервисом. Для полной
                    автономности без передачи данных переключитесь на{' '}
                    <b>«Офлайн-Советник (0 МБ)»</b> или <b>«Локальную нейросеть на телефоне»</b>.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* НОВЫЙ БЛОК: БАЗА ЗНАНИЙ И ИСТОЧНИКИ (ОБУЧЕНИЕ ИИ) */}
          <div className="rounded-2xl bg-[var(--fld)] border border-emerald-400/30 p-3 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-extrabold text-xs text-white">
                <BookOpen className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>База знаний ассистента (выжимки и источники)</span>
              </div>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 shrink-0">
                {knowledgeBase.rules.length} правил
              </span>
            </div>

            <div className="fin-sub">
              Добавляйте свои выжимки из законов (например, лимиты вычетов ИИС-3, НДФЛ 13%, правила
              вкладов) или загрузите файл <b>.txt / .md</b>. Всё хранится локально в IndexedDB.
            </div>

            {/* а) Добавление правила / выжимки + загрузка .txt / .md */}
            <div className="space-y-2">
              <input
                type="text"
                value={ruleTitle}
                onChange={(e) => setRuleTitle(e.target.value)}
                placeholder="Название правила (например: Лимиты ИИС-3 и НДФЛ 13%)"
                className="fin-input w-full text-xs"
              />
              <textarea
                rows={3}
                value={ruleText}
                onChange={(e) => setRuleText(e.target.value)}
                placeholder="Вставьте выжимку из закона, лимиты, заметку или справочный текст..."
                className="fin-input w-full text-xs resize-y"
              />
              <div className="flex gap-1.5 flex-wrap">
                <button
                  type="button"
                  onClick={handleAddRule}
                  className="fin-btn sm flex-1 flex items-center justify-center gap-1.5"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Добавить правило / выжимку</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="fin-btn ghost sm flex items-center justify-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5" />
                  <span>.txt / .md</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".txt,.md,text/plain,text/markdown"
                  onChange={handleUploadRuleFile}
                  className="hidden"
                />
              </div>
            </div>

            {/* Список сохранённых выжимок */}
            {knowledgeBase.rules.length > 0 && (
              <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
                {knowledgeBase.rules.map((rule) => (
                  <div
                    key={rule.id}
                    className="rounded-xl bg-black/25 border border-white/10 p-2.5 flex items-start justify-between gap-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-white truncate">
                        <FileText className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                        <span className="truncate">{rule.title}</span>
                      </div>
                      <div className="text-[11px] text-slate-300 line-clamp-2 mt-0.5 leading-snug">
                        {rule.content}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteRule(rule.id)}
                      className="p-1.5 rounded-lg text-rose-300 hover:bg-rose-500/15 cursor-pointer shrink-0"
                      title="Удалить выжимку"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* б) Онлайн-ресурсы и тумблер приватности */}
            <div className="pt-2.5 border-t border-white/10 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-extrabold text-white">
                    <Globe className="w-3.5 h-3.5 text-cyan-300 shrink-0" />
                    <span>Разрешить поиск в онлайн-источниках</span>
                  </div>
                  <div className="fin-sub">
                    По умолчанию выключено (100% офлайн). При включении скачиваются только публичные
                    ленты и котировки.
                  </div>
                </div>
                <ToggleSwitch
                  checked={knowledgeBase.onlineSearchEnabled}
                  onChange={(v) => void handleToggleOnlineSearch(v)}
                  label="Разрешить поиск в онлайн-источниках"
                />
              </div>

              <div className="rounded-xl bg-emerald-500/10 border border-emerald-400/25 px-2.5 py-2 text-[11px] text-emerald-100/90 leading-snug flex items-start gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
                <span>
                  <b>Приватность защищена:</b> текст ваших вопросов, суммы, траты и активы{' '}
                  <b>никогда не отправляются наружу</b>. Приложение только скачивает публичную ленту
                  в локальный кэш, очищает HTML и ищет совпадения на телефоне.
                </span>
              </div>

              {/* Список обновляемых онлайн-источников */}
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-slate-300">
                  Публичные источники ({knowledgeBase.sources.filter((s) => s.enabled).length} актив.)
                </span>
                <button
                  type="button"
                  disabled={syncingSources || !knowledgeBase.onlineSearchEnabled}
                  onClick={() => void handleRefreshOnlineSources()}
                  className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-400/35 text-[11px] font-bold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-45 cursor-pointer flex items-center gap-1 transition"
                >
                  <RefreshCw className={`w-3 h-3 ${syncingSources ? 'animate-spin' : ''}`} />
                  <span>{syncingSources ? 'Обновление...' : 'Обновить кэш'}</span>
                </button>
              </div>

              <div className="space-y-1.5">
                {knowledgeBase.sources.map((src) => {
                  const rec = onlineCache[src.id];
                  const entriesCount = rec?.entries?.length || 0;
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
                        <div className="min-w-0">
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
                      {!src.isDefault && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSource(src.id)}
                          className="p-1 rounded-lg text-rose-300 hover:bg-rose-500/15 cursor-pointer shrink-0"
                          title="Удалить источник"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Добавление своей ссылки */}
              <div className="space-y-1.5 pt-1">
                <input
                  type="text"
                  value={newSourceName}
                  onChange={(e) => setNewSourceName(e.target.value)}
                  placeholder="Название источника (например: Справка ЦБ или RSS)"
                  className="fin-input w-full text-xs"
                />
                <div className="flex gap-1.5">
                  <input
                    type="url"
                    value={newSourceUrl}
                    onChange={(e) => {
                      setNewSourceUrl(e.target.value);
                      setSourceUrlError(null);
                    }}
                    placeholder="https://... (RSS, JSON или публичная страница)"
                    className="fin-input flex-1 text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleAddCustomSource}
                    className="fin-btn ghost sm shrink-0 flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить</span>
                  </button>
                </div>
                {sourceUrlError && (
                  <div className="text-[11px] text-rose-300">{sourceUrlError}</div>
                )}
              </div>
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
