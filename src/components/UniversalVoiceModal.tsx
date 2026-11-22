import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Mic, Settings, Sparkles, Square } from 'lucide-react';
import { AiMode, CategoryTuple } from '../types';
import {
  fmtHumanDate,
  formatMoney,
  getRemindBeforeLabel,
  getRepeatLabel,
  parseUniversalCommand,
  UniversalCommandResult,
} from '../utils/finance';
import {
  ensureMicrophonePermission,
  isNativeAndroidHardware,
  openAndroidAppSettings,
  recognizeSpeechOnAndroid,
} from '../utils/nativeHardware';
import { blobToBase64, formatDuration } from '../utils/sound';
import { ModalShell } from './Modals';

interface UniversalVoiceModalProps {
  cats: CategoryTuple[];
  aiMode: AiMode;
  onExecute: (cmd: UniversalCommandResult) => void;
  onClose: () => void;
}

const EXAMPLES = [
  { tag: '🛒 Расход', text: 'Потратил 650 рублей в аптеке' },
  { tag: '💰 Доход', text: 'Получил зарплату 55000 рублей' },
  { tag: '📅 Задача', text: 'Напомни завтра в 10:00 позвонить врачу' },
  { tag: '🔁 Подписка', text: '25 числа оплатить интернет 700 рублей каждый месяц за 1 день' },
  { tag: '🛍️ Покупки', text: 'В магазин: хлеб, молоко, яблоки' },
  { tag: '🌱 Привычка', text: 'Добавь привычку зарядка по утрам' },
];

