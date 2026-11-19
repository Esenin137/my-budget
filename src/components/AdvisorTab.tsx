import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Download,
  Flame,
  Loader2,
  MessageCircle,
  Mic,
  Plus,
  Send,
  Settings,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import { AppState, ChatMessage, HabitItem, PeriodMode, Transaction, UiSettings } from '../types';
import {
  analyzeFinancialHealth,
  formatMoney,
  getPeriodTitle,
  runLocalAdvisor,
  uid,
} from '../utils/finance';
import { blobToBase64, formatDuration } from '../utils/sound';
import { isoDate } from '../utils/storage';
import {
  askLocalLlm,
  getLocalLlmState,
  isWebGpuSupported,
  loadLocalModel,
  LOCAL_LLM_MODELS,
  LocalLlmState,
  subscribeLocalLlm,
} from '../utils/localLlm';
import GlassSection from './GlassSection';

interface AdvisorTabProps {
  state: AppState;
  curDate: Date;
  viewMode: PeriodMode;
  periodTx: Transaction[];
  collapsedSecs: string[];
  uiSettings: UiSettings;
  onToggleSec: (id: string) => void;
  onApplyAdvisorPatch: (patch: Partial<AppState>) => void;
  onOpenAiSettings: () => void;
}

const QUICK_PROMPTS = [
  { icon: '🩺', label: 'Полный разбор бюджета', query: 'Сделай полный разбор моего бюджета' },
  { icon: '💸', label: 'Вернуть 13% НДФЛ', query: 'Сколько я могу вернуть налоговым вычетом 13%?' },
  { icon: '🛡️', label: 'Подушка безопасности', query: 'Рассчитай мою подушку безопасности' },
  { icon: '📈', label: 'Вклад vs ИИС и ОФЗ', query: 'Что выгоднее: вклад, фонд SBMM или ОФЗ на ИИС?' },
  { icon: '🛟', label: 'План выхода из минуса', query: 'Как выбраться из минуса и закрыть кредиты?' },
  { icon: '🏦', label: 'Автоправило: 5% на вклад', query: 'Я готов отдавать 5% от остатка на вклад под 18%' },
];

const HABIT_ICONS = ['🌱', '💧', '🏃', '📖', '💰', '🧘', '🥗', '🛌'];

function getLast7DaysIso(): string[] {
  const res: string[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    res.push(isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i)));
  }
  return res;
}

function calcHabitStreak(completedDates: string[], todayIso: string): number {
  if (!Array.isArray(completedDates) || completedDates.length === 0) return 0;
  const set = new Set(completedDates);
  const now = new Date();
  let offset = set.has(todayIso) ? 0 : 1;
  let streak = 0;
  while (true) {
    const d = isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
    if (set.has(d)) {
      streak += 1;
      offset += 1;
    } else {
      break;
    }
  }
  return streak;
}

