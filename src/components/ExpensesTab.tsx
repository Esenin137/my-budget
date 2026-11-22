import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Image as ImageIcon, Loader2, Mic, Pencil, QrCode, Search, Settings, Trash2, X } from 'lucide-react';
import { CategoryTuple, PeriodMode, RepeatFreq, Transaction } from '../types';
import {
  CAT_ICON,
  fmtShortDate,
  formatMoney,
  isTaxDeductible,
  ParsedExpenseItem,
  parseNum,
  parsePhrase,
  uid,
} from '../utils/finance';
import {
  ensureCameraPermission,
  ensureMicrophonePermission,
  isNativeAndroidHardware,
  openAndroidAppSettings,
  parseFnsReceiptQr,
  recognizeSpeechOnAndroid,
} from '../utils/nativeHardware';
import { isoDate, normDate } from '../utils/storage';
import GlassSection from './GlassSection';
import { ModalShell } from './Modals';

interface ExpensesTabProps {
  cats: CategoryTuple[];
  curDate: Date;
  viewMode: PeriodMode;
  periodOutTx: Transaction[];
  collapsedSecs: string[];
  onToggleSec: (id: string) => void;
  onSaveExpenses: (items: Transaction[], jumpDate: string) => void;
  onDeleteTx: (id: number) => void;
  onEditTx: (tx: Transaction) => void;
  onStopRepeat: (id: number) => void;
  onOpenCategories: () => void;
  onOpenReceipt: (tx: Transaction) => void;
  onOpenBreakdown: () => void;
  onOpenCategoryBreakdown: (cat: string) => void;
  onOpenDayBreakdown: (dayIso: string) => void;
}

