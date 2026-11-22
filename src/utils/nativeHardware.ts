import { Capacitor, registerPlugin } from '@capacitor/core';

interface DeviceHardwarePlugin {
  checkHardwarePermissions(): Promise<{ microphone?: string; camera?: string }>;
  requestMicrophonePermission(): Promise<{ granted?: boolean; state?: string }>;
  requestCameraPermission(): Promise<{ granted?: boolean; state?: string }>;
  recognizeSpeech(options?: {
    prompt?: string;
    language?: string;
  }): Promise<{
    text?: string;
    cancelled?: boolean;
    denied?: boolean;
    unavailable?: boolean;
    granted?: boolean;
  }>;
  openAppSettings(): Promise<{ opened?: boolean }>;
}

const DeviceHardwareBridge = registerPlugin<DeviceHardwarePlugin>('DeviceHardware');

export interface HardwarePermissionResult {
  granted: boolean;
  denied: boolean;
}

export interface NativeSpeechResult {
  supported: boolean;
  text?: string;
  cancelled?: boolean;
  denied?: boolean;
}

export interface ParsedFnsQrReceipt {
  amount?: number;
  dateIso?: string;
  time?: string;
  fn?: string;
  fd?: string;
  fp?: string;
  raw: string;
}

export function isNativeAndroidHardware(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

export async function checkHardwarePermissionStates(): Promise<{
  microphone: string;
  camera: string;
}> {
  if (!isNativeAndroidHardware()) {
    return { microphone: 'prompt', camera: 'prompt' };
  }
  try {
    const res = await DeviceHardwareBridge.checkHardwarePermissions();
    return {
      microphone: res?.microphone || 'prompt',
      camera: res?.camera || 'prompt',
    };
  } catch {
    return { microphone: 'prompt', camera: 'prompt' };
  }
}

/**
 * Triggers Android's native runtime RECORD_AUDIO permission dialog before WebView
 * attempts to use getUserMedia or SpeechRecognition.
 * On Web/PWA, safely resolves to { granted: true, denied: false } so the browser
 * handles its own permission prompt normally.
 */
export async function ensureMicrophonePermission(): Promise<HardwarePermissionResult> {
  if (!isNativeAndroidHardware()) {
    return { granted: true, denied: false };
  }
  try {
    const res = await DeviceHardwareBridge.requestMicrophonePermission();
    const granted = Boolean(res?.granted || res?.state === 'granted');
    return { granted, denied: !granted };
  } catch {
    // Fallback if native bridge is unavailable in an older build
    return { granted: true, denied: false };
  }
}

/**
 * Triggers Android's native runtime CAMERA permission dialog before opening the
 * QR scanner camera stream or capturing a receipt photo.
 */
export async function ensureCameraPermission(): Promise<HardwarePermissionResult> {
  if (!isNativeAndroidHardware()) {
    return { granted: true, denied: false };
  }
  try {
    const res = await DeviceHardwareBridge.requestCameraPermission();
    const granted = Boolean(res?.granted || res?.state === 'granted');
    return { granted, denied: !granted };
  } catch {
    return { granted: true, denied: false };
  }
}

/**
 * Launches Android's native Speech Recognizer intent (RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
 * after requesting RECORD_AUDIO permission. This avoids Android System WebView's frequent
 * webkitSpeechRecognition not-allowed / service-not-allowed issues.
 */
export async function recognizeSpeechOnAndroid(
  prompt = 'Говорите...'
): Promise<NativeSpeechResult> {
  if (!isNativeAndroidHardware()) {
    return { supported: false };
  }
  try {
    const res = await DeviceHardwareBridge.recognizeSpeech({
      prompt,
      language: 'ru-RU',
    });
    if (res?.denied) {
      return { supported: true, denied: true };
    }
    if (res?.unavailable) {
      return { supported: false };
    }
    if (res?.cancelled) {
      return { supported: true, cancelled: true };
    }
    return {
      supported: true,
      text: (res?.text || '').trim(),
    };
  } catch {
    return { supported: false };
  }
}

/**
 * Opens Android App Details / Permissions settings screen so the user can re-enable
 * Microphone or Camera if they previously selected "Don't ask again".
 */
export async function openAndroidAppSettings(): Promise<boolean> {
  if (!isNativeAndroidHardware()) return false;
  try {
    const res = await DeviceHardwareBridge.openAppSettings();
    return res?.opened !== false;
  } catch {
    return false;
  }
}

/**
 * Parses standard Russian FNS (ФНС) receipt QR payload:
 * Example: "t=20260418T1432&s=1245.50&fn=7281440500912345&i=12345&fp=987654321&n=1"
 */
export function parseFnsReceiptQr(rawQr: string): ParsedFnsQrReceipt | null {
  const trimmed = String(rawQr || '').trim();
  if (!trimmed) return null;

  let queryPart = trimmed;
  if (/^https?:\/\//i.test(trimmed)) {
    const qIdx = trimmed.indexOf('?');
    if (qIdx >= 0) {
      queryPart = trimmed.slice(qIdx + 1);
    }
  } else if (trimmed.startsWith('?')) {
    queryPart = trimmed.slice(1);
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(queryPart);
  } catch {
    return null;
  }

  const rawS = params.get('s');
  const rawT = params.get('t');
  const fn = params.get('fn') || undefined;
  const fd = params.get('i') || undefined;
  const fp = params.get('fp') || undefined;

  let amount: number | undefined;
  if (rawS) {
    const cleaned = rawS.replace(/\s+/g, '').replace(',', '.');
    if (/^\d+(?:\.\d{1,2})?$/.test(cleaned)) {
      const parsed = Number.parseFloat(cleaned);
      if (Number.isFinite(parsed) && parsed > 0) {
        amount = Math.round(parsed * 100) / 100;
      }
    }
  }

  let dateIso: string | undefined;
  let time: string | undefined;
  if (rawT) {
    const m = rawT.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:\d{2})?)?$/i);
    if (m) {
      const y = Number(m[1]);
      const mo = Number(m[2]);
      const d = Number(m[3]);
      if (y >= 2015 && y <= 2100 && mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
        const dt = new Date(y, mo - 1, d);
        if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) {
          dateIso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          if (m[4] && m[5]) {
            const hh = Number(m[4]);
            const mm = Number(m[5]);
            if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
              time = `${m[4]}:${m[5]}`;
            }
          }
        }
      }
    }
  }

  if (amount === undefined && dateIso === undefined) {
    return null;
  }

  return {
    amount,
    dateIso,
    time,
    fn,
    fd,
    fp,
    raw: trimmed,
  };
}
