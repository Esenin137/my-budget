import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Check,
  Clock,
  Copy,
  Eraser,
  FileText,
  ListChecks,
  Loader2,
  Mic,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import {
  AppState,
  CalendarTask,
  NoteTab,
  NoteTabType,
  TaskRepeatFreq,
  Transaction,
  VoiceNoteItem,
} from '../types';
import { isoDate, getAudioBlob, saveAudioBlob } from '../utils/storage';
import {
  catOf,
  DuplicateExpenseWarning,
  findDuplicateExpenseWarning,
  fmtHumanDate,
  fmtMonthName,
  formatMoney,
  getRemindBeforeLabel,
  getRepeatLabel,
  getTasksForDate,
  isTaskDoneOnDate,
  parseNum,
  uid,
} from '../utils/finance';
import { blobToBase64, formatDuration, playReminderChime } from '../utils/sound';
import {
  getNotificationPermissionState,
  requestNotificationPermissions,
} from '../utils/notifications';
import GlassSection from './GlassSection';
import { ModalShell } from './Modals';

interface PendingExpensePrompt {
  source: 'shopping' | 'task';
  name: string;
  amount: string;
  category: string;
  method: string;
  dateIso: string;
  warning: DuplicateExpenseWarning | null;
}

const FINANCIAL_TASK_RE =
  /оплат|заплат|кредит|ипотек|жкх|подписк|интернет|связ|налог|садик|школ|страхов|аренд|купить|покупк/i;

function getTabIcon(tabType?: NoteTabType): string {
  if (tabType === 'shopping') return '🛒';
  if (tabType === 'daily-tasks') return '✅';
  return '📝';
}

interface PlannerTabProps {
  state: AppState;
  tasks: CalendarTask[];
  noteTabs: NoteTab[];
  activeNoteTabId: string;
  focusDateIso?: string | null;
  collapsedSecs: string[];
  onToggleSec: (id: string) => void;
  onUpdateTasks: (next: CalendarTask[]) => void;
  onUpdateNotes: (tabs: NoteTab[], activeTabId: string) => void;
  onAddExpenseFromPlanner: (tx: Transaction) => void;
  onShowToast: (message: string, undoAction?: () => void) => void;
  onTestReminder: (sampleTitle: string) => void;
}

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function buildMonthGrid(year: number, month: number) {
  const first = new Date(year, month, 1);
  const startOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);
  const cells: { iso: string; day: number; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
    cells.push({
      iso: isoDate(d),
      day: d.getDate(),
      inMonth: d.getMonth() === month,
    });
  }
  return cells;
}

interface VoiceNoteRowProps {
  item: VoiceNoteItem;
  onDelete: (id: number) => void;
  onTranscribe: (item: VoiceNoteItem) => Promise<void>;
  onToggleTranscript: (id: number) => void;
  onSplitToChecklist: (text: string) => void;
  isTranscribing: boolean;
  transcribeError: string | null;
}

