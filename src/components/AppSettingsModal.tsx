import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  Cloud,
  Cpu,
  Download,
  HardDrive,
  LayoutGrid,
  Loader2,
  Lock,
  Palette,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { AiMode, TabId, ThemeStyle, UiSettings } from '../types';
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
import { ModalShell } from './Modals';
import { PWAInstallButton } from './PWAInstallButton';

interface AppSettingsModalProps {
  settings: UiSettings;
  initialTab?: 'layout' | 'ai';
  activePin?: string | null;
  fontLabel?: string;
  onOpenPin?: () => void;
  onCycleFont?: () => void;
  onChange: (next: UiSettings) => void;
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
    label: 'Бюджет и Вклады',
    accent: '#19A886',
    sections: [
      { id: 'sec-inc-add', label: 'Записать доход' },
      { id: 'sec-inc-list', label: 'Список доходов за период' },
      { id: 'sec-goals-tank', label: 'Цель и Лимит (резервуары)' },
      { id: 'sec-deposits', label: 'Вклады и сбережения' },
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
  initialTab = 'layout',
  activePin,
  fontLabel = 'А+',
  onOpenPin,
  onCycleFont,
  onChange,
  onClose,
  onShowToast,
}: AppSettingsModalProps) {
  const [innerTab, setInnerTab] = useState<'layout' | 'ai'>(initialTab);
  const [llmState, setLlmState] = useState<LocalLlmState>(() => getLocalLlmState());
  const webGpuOk = isWebGpuSupported();

  useEffect(() => {
    return subscribeLocalLlm(setLlmState);
  }, []);

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

  const setAiMode = (mode: AiMode) => {
    onChange({ ...settings, aiMode: mode });
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
                  <span>Встроенный Офлайн-Советник (0 МБ)</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">
                  100% приватно
                </span>
              </div>
              <div className="fin-sub mt-1">
                Мгновенные расчёты бюджета, вычета 13% НДФЛ, подушки и вкладов прямо в устройстве.
                Никаких запросов в интернет.
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
                          onClick={() => onChange({ ...settings, localModelId: m.id })}
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
                  Самые точные ответы и расшифровка голосовых вопросов через защищённое серверное
                  подключение приложения (вводить API-ключ в браузере не требуется).
                </div>
              </button>

              {settings.aiMode === 'cloud' && (
                <div className="rounded-xl bg-amber-500/12 border border-amber-400/40 p-2.5 space-y-1.5">
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
        </div>
      )}
    </ModalShell>
  );
}
