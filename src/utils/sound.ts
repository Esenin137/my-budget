import type { AlertSoundPreset } from '../types';

export interface AlertSoundOption {
  id: AlertSoundPreset;
  label: string;
  hint: string;
  androidRawFile?: string;
}

export const ALERT_SOUND_OPTIONS: AlertSoundOption[] = [
  {
    id: 'soft',
    label: 'Мягкий звон',
    hint: 'По умолчанию · спокойный перезвон',
    androidRawFile: 'sound_soft.wav',
  },
  {
    id: 'coin',
    label: 'Звон монет',
    hint: 'Для купонов, дивидендов и доходов',
    androidRawFile: 'sound_coin.wav',
  },
  {
    id: 'chord',
    label: 'Деловой аккорд',
    hint: 'Для календаря и задач',
    androidRawFile: 'sound_chord.wav',
  },
  {
    id: 'pulse',
    label: 'Короткий импульс',
    hint: 'Лаконичный двойной сигнал',
    androidRawFile: 'sound_pulse.wav',
  },
  {
    id: 'system',
    label: 'Системный звук телефона',
    hint: 'Стандартная мелодия уведомлений Android',
  },
];

interface ToneNote {
  freq: number;
  start: number;
  dur: number;
  vol: number;
  type: OscillatorType;
  overtoneFreq?: number;
  overtoneVol?: number;
}

function getNotesForPreset(preset: AlertSoundPreset): ToneNote[] {
  switch (preset) {
    case 'coin':
      // Crisp bright double coin clink (B5 -> E6 -> B6 with shimmering upper harmonic)
      return [
        { freq: 987.77, start: 0.0, dur: 0.24, vol: 0.14, type: 'triangle', overtoneFreq: 2637.02, overtoneVol: 0.05 },
        { freq: 1318.51, start: 0.08, dur: 0.36, vol: 0.16, type: 'triangle', overtoneFreq: 3135.96, overtoneVol: 0.06 },
        { freq: 1975.53, start: 0.17, dur: 0.48, vol: 0.13, type: 'sine', overtoneFreq: 3951.07, overtoneVol: 0.035 },
      ];
    case 'chord':
      // Clean business C-major triad + C6 resolution
      return [
        { freq: 523.25, start: 0.0, dur: 0.45, vol: 0.11, type: 'sine' },
        { freq: 659.25, start: 0.035, dur: 0.45, vol: 0.11, type: 'sine' },
        { freq: 783.99, start: 0.07, dur: 0.46, vol: 0.11, type: 'triangle' },
        { freq: 1046.5, start: 0.18, dur: 0.56, vol: 0.13, type: 'sine' },
      ];
    case 'pulse':
      // Short modern dual pulse (A5 -> C#6)
      return [
        { freq: 880.0, start: 0.0, dur: 0.14, vol: 0.15, type: 'sine' },
        { freq: 1108.73, start: 0.15, dur: 0.22, vol: 0.16, type: 'sine' },
      ];
    case 'system':
      // Neutral brief notification ping preview in browser
      return [
        { freq: 783.99, start: 0.0, dur: 0.2, vol: 0.13, type: 'sine' },
        { freq: 1046.5, start: 0.11, dur: 0.32, vol: 0.14, type: 'sine' },
      ];
    case 'soft':
    default:
      // Gentle warm bell chime (D5 -> A5 -> D6)
      return [
        { freq: 587.33, start: 0.0, dur: 0.46, vol: 0.14, type: 'sine' },
        { freq: 880.0, start: 0.11, dur: 0.5, vol: 0.14, type: 'sine' },
        { freq: 1174.66, start: 0.22, dur: 0.58, vol: 0.12, type: 'sine' },
      ];
  }
}

export function playReminderChime(
  presetOrVariant: AlertSoundPreset | 'default' | 'test' | 'urgent' = 'soft'
): boolean {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;

    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const preset: AlertSoundPreset =
      presetOrVariant === 'coin' ||
      presetOrVariant === 'chord' ||
      presetOrVariant === 'pulse' ||
      presetOrVariant === 'system' ||
      presetOrVariant === 'soft'
        ? presetOrVariant
        : presetOrVariant === 'urgent'
        ? 'chord'
        : 'soft';

    const now = ctx.currentTime;
    const notes = getNotesForPreset(preset);

    notes.forEach((n) => {
      const startAt = now + n.start;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = n.type;
      osc.frequency.setValueAtTime(n.freq, startAt);

      gain.gain.setValueAtTime(0.0008, startAt);
      gain.gain.exponentialRampToValueAtTime(n.vol, startAt + 0.016);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + n.dur + 0.04);

      if (n.overtoneFreq && n.overtoneVol) {
        const ov = ctx.createOscillator();
        const ovGain = ctx.createGain();
        ov.type = 'sine';
        ov.frequency.setValueAtTime(n.overtoneFreq, startAt);

        ovGain.gain.setValueAtTime(0.0005, startAt);
        ovGain.gain.exponentialRampToValueAtTime(n.overtoneVol, startAt + 0.01);
        ovGain.gain.exponentialRampToValueAtTime(0.0001, startAt + n.dur * 0.72);

        ov.connect(ovGain);
        ovGain.connect(ctx.destination);
        ov.start(startAt);
        ov.stop(startAt + n.dur * 0.75 + 0.02);
      }
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1400);
    return true;
  } catch {
    return false;
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = typeof reader.result === 'string' ? reader.result : '';
      const comma = res.indexOf(',');
      resolve(comma >= 0 ? res.slice(comma + 1) : res);
    };
    reader.onerror = () => reject(reader.error || new Error('Ошибка чтения аудио'));
    reader.readAsDataURL(blob);
  });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds || 0));
  const mins = Math.floor(s / 60);
  const rem = s % 60;
  return `${mins}:${String(rem).padStart(2, '0')}`;
}
