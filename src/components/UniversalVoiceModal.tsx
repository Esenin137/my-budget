import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Mic, Sparkles, Square } from 'lucide-react';
import { AiMode, CategoryTuple } from '../types';
import {
  fmtHumanDate,
  formatMoney,
  getRemindBeforeLabel,
  getRepeatLabel,
  parseUniversalCommand,
  UniversalCommandResult,
} from '../utils/finance';
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
      rec.maxAlternatives = 1;
      startMsRef.current = Date.now();

      rec.onresult = (ev: { results?: ArrayLike<ArrayLike<{ transcript?: string }>> }) => {
        let txt = '';
        if (ev.results) {
          for (let i = 0; i < ev.results.length; i++) {
            txt += ev.results[i]?.[0]?.transcript || '';
          }
        }
        if (txt.trim()) setPhrase(txt.trim());
      };
      rec.onerror = () => {
        cleanup();
        setError('Не удалось распознать речь. Попробуйте повторить или введите текст.');
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

    // Use local browser SpeechRecognition if offline/local-llm mode
    if (aiMode !== 'cloud') {
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
        <div className="rounded-xl bg-rose-500/15 border border-rose-400/35 px-3 py-2 text-xs text-rose-200">
          {error}
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