export default function ExpensesTab({
  cats,
  curDate,
  viewMode,
  periodOutTx,
  collapsedSecs,
  onToggleSec,
  onSaveExpenses,
  onDeleteTx,
  onEditTx,
  onStopRepeat,
  onOpenCategories,
  onOpenReceipt,
  onOpenBreakdown,
  onOpenCategoryBreakdown,
  onOpenDayBreakdown,
}: ExpensesTabProps) {
  const [sayText, setSayText] = useState('');
  const [hint, setHint] = useState('');
  const [previewItems, setPreviewItems] = useState<ParsedExpenseItem[] | null>(null);
  const [previewDate, setPreviewDate] = useState(() => isoDate(curDate));
  const [previewMethod, setPreviewMethod] = useState('Карта');
  const [previewRepeat, setPreviewRepeat] = useState<RepeatFreq>('none');
  const [pendingImg, setPendingImg] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [hardwareDenied, setHardwareDenied] = useState<'mic' | 'camera' | null>(null);
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [qrLiveDetectSupported, setQrLiveDetectSupported] = useState(false);

  const recRef = useRef<{ stop: () => void; abort?: () => void } | null>(null);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrStreamRef = useRef<MediaStream | null>(null);
  const qrTimerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const stopQrCamera = () => {
    if (qrTimerRef.current) {
      window.clearInterval(qrTimerRef.current);
      qrTimerRef.current = null;
    }
    if (qrStreamRef.current) {
      qrStreamRef.current.getTracks().forEach((tr) => tr.stop());
      qrStreamRef.current = null;
    }
    if (qrVideoRef.current) {
      qrVideoRef.current.srcObject = null;
    }
  };

  useEffect(() => {
    if (!previewItems) {
      setPreviewDate(isoDate(curDate));
    }
  }, [curDate, previewItems]);

  useEffect(() => {
    return () => {
      stopQrCamera();
      if (recRef.current) {
        try {
          if (recRef.current.abort) recRef.current.abort();
          else recRef.current.stop();
        } catch {
          // ignore
        }
        recRef.current = null;
      }
    };
  }, []);

  const detectQrFromSource = async (source: ImageBitmapSource): Promise<string | null> => {
    type BarcodeDetectorCtor = new (opts?: { formats?: string[] }) => {
      detect: (src: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
    };
    const BD = (window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector;
    if (!BD) return null;
    try {
      const detector = new BD({ formats: ['qr_code'] });
      const codes = await detector.detect(source);
      const first = codes.find((c) => typeof c.rawValue === 'string' && c.rawValue.trim().length > 0);
      return first?.rawValue?.trim() || null;
    } catch {
      return null;
    }
  };

  const applyScannedReceipt = (imgDataUrl: string | null, rawQr: string | null) => {
    if (imgDataUrl) setPendingImg(imgDataUrl);
    const parsedQr = rawQr ? parseFnsReceiptQr(rawQr) : null;
    if (parsedQr) {
      const d = parsedQr.dateIso || isoDate(curDate);
      setPreviewDate(d);
      setPreviewMethod('Карта');
      setPreviewItems([
        {
          a: parsedQr.amount || 0,
          n: parsedQr.time ? `Чек по QR (${parsedQr.time})` : 'Чек по QR',
          c: 'Еда',
        },
      ]);
      setHint(
        parsedQr.amount
          ? `✅ QR чека считан: ${formatMoney(parsedQr.amount)} за ${fmtShortDate(d)}. Выберите категорию и нажмите Сохранить.`
          : `✅ Дата чека из QR (${fmtShortDate(d)}) считана! Впишите сумму и сохраните.`
      );
      return;
    }

    setPreviewDate(isoDate(curDate));
    setPreviewMethod('Карта');
    setPreviewItems([
      {
        a: 0,
        n: rawQr ? `Чек (QR: ${rawQr.slice(0, 32)})` : 'Чек из магазина',
        c: 'Еда',
      },
    ]);
    setHint(
      rawQr
        ? '📷 QR считан (нестандартный формат). Укажите сумму и сохраните.'
        : '📷 Фото чека прикреплено! Укажите сумму и сохраните.'
    );
  };

  const runParse = (inputStr?: string) => {
    const raw = (inputStr ?? sayText).trim();
    if (!raw) {
      setHint('Скажите или напишите, что купили и сколько стоило.');
      return;
    }
    const r = parsePhrase(raw, cats, curDate);
    setPreviewItems(r.items);
    setPreviewDate(r.date);
    setPreviewMethod(r.method);
    const miss = r.items.some((x) => !(x.a > 0));
    setHint(
      miss
        ? 'Не нашёл сумму у части покупок. Впишите её ниже.'
        : `Проверьте дату (${fmtShortDate(r.date)}) и нажмите Сохранить.`
    );
  };

  const handleVoicePhrase = async () => {
    setHardwareDenied(null);

    if (listening && recRef.current) {
      try {
        recRef.current.stop();
      } catch {
        // ignore
      }
      setListening(false);
      return;
    }

    // Native Android APK: request RECORD_AUDIO & launch system speech recognizer directly
    if (isNativeAndroidHardware()) {
      setHint('Запрашиваю микрофон и запускаю распознавание…');
      const nativeRes = await recognizeSpeechOnAndroid('Продиктуйте трату, например: молоко 120 рублей');
      if (nativeRes.denied) {
        setHardwareDenied('mic');
        setHint('Нет доступа к микрофону. Разрешите микрофон в настройках Android.');
        return;
      }
      if (nativeRes.supported) {
        if (nativeRes.text) {
          setSayText(nativeRes.text);
          runParse(nativeRes.text);
        } else if (nativeRes.cancelled) {
          setHint('Голосовой ввод отменён.');
        } else {
          setHint('Речь не услышана. Нажмите «Говорить» и повторите.');
        }
        return;
      }
      // Fallback if device lacks RecognizerIntent app: still ensure RECORD_AUDIO permission
      const perm = await ensureMicrophonePermission();
      if (!perm.granted) {
        setHardwareDenied('mic');
        setHint('Нет доступа к микрофону. Разрешите микрофон в настройках Android.');
        return;
      }
    }

    type RecInstance = {
      lang: string;
      interimResults: boolean;
      continuous?: boolean;
      maxAlternatives?: number;
      onresult:
        | ((e: { results: ArrayLike<{ isFinal?: boolean; [idx: number]: { transcript?: string } }> }) => void)
        | null;
      onerror: ((e: { error?: string }) => void) | null;
      onend: (() => void) | null;
      start: () => void;
      stop: () => void;
      abort?: () => void;
    };
    const w = window as unknown as {
      SpeechRecognition?: new () => RecInstance;
      webkitSpeechRecognition?: new () => RecInstance;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR) {
      setHint('Голосовой ввод недоступен. Введите текст и нажмите «Разобрать».');
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'ru-RU';
      rec.interimResults = true;
      rec.continuous = false;
      rec.maxAlternatives = 1;
      let latest = '';
      rec.onresult = (e) => {
        const finals: string[] = [];
        let interim = '';
        for (let i = 0; i < e.results.length; i++) {
          const item = e.results[i];
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
        if (combined) {
          latest = combined;
          setSayText(combined);
        }
      };
      rec.onerror = (e) => {
        setListening(false);
        recRef.current = null;
        const code = e?.error || '';
        if (code === 'aborted') return;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          if (isNativeAndroidHardware()) setHardwareDenied('mic');
          setHint('Нет доступа к микрофону. Разрешите микрофон в настройках устройства.');
        } else if (code === 'no-speech') {
          setHint('Речь не услышана. Нажмите на микрофон и повторите.');
        } else {
          setHint('Не удалось распознать речь. Введите текстом.');
        }
      };
      rec.onend = () => {
        setListening(false);
        recRef.current = null;
        if (latest.trim()) runParse(latest);
      };
      setSayText('');
      setHint('Слушаю…');
      recRef.current = rec;
      rec.start();
      setListening(true);
    } catch {
      setListening(false);
      recRef.current = null;
    }
  };

  const handleCloseQrModal = () => {
    stopQrCamera();
    setQrModalOpen(false);
    setQrLoading(false);
    setQrError(null);
  };

  const openQrScannerModal = async () => {
    setHardwareDenied(null);
    setQrError(null);
    setQrModalOpen(true);
    setQrLoading(true);

    const perm = await ensureCameraPermission();
    if (!perm.granted) {
      setQrLoading(false);
      setHardwareDenied('camera');
      setQrError('Нет доступа к камере. Разрешите камеру для сканирования QR-кодов и фото чеков.');
      return;
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setQrLoading(false);
      setQrError('Прямой видеопоток камеры недоступен. Используйте кнопку «Камера / галерея» ниже.');
      return;
    }

    try {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      qrStreamRef.current = stream;

      const attachAndStart = () => {
        const videoEl = qrVideoRef.current;
        if (!videoEl) return;
        videoEl.srcObject = stream;
        void videoEl.play().catch(() => {});
      };
      // Attach immediately and on next frame in case modal DOM just mounted
      attachAndStart();
      window.requestAnimationFrame(attachAndStart);
      setQrLoading(false);

      const hasBarcodeDetector =
        typeof (window as unknown as { BarcodeDetector?: unknown }).BarcodeDetector === 'function';
      setQrLiveDetectSupported(hasBarcodeDetector);

      if (hasBarcodeDetector) {
        let busy = false;
        qrTimerRef.current = window.setInterval(async () => {
          if (busy) return;
          const videoEl = qrVideoRef.current;
          if (!videoEl || videoEl.readyState < 2 || videoEl.videoWidth === 0) return;
          busy = true;
          try {
            const rawQr = await detectQrFromSource(videoEl);
            if (rawQr) {
              // Capture compressed snapshot from live video before closing
              const c = document.createElement('canvas');
              const max = 700;
              let w = videoEl.videoWidth;
              let h = videoEl.videoHeight;
              if (w > max) {
                h = Math.round((h * max) / w);
                w = max;
              }
              c.width = w;
              c.height = h;
              c.getContext('2d')?.drawImage(videoEl, 0, 0, w, h);
              const snapshot = c.toDataURL('image/jpeg', 0.62);
              handleCloseQrModal();
              applyScannedReceipt(snapshot, rawQr);
            }
          } finally {
            busy = false;
          }
        }, 380);
      }
    } catch {
      stopQrCamera();
      setQrLoading(false);
      if (isNativeAndroidHardware()) setHardwareDenied('camera');
      setQrError(
        'Не удалось открыть камеру. Проверьте разрешение камеры или выберите фото через «Камера / галерея».'
      );
    }
  };

  const handleCaptureLivePhoto = async () => {
    const videoEl = qrVideoRef.current;
    if (!videoEl || videoEl.videoWidth === 0) return;
    const c = document.createElement('canvas');
    const max = 700;
    let w = videoEl.videoWidth;
    let h = videoEl.videoHeight;
    if (w > max) {
      h = Math.round((h * max) / w);
      w = max;
    }
    c.width = w;
    c.height = h;
    c.getContext('2d')?.drawImage(videoEl, 0, 0, w, h);
    const snapshot = c.toDataURL('image/jpeg', 0.62);
    const rawQr = await detectQrFromSource(c);
    handleCloseQrModal();
    applyScannedReceipt(snapshot, rawQr);
  };

  const handleTriggerFileCapture = async () => {
    const perm = await ensureCameraPermission();
    if (!perm.granted) {
      setHardwareDenied('camera');
      setQrError('Нет доступа к камере. Разрешите камеру в настройках Android.');
      return;
    }
    fileInputRef.current?.click();
  };

  const handleReceiptPhoto = (file: File) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = typeof ev.target?.result === 'string' ? ev.target.result : '';
      if (!src) return;
      const img = new Image();
      img.onload = async () => {
        const c = document.createElement('canvas');
        const max = 700;
        let w = img.width;
        let h = img.height;
        if (w > max) {
          h = Math.round((h * max) / w);
          w = max;
        }
        c.width = w;
        c.height = h;
        c.getContext('2d')?.drawImage(img, 0, 0, w, h);
        const compressed = c.toDataURL('image/jpeg', 0.62);
        const rawQr = (await detectQrFromSource(img)) || (await detectQrFromSource(c));
        handleCloseQrModal();
        applyScannedReceipt(compressed, rawQr);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handleConfirmSave = () => {
    if (!previewItems) return;
    const valid = previewItems.filter((x) => x.a > 0);
    if (!valid.length) {
      setHint('Введите сумму больше нуля.');
      return;
    }
    const d = normDate(previewDate || isoDate(curDate));
    const baseId = uid();
    const newTxs: Transaction[] = valid.map((x, idx) => ({
      id: baseId + idx,
      t: 'out',
      a: x.a,
      c: x.c,
      m: previewMethod,
      d,
      n: x.n || x.c,
      repeat: previewRepeat,
      img: idx === 0 ? pendingImg : null,
    }));
    onSaveExpenses(newTxs, d);
    setPreviewItems(null);
    setSayText('');
    setPendingImg(null);
    setPreviewRepeat('none');
    setHint(`Трата сохранена за ${fmtShortDate(d)}!`);
  };

  const catColorMap = useMemo(() => {
    const m: Record<string, string> = {};
    cats.forEach((c) => (m[c[0]] = c[1]));
    return m;
  }, [cats]);

  const filteredList = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return periodOutTx;
    return periodOutTx.filter((t) => `${t.n} ${t.c} ${t.m}`.toLowerCase().includes(q));
  }, [periodOutTx, searchQuery]);

  const { donutBg, topCatLabel, catRows } = useMemo(() => {
    const sumOut = periodOutTx.reduce((acc, t) => acc + t.a, 0);
    const bc: Record<string, number> = {};
    periodOutTx.forEach((t) => (bc[t.c] = (bc[t.c] || 0) + t.a));
    const maxVal = Math.max(1, ...Object.values(bc));
    const active = sumOut > 0 ? cats.filter((c) => bc[c[0]]) : cats.slice(0, 4);
    const grad: string[] = [];
    let accDeg = 0;

    const rows = active.map((c) => {
      const val = bc[c[0]] || 0;
      const pct = sumOut > 0 ? Math.round((val / sumOut) * 100) : 0;
      const deg = sumOut > 0 ? (val / sumOut) * 360 : 0;
      if (deg > 0) {
        grad.push(`${c[1]} ${accDeg}deg ${accDeg + deg}deg`);
        accDeg += deg;
      }
      return { name: c[0], color: c[1], val, pct, widthPct: sumOut > 0 ? (val / maxVal) * 100 : 0 };
    });

    const topName = Object.keys(bc).sort((a, b) => bc[b] - bc[a])[0];
    const topLabel =
      sumOut > 0 && topName
        ? `${topName.length > 10 ? `${topName.slice(0, 9)}…` : topName}\n${Math.round((bc[topName] / sumOut) * 100)}%`
        : 'Нет трат\n0%';

    return {
      donutBg: grad.length ? `conic-gradient(${grad.join(',')})` : 'conic-gradient(#1D2B30 0deg 360deg)',
      topCatLabel: topLabel,
      catRows: rows,
    };
  }, [periodOutTx, cats]);

  const dayBars = useMemo(() => {
    const byDay: Record<string, number> = {};
    periodOutTx.forEach((t) => (byDay[t.d] = (byDay[t.d] || 0) + t.a));
    const now = new Date();
    const baseD =
      viewMode === 'month' &&
      curDate.getMonth() === now.getMonth() &&
      curDate.getFullYear() === now.getFullYear()
        ? now
        : curDate;

    const slots: { lbl: string; iso: string; val: number }[] = [];
    for (let k = 13; k >= 0; k--) {
      const tmp = new Date(baseD.getFullYear(), baseD.getMonth(), baseD.getDate() - k);
      const dIso = isoDate(tmp);
      slots.push({ lbl: String(tmp.getDate()).padStart(2, '0'), iso: dIso, val: byDay[dIso] || 0 });
    }
    const maxDay = Math.max(1, ...slots.map((s) => s.val));
    return slots.map((s) => ({
      ...s,
      heightPct: s.val > 0 ? Math.max(12, Math.round((s.val / maxDay) * 100)) : 6,
    }));
  }, [periodOutTx, curDate, viewMode]);

  return (
    <>

      <GlassSection
        id="sec-exp-add"
        title="Записать траты"
        helpText="Быстро фиксируйте траты голосом (можно перечислить несколько покупок сразу, например «молоко 120, хлеб 60»), фото чека или текстом. Можно задать автоповтор для постоянных платежей."
        rightExtra={
          <button
            type="button"
            onClick={onOpenCategories}
            className="fin-btn ghost sm"
            style={{ padding: '3px 8px', fontSize: '.72rem' }}
          >
            ⚙ Категории
          </button>
        }
        collapsed={collapsedSecs.includes('sec-exp-add')}
        onToggleCollapse={onToggleSec}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <button type="button" onClick={() => void handleVoicePhrase()} className="mic-tile">
            <span className={`mic-orb ${listening ? 'rec' : ''}`}>
              <Mic className="w-7 h-7" />
            </span>
            <span>{listening ? 'Стоп' : 'Говорить'}</span>
          </button>

          <button type="button" onClick={() => void openQrScannerModal()} className="cam-tile">
            <span className="w-13 h-13 rounded-2xl bg-white/8 border border-white/15 flex items-center justify-center">
              <QrCode className="w-6 h-6" />
            </span>
            <span>Снять чек / QR</span>
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleReceiptPhoto(f);
              e.target.value = '';
            }}
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runParse();
          }}
          className="flex gap-1.5"
        >
          <input
            className="fin-input flex-1"
            value={sayText}
            onChange={(e) => setSayText(e.target.value)}
            placeholder="Например: кило картошки, 400 рублей"
          />
          <button type="submit" className="fin-btn">
            Разобрать
          </button>
        </form>

        {hint && <div className="fin-sub">{hint}</div>}

        {hardwareDenied && isNativeAndroidHardware() && (
          <button
            type="button"
            onClick={() => void openAndroidAppSettings()}
            className="w-full py-2 px-3 rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/35 text-xs font-bold text-amber-100 flex items-center justify-center gap-1.5 cursor-pointer transition"
          >
            <Settings className="w-3.5 h-3.5" />
            <span>Открыть настройки разрешений Android</span>
          </button>
        )}

        {previewItems && (
          <div className="space-y-2 pt-2 border-t border-[var(--line)]">
            <div className="grid grid-cols-2 gap-2">
              <label className="fin-sub block">
                Дата траты
                <input
                  type="date"
                  className="fin-input w-full mt-1 tabular-nums"
                  value={previewDate}
                  onChange={(e) => setPreviewDate(e.target.value)}
                />
              </label>
              <label className="fin-sub block">
                Чем оплачено
                <select
                  className="fin-select w-full mt-1"
                  value={previewMethod}
                  onChange={(e) => setPreviewMethod(e.target.value)}
                >
                  <option>Карта</option>
                  <option>Наличка</option>
                  <option>Кредит / Ипотека</option>
                </select>
              </label>
            </div>

            <label className="fin-sub block">
              Повтор
              <select
                className="fin-select w-full mt-1"
                value={previewRepeat}
                onChange={(e) => setPreviewRepeat(e.target.value as RepeatFreq)}
              >
                <option value="none">Один раз</option>
                <option value="monthly">Каждый месяц</option>
                <option value="yearly">Каждый год</option>
                <option value="weekly">Каждую неделю</option>
              </select>
            </label>

            {pendingImg && (
              <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[var(--fld)] border border-[var(--line)]">
                <img src={pendingImg} alt="Чек" className="w-9 h-11 object-cover rounded-md" />
                <span className="fin-sub flex-1">📷 Фото чека прикреплено</span>
                <button
                  type="button"
                  onClick={() => setPendingImg(null)}
                  className="p-1 text-slate-400 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            {previewItems.map((it, idx) => (
              <div key={idx} className="space-y-1.5 pt-2 border-t border-[var(--line)]">
                <input
                  className="fin-input w-full"
                  value={it.n}
                  onChange={(e) => {
                    const next = [...previewItems];
                    next[idx] = { ...next[idx], n: e.target.value };
                    setPreviewItems(next);
                  }}
                  placeholder="Что купили"
                />
                <div className="flex gap-1.5">
                  <input
                    className="fin-input w-24 tabular-nums"
                    inputMode="decimal"
                    value={it.a > 0 ? String(it.a) : ''}
                    onChange={(e) => {
                      const next = [...previewItems];
                      next[idx] = { ...next[idx], a: parseNum(e.target.value) };
                      setPreviewItems(next);
                    }}
                    placeholder="Сумма"
                  />
                  <select
                    className="fin-select flex-1"
                    value={it.c}
                    onChange={(e) => {
                      const next = [...previewItems];
                      next[idx] = { ...next[idx], c: e.target.value };
                      setPreviewItems(next);
                    }}
                  >
                    {cats.map((c) => (
                      <option key={c[0]} value={c[0]}>
                        {c[0]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}

            <div className="flex gap-2">
              <button type="button" onClick={handleConfirmSave} className="fin-btn flex-1">
                Сохранить
              </button>
              <button
                type="button"
                onClick={() => {
                  setPreviewItems(null);
                  setPendingImg(null);
                }}
                className="fin-btn ghost"
              >
                Отмена
              </button>
            </div>
          </div>
        )}
      </GlassSection>

      <GlassSection
        id="sec-exp-list"
        title={`Последние траты ${periodOutTx.length ? `(${periodOutTx.length})` : ''}`}
        helpText="История всех ваших расходов за выбранный период с быстрым поиском, просмотром фото чеков и остановкой автоповторов."
        rightExtra={
          <button
            type="button"
            onClick={onOpenBreakdown}
            className="fin-btn ghost sm"
            style={{ padding: '3px 8px', fontSize: '.72rem' }}
          >
            Все ↗
          </button>
        }
        collapsed={collapsedSecs.includes('sec-exp-list')}
        onToggleCollapse={onToggleSec}
      >
        {periodOutTx.length > 3 && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              className="fin-input w-full pl-8"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по тратам..."
            />
          </div>
        )}

        <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
          {filteredList.length === 0 ? (
            <div className="fin-sub py-2">За выбранный период трат нет.</div>
          ) : (
            filteredList.map((t) => {
              const isRec = t.repeat && t.repeat !== 'none';
              const taxType = isTaxDeductible(t);
              const color = catColorMap[t.c] || '#6B827E';
              return (
                <div key={t.id} className="tx-tile">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className="w-9 h-9 rounded-full flex items-center justify-center text-base shrink-0 shadow"
                      style={{ background: color }}
                    >
                      {CAT_ICON[t.c] || '🏷️'}
                    </span>
                    <div className="min-w-0">
                      <div className="font-bold text-sm truncate flex items-center gap-1 flex-wrap">
                        <span>{t.n || t.c}</span>
                        {isRec && <span title="Регулярный">🔄</span>}
                        {taxType && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                            +13%
                          </span>
                        )}
                        {t.img && (
                          <button
                            type="button"
                            onClick={() => onOpenReceipt(t)}
                            className="text-[11px] px-1.5 py-0.5 rounded bg-white/10 text-slate-200 cursor-pointer"
                          >
                            🧾 Чек
                          </button>
                        )}
                      </div>
                      <div className="fin-sub tabular-nums truncate">
                        {fmtShortDate(t.d)} · {t.c} · {t.m}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <b className="text-[var(--warn)] tabular-nums mr-1">−{formatMoney(t.a)}</b>
                    {isRec && (
                      <button
                        type="button"
                        onClick={() => onStopRepeat(t.id)}
                        className="p-1 text-amber-400 cursor-pointer"
                        title="Остановить повтор"
                      >
                        ⏹
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onEditTx(t)}
                      className="p-1 text-slate-400 hover:text-emerald-300 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteTx(t.id)}
                      className="p-1 text-slate-400 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </GlassSection>

      <GlassSection
        id="sec-charts"
        title="Куда уходят деньги"
        helpText="Наглядная структура расходов по категориям и график трат за последние 14 дней. Нажмите на любую категорию или столбик дня, чтобы открыть подробный список операций."
        collapsed={collapsedSecs.includes('sec-charts')}
        onToggleCollapse={onToggleSec}
      >
        <div className="grid grid-cols-[112px_1fr] gap-3 items-center">
          <div
            className="w-28 h-28 rounded-full relative flex items-center justify-center shadow-lg"
            style={{ background: donutBg }}
          >
            <div className="w-[74px] h-[74px] rounded-full bg-[#0E161A] flex items-center justify-center text-center text-[11px] font-extrabold text-white whitespace-pre-line leading-tight px-1">
              {topCatLabel}
            </div>
          </div>

          <div className="space-y-1.5 min-w-0">
            {catRows.map((row) => (
              <button
                key={row.name}
                type="button"
                onClick={() => onOpenCategoryBreakdown(row.name)}
                className="w-full grid grid-cols-[78px_1fr_34px] items-center gap-1.5 text-xs hover:bg-white/5 px-1 py-0.5 rounded-lg cursor-pointer text-left"
              >
                <span className="truncate">{row.name}</span>
                <span className="h-2 rounded-full bg-white/10 overflow-hidden">
                  <span
                    className="block h-full rounded-full"
                    style={{ width: `${row.widthPct}%`, backgroundColor: row.color }}
                  />
                </span>
                <b className="text-right tabular-nums">{row.pct}%</b>
              </button>
            ))}
          </div>
        </div>

        <div className="fin-sub font-bold mt-2">Динамика по дням</div>
        <div className="grid grid-cols-14 gap-1 h-20 p-2 rounded-2xl bg-[var(--fld)] border border-[var(--line)] items-end">
          {dayBars.map((b) => (
            <button
              key={b.iso}
              type="button"
              onClick={() => onOpenDayBreakdown(b.iso)}
              title={`${b.lbl} число: ${formatMoney(b.val)}`}
              className="flex flex-col items-center gap-1 h-full justify-end cursor-pointer"
            >
              <div className="w-full max-w-[9px] flex-1 bg-white/8 rounded-full flex items-end overflow-hidden">
                <div
                  className="w-full rounded-full bg-gradient-to-b from-[#F47265] to-[#C63B2F]"
                  style={{ height: `${b.heightPct}%`, opacity: b.val > 0 ? 1 : 0.25 }}
                />
              </div>
              <span className="text-[9px] text-[var(--mute)] tabular-nums">{b.lbl}</span>
            </button>
          ))}
        </div>
      </GlassSection>

      {qrModalOpen && (
        <ModalShell title="📷 Сканер QR-кода и чеков" onClose={handleCloseQrModal}>
          <div className="space-y-3">
            <div className="relative rounded-2xl overflow-hidden bg-black/75 border border-white/15 aspect-[4/3] flex items-center justify-center">
              <video
                ref={qrVideoRef}
                playsInline
                muted
                autoPlay
                className="w-full h-full object-cover"
              />
              {qrLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/65 text-xs text-slate-200">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Запрашиваю доступ к камере…</span>
                </div>
              )}
              {!qrLoading && !qrError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="w-44 h-44 rounded-2xl border-2 border-emerald-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]" />
                </div>
              )}
            </div>

            {qrError ? (
              <div className="rounded-xl bg-rose-500/15 border border-rose-400/35 px-3 py-2 text-xs text-rose-200 space-y-2">
                <div>{qrError}</div>
                {hardwareDenied === 'camera' && isNativeAndroidHardware() && (
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
            ) : (
              <div className="fin-sub text-center">
                {qrLiveDetectSupported
                  ? 'Наведите рамку на QR-код кассового чека ФНС — сумма и дата подставятся автоматически.'
                  : 'Наведите камеру на чек и нажмите «Сделать фото чека».'}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={qrLoading || Boolean(qrError)}
                onClick={() => void handleCaptureLivePhoto()}
                className="fin-btn flex items-center justify-center gap-1.5 disabled:opacity-45"
              >
                <Camera className="w-4 h-4" />
                <span>Фото чека</span>
              </button>
              <button
                type="button"
                onClick={() => void handleTriggerFileCapture()}
                className="fin-btn ghost flex items-center justify-center gap-1.5"
              >
                <ImageIcon className="w-4 h-4" />
                <span>Галерея / камера</span>
              </button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}