function VoiceNoteRow({
  item,
  onDelete,
  onTranscribe,
  onToggleTranscript,
  onSplitToChecklist,
  isTranscribing,
  transcribeError,
}: VoiceNoteRowProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioErr, setAudioErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };
  }, []);

  const ensureAudio = async (): Promise<HTMLAudioElement | null> => {
    if (audioRef.current) return audioRef.current;
    if (!item.audioId) return null;
    const blob = await getAudioBlob(item.audioId);
    if (!blob) {
      setAudioErr('Аудиозапись не найдена.');
      return null;
    }
    const url = URL.createObjectURL(blob);
    urlRef.current = url;
    const audio = new Audio(url);
    audio.ontimeupdate = () => {
      const dur = audio.duration && isFinite(audio.duration) ? audio.duration : item.durationSec || 1;
      setCurrentTime(audio.currentTime);
      setProgress(Math.min(1, audio.currentTime / Math.max(dur, 0.1)));
    };
    audio.onended = () => {
      setIsPlaying(false);
      setProgress(0);
      setCurrentTime(0);
    };
    audio.onpause = () => setIsPlaying(false);
    audio.onplay = () => setIsPlaying(true);
    audioRef.current = audio;
    return audio;
  };

  const handlePlayToggle = async () => {
    setAudioErr(null);
    const audio = await ensureAudio();
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
    } else {
      try {
        await audio.play();
      } catch {
        setAudioErr('Не удалось воспроизвести аудио.');
      }
    }
  };

  const handleSeek = async (ratio: number) => {
    const audio = await ensureAudio();
    if (!audio) return;
    const dur = audio.duration && isFinite(audio.duration) ? audio.duration : item.durationSec || 1;
    audio.currentTime = Math.max(0, Math.min(dur, dur * ratio));
    setProgress(ratio);
  };

  const peaks =
    item.peaks && item.peaks.length > 0
      ? item.peaks
      : [28, 55, 72, 42, 85, 62, 38, 90, 56, 44, 72, 60, 34, 80, 50, 32, 68, 46];
  const timeLabel = new Date(item.createdAt).toLocaleTimeString('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const hasTranscript = Boolean(item.transcript);

  return (
    <div className="rounded-2xl bg-[var(--fld)] border border-white/12 p-2.5 shadow-md space-y-2">
      {/* Messenger row: Play + Waveform + Side button "Расшифровать текст" */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePlayToggle}
          aria-label={isPlaying ? 'Пауза' : 'Прослушать'}
          className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-white cursor-pointer transition active:scale-95"
          style={{ background: 'linear-gradient(135deg, var(--acc), var(--h1))' }}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        <div className="flex-1 min-w-0">
          <div
            className="flex items-center gap-[2px] h-7 cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              handleSeek(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)));
            }}
          >
            {peaks.map((pk, idx) => {
              const active = (idx + 1) / peaks.length <= progress;
              return (
                <span
                  key={idx}
                  className="flex-1 rounded-full transition-colors"
                  style={{
                    height: `${Math.max(18, Math.min(100, pk))}%`,
                    background: active ? 'var(--acc)' : 'rgba(255,255,255,.22)',
                  }}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[11px] text-[var(--mute)] tabular-nums mt-0.5">
            <span>{isPlaying ? formatDuration(currentTime) : formatDuration(item.durationSec || 0)}</span>
            <span>{timeLabel}</span>
          </div>
        </div>

        {/* Side button "Расшифровать текст" (like Telegram/messengers) */}
        <button
          type="button"
          disabled={isTranscribing}
          onClick={() => {
            if (hasTranscript) onToggleTranscript(item.id);
            else onTranscribe(item);
          }}
          title="Расшифровать голосовую заметку в текст"
          className="px-2.5 py-2 rounded-xl border text-[11px] font-bold flex items-center gap-1 shrink-0 cursor-pointer transition"
          style={{
            background:
              hasTranscript && item.transcriptVisible
                ? 'rgba(30, 180, 201, 0.22)'
                : 'rgba(255, 255, 255, 0.07)',
            borderColor:
              hasTranscript && item.transcriptVisible
                ? 'rgba(30, 180, 201, 0.5)'
                : 'rgba(255, 255, 255, 0.16)',
            color: '#EEF8F6',
          }}
        >
          {isTranscribing ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--acc)]" />
          ) : (
            <FileText className="w-3.5 h-3.5 text-[var(--acc)]" />
          )}
          <span className="whitespace-nowrap">
            {isTranscribing
              ? '...'
              : hasTranscript
              ? item.transcriptVisible
                ? 'Скрыть'
                : 'Текст'
              : 'Расшифровать'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onDelete(item.id)}
          className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer shrink-0"
          aria-label="Удалить"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {audioErr && <div className="text-xs text-rose-400">{audioErr}</div>}
      {transcribeError && <div className="text-xs text-rose-400">{transcribeError}</div>}

      {/* Recognized text right below the voice message */}
      {hasTranscript && item.transcriptVisible && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="text-sm text-white leading-relaxed whitespace-pre-wrap">
            {item.transcript}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--mute)]">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(item.transcript || '').catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
              className="inline-flex items-center gap-1 hover:text-white cursor-pointer"
            >
              <Copy className="w-3 h-3" />
              <span>{copied ? 'Скопировано' : 'Копировать'}</span>
            </button>
            <span>·</span>
            <button
              type="button"
              onClick={() => onSplitToChecklist(item.transcript || '')}
              className="inline-flex items-center gap-1 text-[var(--acc)] hover:underline cursor-pointer font-semibold"
            >
              <ListChecks className="w-3.5 h-3.5" />
              <span>Разбить в список покупок</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function PlannerTab({
  state,
  tasks,
  noteTabs,
  activeNoteTabId,
  focusDateIso,
  collapsedSecs,
  onToggleSec,
  onUpdateTasks,
  onUpdateNotes,
  onAddExpenseFromPlanner,
  onShowToast,
  onTestReminder,
}: PlannerTabProps) {
  const todayIso = isoDate(new Date());
  const [selectedDay, setSelectedDay] = useState<string>(todayIso);
  const [calMonth, setCalMonth] = useState<Date>(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  );

  useEffect(() => {
    if (focusDateIso && /^\d{4}-\d{2}-\d{2}$/.test(focusDateIso)) {
      setSelectedDay(focusDateIso);
      const [y, m] = focusDateIso.split('-').map(Number);
      setCalMonth(new Date(y, m - 1, 1));
    }
  }, [focusDateIso]);

  const [taskTitle, setTaskTitle] = useState('');
  const [taskTime, setTaskTime] = useState('');
  const [taskAmount, setTaskAmount] = useState('');
  const [taskRepeat, setTaskRepeat] = useState<TaskRepeatFreq>('none');
  const [taskRemindBefore, setTaskRemindBefore] = useState<number>(0);
  const [taskNotify, setTaskNotify] = useState(true);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState('');
  const [editingTaskTime, setEditingTaskTime] = useState('');
  const [dailyQuickTask, setDailyQuickTask] = useState('');

  // Purchase / Financial Task -> Expense prompt modal
  const [expensePrompt, setExpensePrompt] = useState<PendingExpensePrompt | null>(null);
  const [expensePromptErr, setExpensePromptErr] = useState<string | null>(null);

  const [notifPerm, setNotifPerm] = useState<'granted' | 'denied' | 'default' | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  );

  useEffect(() => {
    getNotificationPermissionState()
      .then((res) => setNotifPerm(res === 'prompt' ? 'default' : res))
      .catch(() => {});
  }, []);

  // Notes multi-tab state
  const [addingTab, setAddingTab] = useState(false);
  const [newTabTitle, setNewTabTitle] = useState('');
  const [newTabType, setNewTabType] = useState<NoteTabType>('shopping');
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renameTabValue, setRenameTabValue] = useState('');
  const [textNoteInput, setTextNoteInput] = useState('');

  // Audio recording state
  const [isRecording, setIsRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [liveLevels, setLiveLevels] = useState<number[]>(Array(16).fill(18));
  const [recError, setRecError] = useState<string | null>(null);
  const [transcribingIds, setTranscribingIds] = useState<Record<number, boolean>>({});
  const [transcribeErrors, setTranscribeErrors] = useState<Record<number, string>>({});

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const peaksCollectorRef = useRef<number[]>([]);
  const recordStartRef = useRef<number>(0);

  useEffect(() => () => cleanupRecording(), []);

  const cleanupRecording = () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = null;
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioCtxRef.current) audioCtxRef.current.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  };

  const monthCells = useMemo(
    () => buildMonthGrid(calMonth.getFullYear(), calMonth.getMonth()),
    [calMonth]
  );

  const tasksByDate = useMemo(() => {
    const map: Record<string, { open: number; done: number; hasAlert: boolean }> = {};
    monthCells.forEach((cell) => {
      const list = getTasksForDate(tasks, cell.iso);
      if (list.length === 0) return;
      let open = 0;
      let done = 0;
      let hasAlert = false;
      list.forEach((t) => {
        const isDone = isTaskDoneOnDate(t, cell.iso);
        if (isDone) done += 1;
        else {
          open += 1;
          if (t.notify && t.time) hasAlert = true;
        }
      });
      map[cell.iso] = { open, done, hasAlert };
    });
    return map;
  }, [tasks, monthCells]);

  const dayTasks = useMemo(() => getTasksForDate(tasks, selectedDay), [tasks, selectedDay]);

  const activeTab = useMemo(
    () => noteTabs.find((t) => t.id === activeNoteTabId) || noteTabs[0],
    [noteTabs, activeNoteTabId]
  );

  const updateActiveTabItems = (updater: (items: VoiceNoteItem[]) => VoiceNoteItem[]) => {
    if (!activeTab) return;
    onUpdateNotes(
      noteTabs.map((tab) => (tab.id === activeTab.id ? { ...tab, items: updater(tab.items) } : tab)),
      activeTab.id
    );
  };

  const handleRequestNotifications = async () => {
    const preset = state.uiSettings?.soundPreset || 'soft';
    try {
      const perm = await requestNotificationPermissions(preset);
      setNotifPerm(perm === 'prompt' ? 'default' : perm);
      if (perm === 'granted') {
        if (state.uiSettings?.soundAlertsEnabled !== false) {
          playReminderChime(preset);
        }
        onShowToast('🔔 Оповещения включены!');
      } else if (perm === 'unsupported') {
        onShowToast('Включены звуковые оповещения внутри приложения.');
      } else {
        onShowToast('Оповещения будут приходить баннером со звуком внутри приложения.');
      }
    } catch {
      onShowToast('Используются встроенные оповещения со звуком.');
    }
  };

  const handleAddTask = (e: React.FormEvent) => {
    e.preventDefault();
    const title = taskTitle.trim();
    if (!title) return;
    const amt = parseNum(taskAmount);
    const hasNotify = Boolean((taskTime || taskRemindBefore > 0) && taskNotify);
    onUpdateTasks([
      ...tasks,
      {
        id: uid(),
        date: selectedDay,
        time: taskTime || (hasNotify ? '09:00' : undefined),
        title,
        done: false,
        notify: hasNotify,
        notifiedAt: null,
        snoozedUntil: null,
        repeat: taskRepeat,
        remindBeforeMin: taskRemindBefore,
        amount: amt > 0 ? amt : undefined,
        completedDates: [],
        createdAt: Date.now(),
      },
    ]);
    setTaskTitle('');
    setTaskTime('');
    setTaskAmount('');
    setTaskRepeat('none');
    setTaskRemindBefore(0);
  };

  const toggleTaskCompletion = (task: CalendarTask, dateIso: string) => {
    const currentlyDone = isTaskDoneOnDate(task, dateIso);
    const rep = task.repeat || 'none';

    const nextTasks = tasks.map((t) => {
      if (t.id !== task.id) return t;
      if (rep !== 'none') {
        const prevDates = Array.isArray(t.completedDates) ? t.completedDates : [];
        const nextDates = currentlyDone
          ? prevDates.filter((d) => d !== dateIso)
          : Array.from(new Set([...prevDates, dateIso]));
        return { ...t, completedDates: nextDates };
      }
      return { ...t, done: !currentlyDone };
    });
    onUpdateTasks(nextTasks);

    // If marking as DONE and task looks financial (has planned amount or payment keywords), prompt with duplicate check
    if (!currentlyDone && ((task.amount && task.amount > 0) || FINANCIAL_TASK_RE.test(task.title))) {
      const warning = findDuplicateExpenseWarning(task.title, task.amount, dateIso, state);
      setExpensePromptErr(null);
      setExpensePrompt({
        source: 'task',
        name: task.title,
        amount: task.amount && task.amount > 0 ? String(task.amount) : '',
        category: catOf(task.title, state.cats) || 'Другое',
        method: 'Карта',
        dateIso,
        warning,
      });
    }
  };

  const toggleNoteItemCheck = (item: VoiceNoteItem) => {
    const nextChecked = !item.checked;
    updateActiveTabItems((items) =>
      items.map((it) => (it.id === item.id ? { ...it, checked: nextChecked } : it))
    );

    if (nextChecked && activeTab?.tabType === 'shopping' && item.text) {
      const warning = findDuplicateExpenseWarning(item.text, undefined, todayIso, state);
      setExpensePromptErr(null);
      setExpensePrompt({
        source: 'shopping',
        name: item.text,
        amount: '',
        category: catOf(item.text, state.cats) || 'Другое',
        method: 'Карта',
        dateIso: todayIso,
        warning,
      });
    }
  };

  const handleConfirmAddExpense = (e: React.FormEvent) => {
    e.preventDefault();
    if (!expensePrompt) return;
    const val = parseNum(expensePrompt.amount);
    if (val <= 0) {
      setExpensePromptErr('Укажите стоимость больше 0 ₽ или нажмите «Просто отметить».');
      return;
    }
    onAddExpenseFromPlanner({
      id: uid(),
      t: 'out',
      a: val,
      c: expensePrompt.category,
      m: expensePrompt.method,
      d: expensePrompt.dateIso,
      n: expensePrompt.name.trim() || expensePrompt.category,
    });
    setExpensePrompt(null);
    setExpensePromptErr(null);
  };

  const startVoiceRecording = async () => {
    setRecError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setRecError('Микрофон недоступен в этом браузере.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const mimeType =
        ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) =>
          MediaRecorder.isTypeSupported(t)
        ) || '';
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      chunksRef.current = [];
      peaksCollectorRef.current = [];
      recordStartRef.current = Date.now();
      setRecordSec(0);

      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 64;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;

        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          if (!analyserRef.current) return;
          analyserRef.current.getByteFrequencyData(dataArr);
          const avg = dataArr.reduce((acc, v) => acc + v, 0) / Math.max(1, dataArr.length);
          const norm = Math.max(16, Math.min(100, Math.round((avg / 140) * 100)));
          peaksCollectorRef.current.push(norm);
          setLiveLevels((prev) => [...prev.slice(1), norm]);
          animFrameRef.current = requestAnimationFrame(tick);
        };
        animFrameRef.current = requestAnimationFrame(tick);
      } catch {
        // Optional visualizer
      }

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };

      recorder.onstop = async () => {
        const elapsedSec = Math.max(1, Math.round((Date.now() - recordStartRef.current) / 1000));
        const finalMime = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type: finalMime });
        const rawPeaks = peaksCollectorRef.current;

        cleanupRecording();
        setIsRecording(false);
        setRecordSec(0);

        if (blob.size < 200) return;

        const barCount = 20;
        const peaks: number[] = [];
        if (rawPeaks.length > 0) {
          const step = rawPeaks.length / barCount;
          for (let i = 0; i < barCount; i++) {
            peaks.push(rawPeaks[Math.min(rawPeaks.length - 1, Math.floor(i * step))]);
          }
        }

        const audioId = `aud-${uid()}`;
        await saveAudioBlob(audioId, blob).catch(() => {});

        updateActiveTabItems((items) => [
          {
            id: uid(),
            kind: 'voice',
            createdAt: Date.now(),
            audioId,
            mimeType: finalMime,
            durationSec: elapsedSec,
            peaks,
            transcript: null,
            transcriptVisible: false,
          },
          ...items,
        ]);
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordSec(Math.floor((Date.now() - recordStartRef.current) / 1000));
      }, 250);
    } catch {
      cleanupRecording();
      setIsRecording(false);
      setRecError('Разрешите доступ к микрофону для записи голосовой заметки.');
    }
  };

  const stopVoiceRecording = () => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    } else {
      cleanupRecording();
      setIsRecording(false);
    }
  };

  const cancelVoiceRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.onstop = null;
      if (recorderRef.current.state !== 'inactive') recorderRef.current.stop();
    }
    chunksRef.current = [];
    cleanupRecording();
    setIsRecording(false);
    setRecordSec(0);
  };

  const handleTranscribeVoiceNote = async (item: VoiceNoteItem) => {
    if (!item.audioId) return;
    setTranscribingIds((prev) => ({ ...prev, [item.id]: true }));
    setTranscribeErrors((prev) => {
      const next = { ...prev };
      delete next[item.id];
      return next;
    });
    try {
      const blob = await getAudioBlob(item.audioId);
      if (!blob) throw new Error('Аудиофайл не найден.');
      const audioBase64 = await blobToBase64(blob);
      const res = await fetch('/api/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType: item.mimeType || blob.type || 'audio/webm' }),
      });
      const rawText = await res.text();
      let data: { text?: string; error?: string } = {};
      try {
        data = JSON.parse(rawText) as { text?: string; error?: string };
      } catch {
        throw new Error(
          'Расшифровка голосовых заметок требует серверную часть приложения (на статическом GitHub Pages аудио сохраняется и воспроизводится, но серверная расшифровка недоступна).'
        );
      }
      if (!res.ok || !data.text) throw new Error(data.error || 'Не удалось расшифровать запись.');
      updateActiveTabItems((items) =>
        items.map((it) =>
          it.id === item.id ? { ...it, transcript: data.text || '', transcriptVisible: true } : it
        )
      );
    } catch (err) {
      setTranscribeErrors((prev) => ({
        ...prev,
        [item.id]: err instanceof Error ? err.message : 'Ошибка расшифровки.',
      }));
    } finally {
      setTranscribingIds((prev) => ({ ...prev, [item.id]: false }));
    }
  };

  const handleClearActiveTab = () => {
    if (!activeTab || activeTab.items.length === 0) return;
    const prevTabs = noteTabs;
    const title = activeTab.title;
    updateActiveTabItems(() => []);
    onShowToast(`🧹 Вкладка «${title}» очищена!`, () => onUpdateNotes(prevTabs, activeTab.id));
  };

  const handleSplitTranscriptToChecklist = (text: string) => {
    const parts = text
      .split(/[\n,;•]+/)
      .map((s) => s.replace(/^[-—*\d.)\s]+/, '').trim())
      .filter((s) => s.length >= 2);
    if (!parts.length) return;
    const now = Date.now();
    const newItems: VoiceNoteItem[] = parts.map((p, idx) => ({
      id: uid() + idx,
      kind: 'text',
      createdAt: now - idx,
      text: p.charAt(0).toUpperCase() + p.slice(1),
      checked: false,
    }));
    updateActiveTabItems((items) => [...newItems, ...items]);
    onShowToast(`Добавлено пунктов: ${newItems.length}`);
  };

  return (
    <>

      {/* ОКНО 1: КАЛЕНДАРЬ СОБЫТИЙ И ЗАДАЧИ НА ВЫБРАННЫЙ ДЕНЬ */}
      <GlassSection
        id="sec-planner-cal"
        title="📅 Календарь и ежедневник"
        helpText="Выбирайте день в календаре и записывайте задачи, регулярные оплаты или напоминания. Можно задать повтор (ежемесячно, еженедельно), время заранее (например, за 1 день) и сумму — при выполнении проверим, нет ли дубля с постоянными расходами."
        rightExtra={
          <button
            type="button"
            onClick={handleRequestNotifications}
            className="fin-btn ghost sm"
            style={{ padding: '3px 7px', fontSize: '.7rem' }}
            title="Включить уведомления о задачах"
          >
            {notifPerm === 'granted' ? '🔔 Вкл' : '🔕 Оповещ.'}
          </button>
        }
        collapsed={collapsedSecs.includes('sec-planner-cal')}
        onToggleCollapse={onToggleSec}
      >
        {/* Календарь месяца */}
        <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-2.5">
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}
              className="fin-btn ghost sm"
              style={{ padding: '3px 9px' }}
            >
              ◀
            </button>
            <b className="text-xs text-white">{fmtMonthName(calMonth)}</b>
            <button
              type="button"
              onClick={() => setCalMonth((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}
              className="fin-btn ghost sm"
              style={{ padding: '3px 9px' }}
            >
              ▶
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-[var(--mute)] mb-1">
            {WEEKDAYS.map((wd) => (
              <div key={wd}>{wd}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {monthCells.map((cell) => {
              const stat = tasksByDate[cell.iso];
              const isSelected = cell.iso === selectedDay;
              const isToday = cell.iso === todayIso;
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => {
                    setSelectedDay(cell.iso);
                    if (!cell.inMonth) {
                      const [y, m] = cell.iso.split('-').map(Number);
                      setCalMonth(new Date(y, m - 1, 1));
                    }
                  }}
                  className="h-9 rounded-xl flex flex-col items-center justify-center text-xs font-bold tabular-nums cursor-pointer transition"
                  style={{
                    background: isSelected
                      ? 'linear-gradient(135deg, var(--acc), var(--h1))'
                      : isToday
                      ? 'rgba(30, 180, 201, 0.2)'
                      : 'transparent',
                    color: isSelected
                      ? '#fff'
                      : cell.inMonth
                      ? '#EEF8F6'
                      : 'rgba(132, 165, 158, 0.4)',
                    border: isToday && !isSelected ? '1px solid rgba(30,180,201,.55)' : '1px solid transparent',
                  }}
                >
                  <span>{cell.day}</span>
                  {stat && (stat.open > 0 || stat.done > 0) && (
                    <span
                      className="w-1.5 h-1.5 rounded-full mt-0.5"
                      style={{
                        background: isSelected
                          ? '#fff'
                          : stat.open > 0
                          ? stat.hasAlert
                            ? '#F2B238'
                            : '#34D399'
                          : '#64748B',
                      }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Заголовок выбранного дня + тест сигнала */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="text-xs font-extrabold text-white truncate">
            {selectedDay === todayIso ? `Сегодня · ${fmtHumanDate(selectedDay)}` : fmtHumanDate(selectedDay)}
          </div>
          <button
            type="button"
            onClick={() => onTestReminder('Проверка оповещения ежедневника')}
            className="text-[11px] font-bold text-[var(--acc)] hover:underline cursor-pointer shrink-0"
          >
            🔔 Тест сигнала
          </button>
        </div>

        {/* Добавление задачи на день (с повтором, ранним напоминанием и опциональной суммой) */}
        <form onSubmit={handleAddTask} className="space-y-1.5">
          <input
            className="fin-input w-full"
            value={taskTitle}
            onChange={(e) => setTaskTitle(e.target.value)}
            placeholder="Записать задачу, встречу или оплату..."
          />
          <div className="grid grid-cols-2 gap-1.5">
            <input
              type="time"
              className="fin-input tabular-nums"
              value={taskTime}
              onChange={(e) => setTaskTime(e.target.value)}
              title="Время напоминания"
            />
            <input
              type="text"
              inputMode="decimal"
              className="fin-input tabular-nums"
              value={taskAmount}
              onChange={(e) => setTaskAmount(e.target.value)}
              placeholder="Сумма ₽ (необяз.)"
              title="Если задача связана с оплатой, укажите сумму"
            />
          </div>
          <div className="flex gap-1.5 items-center flex-wrap">
            <select
              className="fin-input flex-1 min-w-[105px]"
              style={{ padding: '6px 8px', fontSize: '.76rem' }}
              value={taskRepeat}
              onChange={(e) => setTaskRepeat(e.target.value as TaskRepeatFreq)}
              title="Повтор задачи (удобно для подписок и регулярных дел)"
            >
              <option value="none">Без повтора</option>
              <option value="daily">🔁 Ежедневно</option>
              <option value="weekly">🔁 Еженедельно</option>
              <option value="monthly">🔁 Ежемесячно</option>
              <option value="yearly">🔁 Ежегодно</option>
            </select>
            <select
              className="fin-input flex-1 min-w-[105px]"
              style={{ padding: '6px 8px', fontSize: '.76rem' }}
              value={taskRemindBefore}
              onChange={(e) => setTaskRemindBefore(Number(e.target.value))}
              title="За сколько напомнить заранее"
            >
              <option value={0}>🔔 В момент</option>
              <option value={15}>🔔 За 15 мин</option>
              <option value={60}>🔔 За 1 час</option>
              <option value={1440}>🔔 За 1 день</option>
              <option value={2880}>🔔 За 2 дня</option>
            </select>
            <button
              type="button"
              onClick={() => setTaskNotify((v) => !v)}
              className={`fin-btn sm ${taskNotify ? '' : 'ghost'}`}
              title={taskNotify ? 'Оповещение включено' : 'Без оповещения'}
            >
              {taskNotify ? <Bell className="w-3.5 h-3.5" /> : <BellOff className="w-3.5 h-3.5" />}
            </button>
            <button type="submit" className="fin-btn sm">
              + Задача
            </button>
          </div>
        </form>

        {/* Список задач на выбранный день с зачёркиванием */}
        <div className="space-y-1.5 max-h-60 overflow-y-auto pr-0.5">
          {dayTasks.length === 0 ? (
            <div className="fin-sub py-2 text-center">
              На этот день задач нет. Выберите день выше и запишите дела!
            </div>
          ) : (
            dayTasks.map((task) => {
              const isEd = editingTaskId === task.id;
              const doneToday = isTaskDoneOnDate(task, selectedDay);
              const repLabel = getRepeatLabel(task.repeat);
              return (
                <div
                  key={task.id}
                  className="tx-tile"
                  style={{ opacity: doneToday ? 0.62 : 1 }}
                >
                  <button
                    type="button"
                    onClick={() => toggleTaskCompletion(task, selectedDay)}
                    className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer"
                    style={{
                      background: doneToday ? 'var(--acc)' : 'transparent',
                      borderColor: doneToday ? 'var(--acc)' : 'rgba(255,255,255,.3)',
                    }}
                  >
                    {doneToday && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </button>

                  {isEd ? (
                    <div className="flex-1 flex gap-1 items-center min-w-0">
                      <input
                        className="fin-input flex-1"
                        style={{ padding: '4px 7px', fontSize: '.8rem' }}
                        value={editingTaskTitle}
                        onChange={(e) => setEditingTaskTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            onUpdateTasks(
                              tasks.map((t) =>
                                t.id === task.id
                                  ? {
                                      ...t,
                                      title: editingTaskTitle.trim() || t.title,
                                      time: editingTaskTime || undefined,
                                      notify: Boolean(editingTaskTime),
                                      notifiedAt: null,
                                    }
                                  : t
                              )
                            );
                            setEditingTaskId(null);
                          }
                        }}
                        autoFocus
                      />
                      <input
                        type="time"
                        className="fin-input w-20"
                        style={{ padding: '4px 5px', fontSize: '.75rem' }}
                        value={editingTaskTime}
                        onChange={(e) => setEditingTaskTime(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          onUpdateTasks(
                            tasks.map((t) =>
                              t.id === task.id
                                ? {
                                    ...t,
                                    title: editingTaskTitle.trim() || t.title,
                                    time: editingTaskTime || undefined,
                                    notify: Boolean(editingTaskTime),
                                    notifiedAt: null,
                                  }
                                : t
                            )
                          );
                          setEditingTaskId(null);
                        }}
                        className="fin-btn sm"
                        style={{ padding: '4px 8px' }}
                      >
                        Ок
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        className="flex-1 min-w-0 cursor-pointer"
                        onClick={() => toggleTaskCompletion(task, selectedDay)}
                      >
                        <div className={`text-sm font-semibold break-words ${doneToday ? 'line-through text-[var(--mute)]' : ''}`}>
                          {task.title}
                        </div>
                        <div className="fin-sub flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                          {task.time && (
                            <span className="inline-flex items-center gap-0.5">
                              <Clock className="w-3 h-3 text-amber-400" />
                              {task.time}
                            </span>
                          )}
                          {repLabel && (
                            <span className="inline-flex items-center gap-0.5 text-cyan-300">
                              <Repeat className="w-3 h-3" />
                              {repLabel}
                            </span>
                          )}
                          {task.remindBeforeMin && task.remindBeforeMin > 0 ? (
                            <span className="text-amber-200/90">
                              🔔 {getRemindBeforeLabel(task.remindBeforeMin)}
                            </span>
                          ) : null}
                          {task.amount && task.amount > 0 ? (
                            <span className="text-rose-300 font-bold">
                              {formatMoney(task.amount)}
                            </span>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTaskId(task.id);
                            setEditingTaskTitle(task.title);
                            setEditingTaskTime(task.time || '');
                          }}
                          className="p-1 text-slate-400 hover:text-white cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const prev = tasks;
                            onUpdateTasks(tasks.filter((t) => t.id !== task.id));
                            onShowToast('Задача удалена', () => onUpdateTasks(prev));
                          }}
                          className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </GlassSection>

      {/* ОКНО 2: ЗАМЕТКИ (ОТДЕЛЬНЫЕ ВКЛАДКИ ПО ТИПАМ + МИКРОФОН + РАСШИФРОВКА + ОЧИСТКА) */}
      <GlassSection
        id="sec-planner-notes"
        title="🎙️ Заметки и списки"
        helpText="Вкладки разделены по назначению: «🛒 Список покупок» при вычёркивании товара предлагает указать цену и сразу записать трату; «✅ Задачи на день» автоматически подтягивает дела из календаря; «📝 Заметки» — свободная доска с диктофоном и расшифровкой."
        rightExtra={
          activeTab && activeTab.items.length > 0 ? (
            <button
              type="button"
              onClick={handleClearActiveTab}
              className="fin-btn danger sm"
              style={{ padding: '3px 8px', fontSize: '.7rem' }}
              title="Очистить все заметки в этой вкладке"
            >
              <Eraser className="w-3 h-3" />
              <span>Очистить</span>
            </button>
          ) : null
        }
        collapsed={collapsedSecs.includes('sec-planner-notes')}
        onToggleCollapse={onToggleSec}
      >
        {/* Вкладки заметок */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {noteTabs.map((tab) => {
            const isActive = tab.id === activeTab?.id;
            const isRenaming = renamingTabId === tab.id;
            return (
              <div
                key={tab.id}
                className="flex items-center rounded-xl border shrink-0 transition"
                style={{
                  background: isActive ? 'linear-gradient(135deg, var(--h1), var(--acc))' : 'var(--fld)',
                  borderColor: isActive ? 'rgba(255,255,255,.3)' : 'var(--line)',
                  color: isActive ? '#fff' : 'var(--mute)',
                }}
              >
                {isRenaming ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const t = renameTabValue.trim();
                      if (t) {
                        onUpdateNotes(
                          noteTabs.map((x) => (x.id === tab.id ? { ...x, title: t } : x)),
                          activeNoteTabId
                        );
                      }
                      setRenamingTabId(null);
                    }}
                    className="px-2 py-1"
                  >
                    <input
                      className="w-24 bg-transparent text-xs font-bold text-white outline-none"
                      value={renameTabValue}
                      onChange={(e) => setRenameTabValue(e.target.value)}
                      onBlur={() => setRenamingTabId(null)}
                      autoFocus
                    />
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => onUpdateNotes(noteTabs, tab.id)}
                    onDoubleClick={() => {
                      setRenamingTabId(tab.id);
                      setRenameTabValue(tab.title);
                    }}
                    className="px-3 py-1.5 text-xs font-bold whitespace-nowrap cursor-pointer flex items-center gap-1"
                  >
                    <span>{getTabIcon(tab.tabType)}</span>
                    <span>{tab.title}</span>
                    {tab.tabType === 'daily-tasks'
                      ? dayTasks.length > 0 && <span className="opacity-80">({dayTasks.length})</span>
                      : tab.items.length > 0 && <span className="opacity-80">({tab.items.length})</span>}
                  </button>
                )}

                {isActive && !isRenaming && (
                  <div className="flex items-center pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingTabId(tab.id);
                        setRenameTabValue(tab.title);
                      }}
                      className="p-1 opacity-80 hover:opacity-100 cursor-pointer"
                      title="Переименовать"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    {noteTabs.length > 1 && tab.tabType !== 'daily-tasks' && (
                      <button
                        type="button"
                        onClick={() => {
                          const prevTabs = noteTabs;
                          const prevAct = activeNoteTabId;
                          const next = noteTabs.filter((x) => x.id !== tab.id);
                          onUpdateNotes(next, next[0].id);
                          onShowToast(`Вкладка «${tab.title}» удалена`, () =>
                            onUpdateNotes(prevTabs, prevAct)
                          );
                        }}
                        className="p-1 opacity-80 hover:opacity-100 cursor-pointer"
                        title="Удалить вкладку"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {addingTab ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = newTabTitle.trim();
                if (!title) return;
                const id = `tab-${uid()}`;
                onUpdateNotes([...noteTabs, { id, title, tabType: newTabType, items: [] }], id);
                setNewTabTitle('');
                setAddingTab(false);
              }}
              className="flex items-center gap-1 shrink-0"
            >
              <select
                className="fin-input"
                style={{ padding: '4px 6px', fontSize: '.72rem' }}
                value={newTabType}
                onChange={(e) => setNewTabType(e.target.value as NoteTabType)}
              >
                <option value="shopping">🛒 Покупки</option>
                <option value="notes">📝 Заметки</option>
              </select>
              <input
                className="fin-input w-24"
                style={{ padding: '4px 8px', fontSize: '.75rem' }}
                value={newTabTitle}
                onChange={(e) => setNewTabTitle(e.target.value)}
                placeholder="Имя..."
                autoFocus
              />
              <button type="submit" className="fin-btn sm" style={{ padding: '4px 8px' }}>
                Ок
              </button>
              <button
                type="button"
                onClick={() => setAddingTab(false)}
                className="p-1 text-slate-400 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingTab(true)}
              className="fin-btn ghost sm shrink-0"
              style={{ padding: '5px 9px' }}
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Вкладка</span>
            </button>
          )}
        </div>

        {/* Подсказка типа вкладки + синхронизированные задачи из календаря для «Задачи на день» */}
        {activeTab?.tabType === 'shopping' && (
          <div className="text-[11px] text-cyan-200/85 bg-cyan-500/10 border border-cyan-400/25 rounded-xl px-2.5 py-1.5">
            🛒 Отметьте купленный товар галочкой — откроется окно для ввода цены и записи в «Расходы».
          </div>
        )}

        {activeTab?.tabType === 'daily-tasks' && (
          <div className="rounded-2xl bg-[var(--fld)] border border-cyan-400/25 p-2.5 space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="font-bold text-cyan-200">
                📅 Из календаря на {selectedDay === todayIso ? 'сегодня' : fmtHumanDate(selectedDay)}
              </span>
              <span className="fin-sub">
                {dayTasks.filter((t) => isTaskDoneOnDate(t, selectedDay)).length}/{dayTasks.length}
              </span>
            </div>

            {dayTasks.length === 0 ? (
              <div className="fin-sub text-center py-1">
                В календаре на этот день задач пока нет. Добавьте ниже или в календаре выше.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {dayTasks.map((t) => {
                  const done = isTaskDoneOnDate(t, selectedDay);
                  return (
                    <div
                      key={t.id}
                      onClick={() => toggleTaskCompletion(t, selectedDay)}
                      className="tx-tile cursor-pointer"
                      style={{ opacity: done ? 0.6 : 1 }}
                    >
                      <span
                        className="w-5 h-5 rounded-md border flex items-center justify-center shrink-0"
                        style={{
                          background: done ? 'var(--acc)' : 'transparent',
                          borderColor: done ? 'var(--acc)' : 'rgba(255,255,255,.3)',
                        }}
                      >
                        {done && <Check className="w-3 h-3 text-white stroke-[3]" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-xs font-semibold truncate ${done ? 'line-through text-[var(--mute)]' : ''}`}>
                          {t.title}
                        </div>
                        {(t.time || (t.amount && t.amount > 0)) && (
                          <div className="fin-sub text-[10px]">
                            {t.time ? `⏰ ${t.time}` : ''}
                            {t.time && t.amount ? ' · ' : ''}
                            {t.amount ? `💰 ${formatMoney(t.amount)}` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const title = dailyQuickTask.trim();
                if (!title) return;
                onUpdateTasks([
                  ...tasks,
                  {
                    id: uid(),
                    date: selectedDay,
                    title,
                    done: false,
                    notify: false,
                    repeat: 'none',
                    remindBeforeMin: 0,
                    completedDates: [],
                    createdAt: Date.now(),
                  },
                ]);
                setDailyQuickTask('');
              }}
              className="flex gap-1.5"
            >
              <input
                className="fin-input flex-1"
                style={{ padding: '6px 9px', fontSize: '.78rem' }}
                value={dailyQuickTask}
                onChange={(e) => setDailyQuickTask(e.target.value)}
                placeholder="Быстро добавить задачу в календарь..."
              />
              <button type="submit" className="fin-btn sm">
                +
              </button>
            </form>
          </div>
        )}

        {/* Запись голосовой заметки с фирменной сферой микрофона */}
        {isRecording ? (
          <div className="rounded-2xl bg-[var(--fld)] border border-rose-400/45 p-3 space-y-2.5">
            <div className="flex items-center gap-2.5">
              <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse shrink-0" />
              <b className="text-rose-300 tabular-nums text-sm">{formatDuration(recordSec)}</b>
              <div className="flex items-center gap-1 h-7 flex-1">
                {liveLevels.map((lvl, idx) => (
                  <span
                    key={idx}
                    className="flex-1 rounded-full bg-rose-400/80 transition-all duration-75"
                    style={{ height: `${Math.max(16, lvl)}%` }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={stopVoiceRecording} className="fin-btn flex-1">
                <Square className="w-3.5 h-3.5 fill-current" />
                <span>Сохранить запись</span>
              </button>
              <button type="button" onClick={cancelVoiceRecording} className="fin-btn ghost sm">
                Отмена
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              type="button"
              onClick={startVoiceRecording}
              className="w-full rounded-2xl border border-white/14 p-3 flex items-center justify-center gap-3 cursor-pointer transition active:scale-[0.98]"
              style={{
                background: 'linear-gradient(160deg, rgba(26,46,44,.95), rgba(14,25,24,.98))',
                boxShadow: '0 8px 20px rgba(0,0,0,.35)',
              }}
            >
              <span className="mic-orb" style={{ width: '44px', height: '44px' }}>
                <Mic className="w-5 h-5" />
              </span>
              <div className="text-left">
                <div className="font-extrabold text-sm text-white">Наговорить заметку</div>
                <div className="fin-sub">Можно слушать или нажать «Расшифровать»</div>
              </div>
            </button>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const text = textNoteInput.trim();
                if (!text) return;
                updateActiveTabItems((items) => [
                  { id: uid(), kind: 'text', createdAt: Date.now(), text, checked: false },
                  ...items,
                ]);
                setTextNoteInput('');
              }}
              className="flex gap-1.5"
            >
              <input
                className="fin-input flex-1"
                value={textNoteInput}
                onChange={(e) => setTextNoteInput(e.target.value)}
                placeholder={`Написать во вкладку «${activeTab?.title || 'Заметки'}»...`}
              />
              <button type="submit" className="fin-btn sm">
                +
              </button>
            </form>
          </div>
        )}

        {recError && <div className="text-xs text-rose-400">{recError}</div>}

        {/* Список заметок активной вкладки */}
        <div className="space-y-2 max-h-80 overflow-y-auto pr-0.5">
          {!activeTab || activeTab.items.length === 0 ? (
            <div className="fin-sub py-3 text-center">
              Вкладка «{activeTab?.title || 'Заметки'}» чиста — как новая доска!
            </div>
          ) : (
            activeTab.items.map((item) =>
              item.kind === 'voice' ? (
                <VoiceNoteRow
                  key={item.id}
                  item={item}
                  onDelete={(id) => {
                    const prevTabs = noteTabs;
                    updateActiveTabItems((items) => items.filter((it) => it.id !== id));
                    onShowToast('Заметка удалена', () => onUpdateNotes(prevTabs, activeTab.id));
                  }}
                  onTranscribe={handleTranscribeVoiceNote}
                  onToggleTranscript={(id) =>
                    updateActiveTabItems((items) =>
                      items.map((it) =>
                        it.id === id ? { ...it, transcriptVisible: !it.transcriptVisible } : it
                      )
                    )
                  }
                  onSplitToChecklist={handleSplitTranscriptToChecklist}
                  isTranscribing={Boolean(transcribingIds[item.id])}
                  transcribeError={transcribeErrors[item.id] || null}
                />
              ) : (
                <div
                  key={item.id}
                  className="tx-tile"
                  style={{ opacity: item.checked ? 0.6 : 1 }}
                >
                  <button
                    type="button"
                    onClick={() => toggleNoteItemCheck(item)}
                    className="w-6 h-6 rounded-lg border flex items-center justify-center shrink-0 cursor-pointer"
                    style={{
                      background: item.checked ? 'var(--acc)' : 'transparent',
                      borderColor: item.checked ? 'var(--acc)' : 'rgba(255,255,255,.3)',
                    }}
                  >
                    {item.checked && <Check className="w-3.5 h-3.5 text-white stroke-[3]" />}
                  </button>
                  <div
                    onClick={() => toggleNoteItemCheck(item)}
                    className={`flex-1 text-sm cursor-pointer break-words ${
                      item.checked ? 'line-through text-[var(--mute)]' : ''
                    }`}
                  >
                    {item.text}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const prevTabs = noteTabs;
                      updateActiveTabItems((items) => items.filter((it) => it.id !== item.id));
                      onShowToast('Пункт удалён', () => onUpdateNotes(prevTabs, activeTab.id));
                    }}
                    className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer shrink-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            )
          )}
        </div>

        {/* Явная кнопка очистки внизу вкладки для удобства одной рукой */}
        {activeTab && activeTab.items.length > 0 && (
          <button
            type="button"
            onClick={handleClearActiveTab}
            className="fin-btn danger w-full sm"
          >
            <Eraser className="w-3.5 h-3.5" />
            <span>Очистить заметки во вкладке «{activeTab.title}»</span>
          </button>
        )}
      </GlassSection>

      {/* ДИАЛОГ: ДОБАВИТЬ КУПЛЕННЫЙ ТОВАР / ОПЛАЧЕННУЮ ЗАДАЧУ В РАСХОДЫ (С ЗАЩИТОЙ ОТ ДУБЛЕЙ) */}
      {expensePrompt && (
        <ModalShell
          title={
            expensePrompt.source === 'shopping'
              ? '🛒 Покупка совершена!'
              : '✅ Финансовая задача выполнена!'
          }
          onClose={() => setExpensePrompt(null)}
        >
          <form onSubmit={handleConfirmAddExpense} className="space-y-3">
            <p className="text-xs text-slate-200 leading-relaxed">
              {expensePrompt.source === 'shopping'
                ? 'Хотите добавить эту покупку в раздел «Расходы»? Укажите фактическую стоимость:'
                : 'Хотите записать эту оплату в раздел «Расходы»? Проверьте сумму и категорию:'}
            </p>

            {/* ЗАЩИТА ОТ ДВОЙНОГО УЧЁТА */}
            {expensePrompt.warning && (
              <div className="rounded-2xl bg-amber-500/15 border border-amber-400/45 p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs font-extrabold text-amber-200">
                  <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0" />
                  <span>Защита от двойного учёта ({expensePrompt.warning.sourceLabel})</span>
                </div>
                <p className="text-[11px] leading-relaxed text-amber-100/90">
                  {expensePrompt.warning.reason}
                </p>
              </div>
            )}

            <label className="fin-sub block">
              Название
              <input
                className="fin-input w-full mt-1"
                value={expensePrompt.name}
                onChange={(e) =>
                  setExpensePrompt((p) => (p ? { ...p, name: e.target.value } : null))
                }
              />
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="fin-sub block">
                Стоимость, ₽
                <input
                  className="fin-input w-full mt-1 tabular-nums"
                  inputMode="decimal"
                  placeholder="Например: 450"
                  value={expensePrompt.amount}
                  onChange={(e) => {
                    setExpensePromptErr(null);
                    setExpensePrompt((p) => (p ? { ...p, amount: e.target.value } : null));
                  }}
                  autoFocus
                />
              </label>

              <label className="fin-sub block">
                Оплата
                <select
                  className="fin-input w-full mt-1"
                  value={expensePrompt.method}
                  onChange={(e) =>
                    setExpensePrompt((p) => (p ? { ...p, method: e.target.value } : null))
                  }
                >
                  <option value="Карта">💳 Карта</option>
                  <option value="Наличные">💵 Наличные</option>
                  <option value="Перевод">📱 Перевод</option>
                </select>
              </label>
            </div>

            <label className="fin-sub block">
              Категория
              <select
                className="fin-input w-full mt-1"
                value={expensePrompt.category}
                onChange={(e) =>
                  setExpensePrompt((p) => (p ? { ...p, category: e.target.value } : null))
                }
              >
                {state.cats.map((c) => (
                  <option key={c[0]} value={c[0]}>
                    {c[0]}
                  </option>
                ))}
              </select>
            </label>

            {expensePromptErr && <div className="text-xs text-rose-300">{expensePromptErr}</div>}

            <div className="flex flex-col sm:flex-row gap-2 pt-1">
              {expensePrompt.warning ? (
                <>
                  <button
                    type="button"
                    onClick={() => setExpensePrompt(null)}
                    className="fin-btn flex-1"
                  >
                    Просто отметить (не дублировать)
                  </button>
                  <button type="submit" className="fin-btn ghost sm">
                    Всё равно добавить расход
                  </button>
                </>
              ) : (
                <>
                  <button type="submit" className="fin-btn flex-1">
                    💸 Добавить в расходы
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpensePrompt(null)}
                    className="fin-btn ghost"
                  >
                    Просто отметить
                  </button>
                </>
              )}
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}