export default function AdvisorTab({
  state,
  curDate,
  viewMode,
  periodTx,
  collapsedSecs,
  uiSettings,
  onToggleSec,
  onApplyAdvisorPatch,
  onOpenAiSettings,
}: AdvisorTabProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 1,
      isUser: false,
      html: 'Привет! Я ваш персональный ИИ-Советник. Нажмите на микрофон 🎙️, чтобы задать финансовый вопрос голосом, выберите карточку ниже или напишите в поле!',
    },
  ]);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [busyStage, setBusyStage] = useState<'idle' | 'transcribing' | 'thinking'>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [llmState, setLlmState] = useState<LocalLlmState>(() => getLocalLlmState());
  const [showAddHabit, setShowAddHabit] = useState(false);
  const [newHabitTitle, setNewHabitTitle] = useState('');
  const [newHabitIcon, setNewHabitIcon] = useState('🌱');

  const logRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const recordStartRef = useRef<number>(0);
  const cancelRecordingRef = useRef<boolean>(false);

  const H = useMemo(() => analyzeFinancialHealth(periodTx, curDate), [periodTx, curDate]);
  const outTx = useMemo(() => periodTx.filter((t) => t.t !== 'in'), [periodTx]);

  useEffect(() => {
    return subscribeLocalLlm(setLlmState);
  }, []);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [messages, busyStage]);

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (speechRecRef.current) {
        try {
          speechRecRef.current.abort();
        } catch {
          // ignore
        }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        cancelRecordingRef.current = true;
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const buildFinancialContext = () => {
    const byCat: Record<string, number> = {};
    outTx.forEach((t) => {
      byCat[t.c] = (byCat[t.c] || 0) + t.a;
    });
    const topCategories = Object.entries(byCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, amount]) => ({ name, amount }));

    const depositsTotal = state.deposits.reduce((sum, d) => sum + (d.sum || 0), 0);
    const depositsSummary = state.deposits
      .slice(0, 5)
      .map((d) => `${d.name}: ${Math.round(d.sum)} ₽ под ${d.rate}%`)
      .join('; ');

    return {
      sumIn: H.sumIn,
      sumOut: H.sumOut,
      left: H.left,
      dailyLimit: H.safeDaily,
      daysLeft: H.remDays,
      fixedSum: H.fixedSum,
      flexSum: H.flexSum,
      depositsTotal,
      depositsSummary,
      topCategories,
      socialRefund: H.socialRefund,
      taxMort: H.taxMort,
      budgetLimit: state.budget,
      saveRuleLabel: state.saveRule ? state.saveRule.label : null,
      periodLabel: getPeriodTitle(viewMode, curDate),
    };
  };

  const buildTextSnapshot = () => {
    const ctx = buildFinancialContext();
    const topCats = ctx.topCategories.map((c) => `${c.name}: ${Math.round(c.amount)} ₽`).join(', ');
    return [
      `Период: ${ctx.periodLabel}`,
      `Доходы: ${Math.round(ctx.sumIn)} ₽, Расходы: ${Math.round(ctx.sumOut)} ₽, Остаток: ${Math.round(ctx.left)} ₽`,
      `Безопасный лимит: ${Math.round(ctx.dailyLimit)} ₽/день (осталось дней: ${ctx.daysLeft})`,
      `Обязательные: ${Math.round(ctx.fixedSum)} ₽, Гибкие: ${Math.round(ctx.flexSum)} ₽`,
      `Топ трат: ${topCats || 'нет'}`,
      `Вклады: ${Math.round(ctx.depositsTotal)} ₽`,
      `Вычет 13% НДФЛ: ${Math.round(ctx.socialRefund)} ₽`,
    ].join('\n');
  };

  const askQuestion = async (rawQ: string, viaVoice = false) => {
    const q = rawQ.trim();
    if (!q || busyStage !== 'idle') return;
    setInput('');
    setVoiceError(null);

    const localCheck = runLocalAdvisor(q, state, periodTx, curDate);
    if (localCheck.statePatch) {
      onApplyAdvisorPatch(localCheck.statePatch);
    }

    const userMsg: ChatMessage = { id: uid(), isUser: true, html: q, viaVoice };

    // 1) OFFLINE MODE (0 MB, instant local calculator)
    if (uiSettings.aiMode === 'offline') {
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: uid() + 1, isUser: false, html: localCheck.reply },
      ]);
      return;
    }

    // 2) LOCAL ON-DEVICE LLM (WebLLM, 100% offline in browser)
    if (uiSettings.aiMode === 'local-llm') {
      setMessages((prev) => [...prev, userMsg]);
      if (llmState.status !== 'ready') {
        setMessages((prev) => [
          ...prev,
          {
            id: uid() + 1,
            isUser: false,
            html: '📱 Локальная нейросеть ещё не загружена в память телефона. Нажмите кнопку «Загрузить модель» выше в этой карточке (или в Настройках приложения → ИИ и Приватность).',
            isError: true,
          },
        ]);
        return;
      }

      setBusyStage('thinking');
      try {
        const localHistory = messages
          .filter((m) => !m.isError)
          .slice(-4)
          .map((m) => ({
            role: (m.isUser ? 'user' : 'assistant') as 'user' | 'assistant',
            content: m.html,
          }));
        const reply = await askLocalLlm(q, buildTextSnapshot(), localHistory);
        const patchNote = localCheck.statePatch?.habits
          ? '\n\n✅ Новая привычка добавлена в трекер «Привычки и забота» ниже!'
          : localCheck.statePatch?.saveRule
          ? '\n\n✅ Автоправило накопления сохранено в разделе «Бюджет».'
          : '';
        setMessages((prev) => [
          ...prev,
          { id: uid() + 1, isUser: false, html: `${reply}${patchNote}` },
        ]);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Ошибка локальной нейросети.';
        setMessages((prev) => [
          ...prev,
          { id: uid() + 1, isUser: false, html: `⚠️ ${msg}`, isError: true },
        ]);
      } finally {
        setBusyStage('idle');
      }
      return;
    }

    // 3) CLOUD AI MODE (Server-side Gemini)
    const historyForApi = messages
      .filter((m) => !m.isError)
      .slice(-6)
      .map((m) => ({ role: (m.isUser ? 'user' : 'model') as 'user' | 'model', text: m.html }));

    setMessages((prev) => [...prev, userMsg]);
    setBusyStage('thinking');

    try {
      const resp = await fetch('/api/advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          context: buildFinancialContext(),
          history: historyForApi,
        }),
      });
      const rawText = await resp.text();
      let data: { reply?: string; error?: string } = {};
      try {
        data = JSON.parse(rawText) as { reply?: string; error?: string };
      } catch {
        // Static hosting without Node.js backend returns HTML 404 — fall back to offline advisor seamlessly
        setMessages((prev) => [
          ...prev,
          {
            id: uid() + 1,
            isUser: false,
            html: `${localCheck.reply}\n\nℹ️ Облачный сервер ИИ недоступен на этом хостинге — ответ рассчитан встроенным офлайн-советником.`,
          },
        ]);
        return;
      }
      if (!resp.ok || !data.reply) {
        throw new Error(data.error || 'Не удалось получить ответ от ИИ-Советника.');
      }

      const patchNote = localCheck.statePatch?.habits
        ? '\n\n✅ Новая привычка добавлена в трекер «Привычки и забота» ниже!'
        : localCheck.statePatch?.saveRule
        ? '\n\n✅ Автоправило накопления сохранено в разделе «Бюджет».'
        : '';

      setMessages((prev) => [
        ...prev,
        { id: uid() + 1, isUser: false, html: `${data.reply}${patchNote}` },
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка связи с ИИ-Советником.';
      setMessages((prev) => [
        ...prev,
        {
          id: uid() + 1,
          isUser: false,
          html: `${localCheck.reply}\n\n⚠️ ${msg}`,
        },
      ]);
    } finally {
      setBusyStage('idle');
    }
  };

  const cleanupRecordingHandles = () => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
      mediaStreamRef.current = null;
    }
    mediaRecorderRef.current = null;
    speechRecRef.current = null;
    setIsRecording(false);
    setRecordSec(0);
  };

  const startLocalSpeechRecognition = () => {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SR) {
      setVoiceError(
        'В офлайн/локальном режиме браузер не поддерживает встроенное распознавание речи. Вы можете ввести вопрос текстом или включить облачный ИИ в Настройках.'
      );
      return;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec: any = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      cancelRecordingRef.current = false;
      recordStartRef.current = Date.now();

      rec.onresult = (ev: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => {
        const transcript = ev.results?.[0]?.[0]?.transcript?.trim() || '';
        const cancelled = cancelRecordingRef.current;
        cleanupRecordingHandles();
        if (!cancelled && transcript) {
          askQuestion(transcript, true);
        }
      };
      rec.onerror = () => {
        cleanupRecordingHandles();
        setVoiceError('Не удалось распознать речь через браузер. Попробуйте ещё раз или введите текстом.');
      };
      rec.onend = () => {
        if (speechRecRef.current) cleanupRecordingHandles();
      };

      speechRecRef.current = rec;
      rec.start();
      setIsRecording(true);
      setRecordSec(0);
      timerRef.current = window.setInterval(() => {
        setRecordSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch {
      cleanupRecordingHandles();
      setVoiceError('Не удалось запустить микрофон в браузере.');
    }
  };

  const handleStartVoiceQuestion = async () => {
    if (busyStage !== 'idle' || isRecording) return;
    setVoiceError(null);

    // Keep voice 100% local/private when user chose Offline or Local LLM mode
    if (uiSettings.aiMode !== 'cloud') {
      startLocalSpeechRecognition();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setVoiceError('Ваш браузер не поддерживает запись с микрофона.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const preferredTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const chosenMime =
        typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
          ? preferredTypes.find((t) => MediaRecorder.isTypeSupported(t)) || ''
          : '';

      const recorder = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);

      chunksRef.current = [];
      cancelRecordingRef.current = false;
      recordStartRef.current = Date.now();

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const elapsedMs = Date.now() - recordStartRef.current;
        const wasCancelled = cancelRecordingRef.current;
        const recordedChunks = chunksRef.current.slice();
        const finalMime = recorder.mimeType || chosenMime || 'audio/webm';

        cleanupRecordingHandles();

        if (wasCancelled) return;
        if (elapsedMs < 400 || recordedChunks.length === 0) {
          setVoiceError('Запись слишком короткая. Нажмите, проговорите вопрос и нажмите «Отправить».');
          return;
        }

        const audioBlob = new Blob(recordedChunks, { type: finalMime });
        setBusyStage('transcribing');
        try {
          const audioBase64 = await blobToBase64(audioBlob);
          const resp = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64,
              mimeType: finalMime,
              context: 'advisor',
            }),
          });
          const rawText = await resp.text();
          let data: { text?: string; error?: string } = {};
          try {
            data = JSON.parse(rawText) as { text?: string; error?: string };
          } catch {
            throw new Error(
              'Облачная расшифровка речи недоступна на статическом хостинге. Переключите ИИ на «Офлайн» или «Локальная нейросеть» в Настройках — тогда голос распознаётся браузером.'
            );
          }
          if (!resp.ok || !data.text) {
            throw new Error(data.error || 'Не удалось распознать голосовой вопрос.');
          }
          setBusyStage('idle');
          await askQuestion(data.text, true);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Ошибка распознавания голоса.';
          setVoiceError(msg);
          setBusyStage('idle');
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start();
      setIsRecording(true);
      setRecordSec(0);

      timerRef.current = window.setInterval(() => {
        setRecordSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch {
      cleanupRecordingHandles();
      setVoiceError('Нет доступа к микрофону. Разрешите доступ в настройках браузера.');
    }
  };

  const handleStopVoiceQuestion = (cancel = false) => {
    if (speechRecRef.current) {
      cancelRecordingRef.current = cancel;
      try {
        if (cancel) speechRecRef.current.abort();
        else speechRecRef.current.stop();
      } catch {
        // ignore
      }
      if (cancel) cleanupRecordingHandles();
      return;
    }

    if (!mediaRecorderRef.current) return;
    cancelRecordingRef.current = cancel;
    if (mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    } else {
      cleanupRecordingHandles();
    }
  };

  const isBusy = busyStage !== 'idle';
  const selectedModelMeta =
    LOCAL_LLM_MODELS.find((m) => m.id === uiSettings.localModelId) || LOCAL_LLM_MODELS[0];

  const modeBadgeText =
    uiSettings.aiMode === 'offline'
      ? '🔒 Офлайн'
      : uiSettings.aiMode === 'local-llm'
      ? llmState.status === 'ready'
        ? '📱 Локальный ИИ'
        : '📱 Не загружен'
      : '☁️ Облако';

  const todayIso = isoDate(new Date());
  const last7Days = useMemo(() => getLast7DaysIso(), []);
  const habits = state.habits || [];

  const habitStats = useMemo(() => {
    const doneToday = habits.filter((h) => h.completedDates.includes(todayIso)).length;
    const streaks = habits.map((h) => calcHabitStreak(h.completedDates, todayIso));
    const bestStreak = streaks.length ? Math.max(...streaks) : 0;
    let careMessage =
      'Выберите полезные привычки и отмечайте их каждый день — я буду мягко поддерживать ваш ритм и подсказывать идеи.';
    if (habits.length > 0 && doneToday === habits.length) {
      careMessage = `🌟 Браво! Все ${habits.length} привычки на сегодня выполнены! Ваша дисциплина укрепляет и здоровье, и финансовое спокойствие.`;
    } else if (doneToday > 0) {
      careMessage = `👏 Уже выполнено ${doneToday} из ${habits.length} на сегодня${
        bestStreak >= 2 ? ` (лучшая серия — 🔥 ${bestStreak} дн.)` : ''
      }. Осталось совсем чуть-чуть — вы отлично справляетесь!`;
    } else if (bestStreak >= 2) {
      careMessage = `🔥 У вас серия ${bestStreak} дн. подряд! Не дайте ей прерваться — отметьте первую привычку сегодня.`;
    } else if (habits.length > 0) {
      careMessage =
        '☀️ Как проходит ваш день? Начните с самой лёгкой привычки — один маленький шаг сегодня даёт энергию на всю неделю.';
    }
    return { doneToday, bestStreak, careMessage };
  }, [habits, todayIso]);

  const handleToggleHabitToday = (habitId: number) => {
    const nextHabits = habits.map((h) => {
      if (h.id !== habitId) return h;
      const done = h.completedDates.includes(todayIso);
      return {
        ...h,
        completedDates: done
          ? h.completedDates.filter((d) => d !== todayIso)
          : [...h.completedDates, todayIso],
      };
    });
    onApplyAdvisorPatch({ habits: nextHabits });
  };

  const handleAddHabit = (e: React.FormEvent) => {
    e.preventDefault();
    const title = newHabitTitle.trim();
    if (!title) return;
    const item: HabitItem = {
      id: uid(),
      title: title.charAt(0).toUpperCase() + title.slice(1),
      icon: newHabitIcon,
      completedDates: [],
      createdAt: Date.now(),
    };
    onApplyAdvisorPatch({ habits: [...habits, item] });
    setNewHabitTitle('');
    setShowAddHabit(false);
  };

  const handleDeleteHabit = (id: number) => {
    onApplyAdvisorPatch({ habits: habits.filter((h) => h.id !== id) });
  };

  const handleDiscussHabitsWithAi = () => {
    const summary = habits
      .map((h) => {
        const done = h.completedDates.includes(todayIso) ? 'выполнено' : 'ещё нет';
        const st = calcHabitStreak(h.completedDates, todayIso);
        return `${h.icon} ${h.title} (${done}, серия ${st} дн.)`;
      })
      .join('; ');
    askQuestion(
      `Поддержи меня и дай короткий совет по моим привычкам на сегодня: ${summary || 'пока нет привычек, предложи 3 полезные для здоровья и финансов'}.`
    );
  };

  return (
    <>

      {uiSettings.aiEnabled && (
        <GlassSection
          id="sec-ai-doctor"
          title="🤖 Ваш Финансовый Помощник"
          helpText="Задавайте вопросы по бюджету, вычету 13% НДФЛ, вкладам или просите добавить новую привычку (например: «Добавь привычку прогулка 30 минут»). Режим работы (Офлайн / Локальный ИИ / Облако) настраивается через шестерёнку."
          rightExtra={
            <div className="flex items-center gap-1.5">
              <span className="fin-sub text-[11px]">{modeBadgeText}</span>
              <button
                type="button"
                onClick={onOpenAiSettings}
                title="Настройки ИИ и приватности"
                className="p-1 rounded-lg bg-white/8 hover:bg-white/15 text-slate-200 cursor-pointer"
              >
                <Settings className="w-3.5 h-3.5" />
              </button>
            </div>
          }
          collapsed={collapsedSecs.includes('sec-ai-doctor')}
          onToggleCollapse={onToggleSec}
        >
          <div className="ai-hero-banner">
            <div className="ai-bot-emblem">🤖</div>
            <div className="flex-1 min-w-0">
              <div className="font-extrabold text-sm text-white">Персональный ИИ-Советник</div>
              <div className="fin-sub">
                {uiSettings.aiMode === 'offline'
                  ? 'Локальные расчёты · 0 МБ · без выхода в интернет'
                  : uiSettings.aiMode === 'local-llm'
                  ? `Нейросеть на устройстве: ${selectedModelMeta.name}`
                  : 'Спросите голосом или текстом по вашим финансам'}
              </div>
            </div>
            {uiSettings.aiVoiceEnabled && (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => (isRecording ? handleStopVoiceQuestion(false) : handleStartVoiceQuestion())}
                className="px-3 py-2 rounded-xl font-extrabold text-xs flex items-center gap-1.5 shrink-0 cursor-pointer transition active:scale-95 disabled:opacity-50"
                style={
                  isRecording
                    ? {
                        background: 'linear-gradient(135deg, #F06253, #B91C1C)',
                        color: '#fff',
                        boxShadow: '0 0 18px rgba(240,98,83,.45)',
                      }
                    : {
                        background: 'linear-gradient(135deg, rgba(139,122,240,.32), rgba(25,168,134,.32))',
                        border: '1px solid rgba(139,122,240,.55)',
                        color: '#fff',
                      }
                }
              >
                {isRecording ? (
                  <>
                    <Square className="w-3.5 h-3.5 fill-current" />
                    <span className="tabular-nums">{formatDuration(recordSec)}</span>
                  </>
                ) : (
                  <>
                    <Mic className="w-3.5 h-3.5" />
                    <span>Голосом</span>
                  </>
                )}
              </button>
            )}
          </div>

          {/* Панель быстрой загрузки локальной нейросети в режиме local-llm */}
          {uiSettings.aiMode === 'local-llm' && llmState.status !== 'ready' && (
            <div className="rounded-2xl bg-cyan-500/10 border border-cyan-400/35 p-2.5 space-y-2">
              {llmState.status === 'loading' ? (
                <>
                  <div className="flex items-center justify-between text-xs font-bold text-cyan-200">
                    <span className="flex items-center gap-1.5">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Загрузка {selectedModelMeta.name}...
                    </span>
                    <span className="tabular-nums">{llmState.progress}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400 transition-all"
                      style={{ width: `${llmState.progress}%` }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-300 truncate">{llmState.statusText}</div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="text-xs text-cyan-100">
                    <b>{selectedModelMeta.name}</b> ({selectedModelMeta.sizeLabel}) — загрузите 1 раз для работы офлайн.
                  </div>
                  <button
                    type="button"
                    disabled={!isWebGpuSupported()}
                    onClick={() => loadLocalModel(uiSettings.localModelId)}
                    className="fin-btn sm flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Загрузить модель</span>
                  </button>
                </div>
              )}
              {llmState.error && <div className="text-[11px] text-rose-300">{llmState.error}</div>}
            </div>
          )}

          <div
            ref={logRef}
            className="h-56 overflow-y-auto rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-2.5 space-y-2"
          >
            {messages.map((m) => (
              <div key={m.id} className={`flex gap-2 items-end ${m.isUser ? 'justify-end' : ''}`}>
                {!m.isUser && (
                  <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#8B7AF0] to-[#5643C7] flex items-center justify-center text-xs shrink-0 shadow">
                    🤖
                  </span>
                )}
                <div
                  className={`px-3 py-2 rounded-2xl text-xs leading-relaxed max-w-[86%] whitespace-pre-line ${
                    m.isUser
                      ? 'bg-gradient-to-br from-[#19A886] to-[#0E7C66] text-white rounded-br-sm'
                      : m.isError
                      ? 'bg-rose-950/60 border border-rose-400/35 text-rose-100 rounded-bl-sm'
                      : 'bg-[#162C29] border border-emerald-400/20 text-slate-100 rounded-bl-sm'
                  }`}
                >
                  {m.viaVoice && (
                    <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-100/85 mb-0.5 flex items-center gap-1">
                      <Mic className="w-3 h-3" /> Голосовой вопрос
                    </div>
                  )}
                  {m.html}
                </div>
              </div>
            ))}

            {isBusy && (
              <div className="flex gap-2 items-end">
                <span className="w-7 h-7 rounded-full bg-gradient-to-br from-[#8B7AF0] to-[#5643C7] flex items-center justify-center text-xs shrink-0">
                  🤖
                </span>
                <div className="px-3 py-2 rounded-2xl rounded-bl-sm bg-[#162C29] border border-[#8B7AF0]/35 text-xs text-slate-200 flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#9B8AFB]" />
                  <span>
                    {busyStage === 'transcribing'
                      ? 'Распознаю ваш голосовой вопрос...'
                      : uiSettings.aiMode === 'local-llm'
                      ? 'Локальная нейросеть думает на телефоне...'
                      : 'ИИ-Советник готовит ответ...'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {uiSettings.aiQuickPrompts && (
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  disabled={isBusy || isRecording}
                  onClick={() => askQuestion(item.query)}
                  className="flex items-center gap-1.5 text-left p-2 rounded-xl bg-white/5 hover:bg-emerald-500/15 border border-white/12 text-[11px] font-bold text-slate-100 cursor-pointer transition disabled:opacity-50"
                >
                  <span className="w-6 h-6 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    {item.icon}
                  </span>
                  <span className="leading-tight">{item.label}</span>
                </button>
              ))}
            </div>
          )}

          {voiceError && (
            <div className="rounded-xl bg-rose-500/15 border border-rose-400/35 px-3 py-2 text-xs text-rose-200">
              {voiceError}
            </div>
          )}

          {isRecording ? (
            <div className="flex items-center gap-2 rounded-2xl bg-rose-500/15 border border-rose-400/45 px-3 py-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-extrabold text-white">Запись вопроса…</div>
                <div className="text-[11px] text-rose-200 tabular-nums">
                  {formatDuration(recordSec)} — говорите в микрофон
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleStopVoiceQuestion(true)}
                aria-label="Отменить запись"
                className="p-2 rounded-xl bg-white/10 hover:bg-white/15 text-slate-200 cursor-pointer transition"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => handleStopVoiceQuestion(false)}
                className="px-3 py-2 rounded-xl font-extrabold text-xs text-white flex items-center gap-1.5 cursor-pointer transition active:scale-95"
                style={{
                  background: 'linear-gradient(135deg, #F06253, #C63B2F)',
                  boxShadow: '0 4px 14px rgba(240,98,83,.4)',
                }}
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Отправить</span>
              </button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                askQuestion(input);
              }}
              className="flex gap-1.5 items-center"
            >
              {uiSettings.aiVoiceEnabled && (
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={handleStartVoiceQuestion}
                  title="Задать финансовый вопрос голосом"
                  aria-label="Записать голосовой вопрос"
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white cursor-pointer transition active:scale-95 disabled:opacity-50"
                  style={{
                    background: 'linear-gradient(135deg, #8B7AF0, #5A47CA)',
                    boxShadow: '0 4px 14px rgba(107,90,214,.35)',
                  }}
                >
                  <Mic className="w-4 h-4" />
                </button>
              )}
              <input
                className="fin-input flex-1"
                disabled={isBusy}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  uiSettings.aiVoiceEnabled
                    ? 'Напишите или нажмите 🎙️ для вопроса...'
                    : 'Вопрос: вычет 13%, вклад, ОФЗ...'
                }
              />
              <button
                type="submit"
                disabled={isBusy || !input.trim()}
                aria-label="Отправить вопрос"
                className="fin-btn sm h-10 px-3 flex items-center justify-center disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
              </button>
            </form>
          )}
        </GlassSection>
      )}

      {/* ТРЕКЕР ПРИВЫЧЕК И ЗАБОТА АССИСТЕНТА */}
      <GlassSection
        id="sec-habits"
        title="🌱 Привычки и забота ассистента"
        helpText="Отмечайте полезные ежедневные привычки в 1 нажатие и следите за серией дней (🔥). Ассистент поддерживает ваш прогресс, а новые привычки можно добавлять как кнопкой «+», так и голосом или прямо в чате Советника."
        rightExtra={
          <button
            type="button"
            onClick={() => setShowAddHabit((v) => !v)}
            className="fin-btn ghost sm"
            style={{ padding: '3px 8px', fontSize: '.7rem' }}
          >
            <Plus className="w-3 h-3" />
            <span>Привычка</span>
          </button>
        }
        collapsed={collapsedSecs.includes('sec-habits')}
        onToggleCollapse={onToggleSec}
      >
        {/* Живое сообщение поддержки от ассистента */}
        <div className="rounded-2xl bg-gradient-to-br from-[#7A68E6]/18 to-[#19A886]/15 border border-[#9B8AFB]/35 p-2.5 text-xs text-slate-100 leading-relaxed">
          {habitStats.careMessage}
        </div>

        {showAddHabit && (
          <form onSubmit={handleAddHabit} className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-2.5 space-y-2">
            <div className="flex items-center gap-1 flex-wrap">
              {HABIT_ICONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  onClick={() => setNewHabitIcon(ic)}
                  className={`w-7 h-7 rounded-lg text-sm flex items-center justify-center cursor-pointer transition ${
                    newHabitIcon === ic
                      ? 'bg-[var(--acc)] scale-105'
                      : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {ic}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              <input
                className="fin-input flex-1"
                value={newHabitTitle}
                onChange={(e) => setNewHabitTitle(e.target.value)}
                placeholder="Например: Прогулка 30 минут"
                autoFocus
              />
              <button type="submit" className="fin-btn sm">
                Добавить
              </button>
            </div>
          </form>
        )}

        <div className="space-y-1.5">
          {habits.length === 0 ? (
            <div className="fin-sub text-center py-2">
              Привычек пока нет. Нажмите «+ Привычка» или скажите голосом «Добавь привычку зарядка».
            </div>
          ) : (
            habits.map((h) => {
              const doneToday = h.completedDates.includes(todayIso);
              const streak = calcHabitStreak(h.completedDates, todayIso);
              return (
                <div
                  key={h.id}
                  className="tx-tile"
                  style={{
                    borderColor: doneToday ? 'rgba(25, 168, 134, 0.45)' : undefined,
                    background: doneToday ? 'rgba(25, 168, 134, 0.12)' : undefined,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => handleToggleHabitToday(h.id)}
                    className="w-7 h-7 rounded-xl border flex items-center justify-center shrink-0 cursor-pointer transition active:scale-95"
                    style={{
                      background: doneToday ? 'var(--acc)' : 'transparent',
                      borderColor: doneToday ? 'var(--acc)' : 'rgba(255,255,255,.3)',
                    }}
                    aria-label={doneToday ? 'Снять отметку' : 'Отметить выполненным'}
                  >
                    {doneToday ? (
                      <Check className="w-4 h-4 text-white stroke-[3]" />
                    ) : (
                      <span className="text-sm">{h.icon}</span>
                    )}
                  </button>

                  <div
                    onClick={() => handleToggleHabitToday(h.id)}
                    className="flex-1 min-w-0 cursor-pointer"
                  >
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-bold truncate ${
                          doneToday ? 'text-emerald-200' : 'text-white'
                        }`}
                      >
                        {doneToday ? `${h.icon} ` : ''}
                        {h.title}
                      </span>
                      {streak > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-[10px] font-extrabold text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded-full shrink-0 tabular-nums">
                          <Flame className="w-2.5 h-2.5" />
                          {streak} дн.
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 mt-1">
                      {last7Days.map((dIso) => {
                        const hit = h.completedDates.includes(dIso);
                        const isTd = dIso === todayIso;
                        return (
                          <span
                            key={dIso}
                            title={dIso}
                            className="w-3.5 h-1.5 rounded-full transition-colors"
                            style={{
                              background: hit
                                ? '#34D399'
                                : isTd
                                ? 'rgba(255,255,255,.28)'
                                : 'rgba(255,255,255,.1)',
                            }}
                          />
                        );
                      })}
                      <span className="text-[9px] text-[var(--mute)] ml-1">7 дн.</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleDeleteHabit(h.id)}
                    className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer shrink-0"
                    title="Удалить привычку"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {uiSettings.aiEnabled && (
          <button
            type="button"
            disabled={isBusy}
            onClick={handleDiscussHabitsWithAi}
            className="fin-btn ghost w-full sm flex items-center justify-center gap-1.5"
          >
            <MessageCircle className="w-3.5 h-3.5 text-[#9B8AFB]" />
            <span>Обсудить прогресс с Советником</span>
          </button>
        )}
      </GlassSection>

      <GlassSection
        id="sec-tips"
        title="💡 Финансовый разбор и резервы"
        helpText="Автоматический офлайн-анализ ваших трат: показывает, на какой гибкой категории проще всего сэкономить, сколько можно вернуть налоговым вычетом 13% НДФЛ и предупреждает о кассовом разрыве."
        collapsed={collapsedSecs.includes('sec-tips')}
        onToggleCollapse={onToggleSec}
      >
        {H.sumOut > 0 ? (
          <div className="space-y-2">
            {H.topFlexCat ? (
              <div className="tip-card">
                ✂️ <b>Где реально сэкономить:</b> Обязательные платежи ({formatMoney(H.fixedSum)}) не
                трогаем. Среди гибких покупок лидирует «<b>{H.topFlexCat}</b>» (
                {formatMoney(H.flexByCat[H.topFlexCat])}). −15% вернут{' '}
                <b>+{formatMoney(H.flexByCat[H.topFlexCat] * 0.15)}</b>.
              </div>
            ) : (
              <div className="tip-card">
                🔒 Все текущие траты ({formatMoney(H.fixedSum)}) — обязательные.
              </div>
            )}
            {(H.socialRefund > 0 || H.taxMort > 0) && (
              <div className="tip-card invest">
                💸 <b>Возврат 13% НДФЛ:</b>{' '}
                {H.socialRefund > 0 && `Можно вернуть +${formatMoney(H.socialRefund)}. `}
                {H.taxMort > 0 && 'По ипотеке доступен вычет до 260 000 ₽ + до 390 000 ₽ по процентам.'}
              </div>
            )}
            {H.left < 0 && H.sumIn > 0 && (
              <div className="tip-card alert">
                🛟 <b>Кассовый разрыв:</b> перерасход {formatMoney(-H.left)}.
              </div>
            )}
          </div>
        ) : (
          <div className="tip-card">
            💡 Внесите доходы и расходы для расчёта безопасного дневного лимита и вычета 13%.
          </div>
        )}
      </GlassSection>
    </>
  );
}