export default function UniversalVoiceModal({
  cats,
  aiMode,
  onExecute,
  onClose,
}: UniversalVoiceModalProps) {
  const [phrase, setPhrase] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micDenied, setMicDenied] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechRecRef = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startMsRef = useRef<number>(0);
  const cancelledRef = useRef<boolean>(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
      if (speechRecRef.current) {
        try {
          speechRecRef.current.abort();
        } catch {
          // ignore
        }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((tr) => tr.stop());
      }
    };
  }, []);

  const cleanup = () => {
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

  const startBrowserSpeech = () => {
    const SR =
      (window as unknown as { SpeechRecognition?: new () => unknown; webkitSpeechRecognition?: new () => unknown })
        .SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => unknown }).webkitSpeechRecognition;

    if (!SR) {
      setError('Браузер не поддерживает локальное распознавание речи. Введите команду текстом ниже.');
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rec: any = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      startMsRef.current = Date.now();

      rec.onresult = (ev: {
        results?: ArrayLike<{ isFinal?: boolean; [idx: number]: { transcript?: string } }>;
      }) => {
        if (!ev.results) return;
        const finals: string[] = [];
        let interim = '';
        for (let i = 0; i < ev.results.length; i++) {
          const item = ev.results[i];
          const text = (item?.[0]?.transcript || '').trim();
          if (!text) continue;
          if (item.isFinal) {
            if (finals[finals.length - 1]?.toLowerCase() !== text.toLowerCase()) {
              finals.push(text);
            }
          } else {
            interim = text;
          }
        }
        const combined = [...finals, interim].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
        if (combined) setPhrase(combined);
      };
      rec.onerror = (ev: { error?: string }) => {
        cleanup();
        const code = ev?.error || '';
        if (code === 'aborted') return;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          if (isNativeAndroidHardware()) setMicDenied(true);
          setError('Нет доступа к микрофону. Разрешите микрофон в настройках устройства.');
        } else if (code === 'no-speech') {
          setError('Речь не услышана. Нажмите на микрофон и произнесите фразу чётче.');
        } else {
          setError('Не удалось распознать речь. Попробуйте повторить или введите текст.');
        }
      };
      rec.onend = () => cleanup();

      speechRecRef.current = rec;
      rec.start();
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordSec(Math.floor((Date.now() - startMsRef.current) / 1000));
      }, 250);
    } catch {
      cleanup();
      setError('Не удалось включить микрофон.');
    }
  };

  const handleToggleMic = async () => {
    setError(null);
    setMicDenied(false);
    if (isRecording) {
      if (speechRecRef.current) {
        try {
          speechRecRef.current.stop();
        } catch {
          cleanup();
        }
        return;
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      return;
    }

    const isStaticHost =
      typeof window !== 'undefined' && /\.github\.io$|\.pages\.dev$|\.netlify\.app$/i.test(window.location.hostname);

    // Native Android APK: prefer system speech recognizer for local/offline mode
    if (isNativeAndroidHardware() && (aiMode !== 'cloud' || isStaticHost)) {
      const nativeRes = await recognizeSpeechOnAndroid('Продиктуйте команду');
      if (nativeRes.denied) {
        setMicDenied(true);
        setError('Нет доступа к микрофону. Разрешите микрофон в настройках Android.');
        return;
      }
      if (nativeRes.supported) {
        if (nativeRes.text) {
          setPhrase(nativeRes.text);
        } else if (!nativeRes.cancelled) {
          setError('Речь не услышана. Нажмите на микрофон и произнесите фразу чётче.');
        }
        return;
      }
    }

    // Request native Android RECORD_AUDIO permission before WebView mic access
    const perm = await ensureMicrophonePermission();
    if (!perm.granted) {
      setMicDenied(true);
      setError('Нет доступа к микрофону. Разрешите микрофон в настройках Android.');
      return;
    }

    // Use local browser SpeechRecognition if offline/local-llm mode or on static hosting without /api/transcribe
    if (aiMode !== 'cloud' || isStaticHost) {
      startBrowserSpeech();
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      startBrowserSpeech();
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
      const chosen =
        typeof MediaRecorder !== 'undefined' && typeof MediaRecorder.isTypeSupported === 'function'
          ? types.find((t) => MediaRecorder.isTypeSupported(t)) || ''
          : '';
      const rec = chosen ? new MediaRecorder(stream, { mimeType: chosen }) : new MediaRecorder(stream);
      chunksRef.current = [];
      cancelledRef.current = false;
      startMsRef.current = Date.now();

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const elapsed = Date.now() - startMsRef.current;
        const chunks = chunksRef.current.slice();
        const mime = rec.mimeType || chosen || 'audio/webm';
        const wasCancelled = cancelledRef.current;
        cleanup();
        if (wasCancelled || elapsed < 350 || chunks.length === 0) return;

        setIsTranscribing(true);
        try {
          const audioBase64 = await blobToBase64(new Blob(chunks, { type: mime }));
          const resp = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ audioBase64, mimeType: mime, context: 'advisor' }),
          });
          const rawText = await resp.text();
          let data: { text?: string; error?: string } = {};
          try {
            data = JSON.parse(rawText) as { text?: string; error?: string };
          } catch {
            throw new Error(
              'Облачная расшифровка недоступна на статическом хостинге. Переключите ИИ в Настройках на «Офлайн» для распознавания браузером или введите текст.'
            );
          }
          if (!resp.ok || !data.text) throw new Error(data.error || 'Не удалось распознать речь.');
          setPhrase(data.text);
        } catch (err: unknown) {
          setError(err instanceof Error ? err.message : 'Ошибка расшифровки речи.');
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorderRef.current = rec;
      rec.start();
      setIsRecording(true);
      timerRef.current = window.setInterval(() => {
        setRecordSec(Math.floor((Date.now() - startMsRef.current) / 1000));
      }, 250);
    } catch {
      cleanup();
      setError('Нет доступа к микрофону. Разрешите доступ или введите команду текстом.');
    }
  };

  const preview = useMemo<UniversalCommandResult | null>(() => {
    if (!phrase.trim()) return null;
    return parseUniversalCommand(phrase, cats);
  }, [phrase, cats]);

  return (
    <ModalShell title="🎙️ Универсальная команда" onClose={onClose}>
      {/* Кнопка записи */}
      <div className="flex flex-col items-center gap-2 py-2">
        <button
          type="button"
          disabled={isTranscribing}
          onClick={handleToggleMic}
          className={`mic-orb ${isRecording ? 'rec' : ''}`}
          style={{ width: 68, height: 68 }}
        >
          {isTranscribing ? (
            <Loader2 className="w-7 h-7 animate-spin" />
          ) : isRecording ? (
            <Square className="w-6 h-6 fill-current" />
          ) : (
            <Mic className="w-7 h-7" />
          )}
        </button>
        <div className="text-xs font-bold text-slate-200 text-center">
          {isTranscribing
            ? 'Распознаю вашу фразу...'
            : isRecording
            ? `Слушаю… ${formatDuration(recordSec)} — нажмите стоп`
            : 'Нажмите и скажите, что нужно записать'}
        </div>
      </div>

      {/* Поле текста */}
      <textarea
        rows={2}
        value={phrase}
        onChange={(e) => setPhrase(e.target.value)}
        placeholder="Или напишите фразу здесь, например: Напомни завтра в 10 позвонить врачу"
        className="fin-input w-full resize-none"
      />

      {error && (
        <div className="rounded-xl bg-rose-500/15 border border-rose-400/35 px-3 py-2 text-xs text-rose-200 space-y-2">
          <div>{error}</div>
          {micDenied && isNativeAndroidHardware() && (
            <button
              type="button"
              onClick={() => void openAndroidAppSettings()}
              className="w-full py-1.5 px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-xs font-bold text-amber-100 flex items-center justify-center gap-1.5 cursor-pointer transition"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>Открыть настройки разрешений Android</span>
            </button>
          )}
        </div>
      )}

      {/* Живой предпросмотр распознанного действия */}
      {preview && (
        <div className="rounded-2xl bg-emerald-500/12 border border-emerald-400/40 p-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-extrabold text-emerald-300">
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {preview.kind === 'expense' && '🛒 Будет добавлено в «Расходы»'}
              {preview.kind === 'income' && '💰 Будет добавлено в «Бюджет → Доходы»'}
              {preview.kind === 'task' && '📅 Будет добавлено в «Календарь задач»'}
              {preview.kind === 'shopping' && '🛍️ Будет добавлено в «Список покупок»'}
              {preview.kind === 'habit' && '🌱 Будет добавлено в «Привычки Советника»'}
            </span>
          </div>

          {preview.kind === 'expense' && (
            <div className="text-xs text-slate-100 space-y-1">
              {preview.items.map((it, idx) => (
                <div key={idx} className="flex justify-between gap-2">
                  <span>
                    <b>{it.n || it.c}</b> ({it.c})
                  </span>
                  <b className="text-rose-300 tabular-nums">{formatMoney(it.a)}</b>
                </div>
              ))}
              <div className="fin-sub">
                Дата: {fmtHumanDate(preview.date)} · {preview.method}
              </div>
            </div>
          )}

          {preview.kind === 'income' && (
            <div className="text-xs text-slate-100 flex justify-between gap-2">
              <span>
                <b>{preview.title}</b> ({preview.category}) · {fmtHumanDate(preview.date)}
              </span>
              <b className="text-emerald-300 tabular-nums">+{formatMoney(preview.amount)}</b>
            </div>
          )}

          {preview.kind === 'task' && (
            <div className="text-xs text-slate-100 space-y-0.5">
              <div className="font-bold">{preview.title}</div>
              <div className="fin-sub">
                📅 {fmtHumanDate(preview.date)} · ⏰ {preview.time}
                {preview.repeat !== 'none' ? ` · 🔁 ${getRepeatLabel(preview.repeat)}` : ''}
                {preview.remindBeforeMin > 0 ? ` · 🔔 ${getRemindBeforeLabel(preview.remindBeforeMin)}` : ''}
                {preview.amount ? ` · 💳 ${formatMoney(preview.amount)}` : ''}
              </div>
            </div>
          )}

          {preview.kind === 'shopping' && (
            <div className="flex flex-wrap gap-1">
              {preview.items.map((it, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-lg bg-white/10 border border-white/15 text-xs text-white"
                >
                  • {it}
                </span>
              ))}
            </div>
          )}

          {preview.kind === 'habit' && (
            <div className="text-xs font-bold text-white">
              {preview.icon} {preview.title}
            </div>
          )}

          <button
            type="button"
            onClick={() => {
              onExecute(preview);
              onClose();
            }}
            className="fin-btn w-full flex items-center justify-center gap-1.5"
          >
            <Check className="w-4 h-4" />
            <span>Выполнить и сохранить</span>
          </button>
        </div>
      )}

      {/* Инструкция с кликабельными примерами */}
      <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 space-y-2">
        <div className="text-xs font-extrabold text-white">📖 Инструкция: как говорить команды</div>
        <div className="fin-sub">
          Нажмите на любой пример ниже, чтобы проверить, как приложение само раскладывает фразы по нужным разделам:
        </div>
        <div className="space-y-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.tag}
              type="button"
              onClick={() => setPhrase(ex.text)}
              className="w-full text-left px-2.5 py-1.5 rounded-xl bg-white/5 hover:bg-white/12 border border-white/10 text-xs transition cursor-pointer flex items-center justify-between gap-2"
            >
              <span className="text-slate-200">«{ex.text}»</span>
              <span className="text-[10px] font-bold text-emerald-300 shrink-0">{ex.tag}</span>
            </button>
          ))}
        </div>
      </div>
    </ModalShell>
  );
}
