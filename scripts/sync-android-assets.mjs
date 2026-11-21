/**
 * Synchronizes the «Мои финансы» Android APK assets before Gradle compiles the APK:
 * 1. Matching Web PWA launcher & Adaptive Icons (mipmap-*)
 * 2. Monochrome status-bar notification icon (drawable/ic_stat_finance.xml)
 * 3. Custom synthesized 16-bit PCM .wav melodies in res/raw/ for Capacitor Notification Channels:
 *    sound_soft.wav, sound_coin.wav, sound_chord.wav, sound_pulse.wav
 * 4. Native Capacitor plugin NotificationSettingsPlugin.java (registered in MainActivity.java)
 *    to open Android's native Notification Channel / App Sound Settings screen
 * 5. Android 13+ POST_NOTIFICATIONS & VIBRATE permissions in AndroidManifest.xml
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const ANDROID_MAIN = path.join(ROOT, 'android', 'app', 'src', 'main');
const ANDROID_RES = path.join(ANDROID_MAIN, 'res');
const ANDROID_MANIFEST = path.join(ANDROID_MAIN, 'AndroidManifest.xml');
const ANDROID_JAVA_PKG = path.join(ANDROID_MAIN, 'java', 'ru', 'mybudget', 'app');

const ICON_SRC = path.join(ROOT, 'public', 'pwa-512x512.png');
const MASKABLE_SRC = path.join(ROOT, 'public', 'pwa-maskable-512x512.png');

if (!fs.existsSync(ANDROID_RES)) {
  console.error('[sync-android-assets] android/ directory not found. Run `npx cap add android` first.');
  process.exit(1);
}

if (!fs.existsSync(ICON_SRC)) {
  console.error('[sync-android-assets] Missing source icon:', ICON_SRC);
  process.exit(1);
}

const FOREGROUND_SRC = fs.existsSync(MASKABLE_SRC) ? MASKABLE_SRC : ICON_SRC;

// Standard Android launcher & adaptive foreground sizes per density bucket
const DENSITIES = [
  { name: 'mipmap-mdpi', legacyPx: 48, fgPx: 108 },
  { name: 'mipmap-hdpi', legacyPx: 72, fgPx: 162 },
  { name: 'mipmap-xhdpi', legacyPx: 96, fgPx: 216 },
  { name: 'mipmap-xxhdpi', legacyPx: 144, fgPx: 324 },
  { name: 'mipmap-xxxhdpi', legacyPx: 192, fgPx: 432 },
];

function detectResizer() {
  for (const bin of ['magick', 'convert']) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      return bin;
    } catch {
      // try next
    }
  }
  try {
    execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
    return 'python3';
  } catch {
    return 'copy';
  }
}

const RESIZER = detectResizer();
console.log(`[sync-android-assets] Image resizer: ${RESIZER}`);

function resizePng(src, dst, sizePx) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  if (RESIZER === 'magick' || RESIZER === 'convert') {
    execFileSync(RESIZER, [
      src,
      '-resize',
      `${sizePx}x${sizePx}!`,
      '-strip',
      dst,
    ]);
    return;
  }
  if (RESIZER === 'python3') {
    execFileSync('python3', [
      '-c',
      `from PIL import Image; Image.open(${JSON.stringify(src)}).convert("RGBA").resize((${sizePx}, ${sizePx}), Image.LANCZOS).save(${JSON.stringify(dst)}, "PNG")`,
    ]);
    return;
  }
  fs.copyFileSync(src, dst);
}

// =========================================================================
// 1. LAUNCHER & ADAPTIVE ICONS
// =========================================================================
for (const d of DENSITIES) {
  const dir = path.join(ANDROID_RES, d.name);
  fs.mkdirSync(dir, { recursive: true });

  resizePng(ICON_SRC, path.join(dir, 'ic_launcher.png'), d.legacyPx);
  resizePng(ICON_SRC, path.join(dir, 'ic_launcher_round.png'), d.legacyPx);
  resizePng(FOREGROUND_SRC, path.join(dir, 'ic_launcher_foreground.png'), d.fgPx);
}

const valuesDir = path.join(ANDROID_RES, 'values');
fs.mkdirSync(valuesDir, { recursive: true });
fs.writeFileSync(
  path.join(valuesDir, 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#061912</color>
</resources>
`,
  'utf8'
);

const anyDpiDir = path.join(ANDROID_RES, 'mipmap-anydpi-v26');
fs.mkdirSync(anyDpiDir, { recursive: true });
const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
`;
fs.writeFileSync(path.join(anyDpiDir, 'ic_launcher.xml'), adaptiveXml, 'utf8');
fs.writeFileSync(path.join(anyDpiDir, 'ic_launcher_round.xml'), adaptiveXml, 'utf8');

// =========================================================================
// 2. MONOCHROME NOTIFICATION STATUS-BAR ICON (ic_stat_finance.xml)
// =========================================================================
const drawableDir = path.join(ANDROID_RES, 'drawable');
fs.mkdirSync(drawableDir, { recursive: true });
fs.writeFileSync(
  path.join(drawableDir, 'ic_stat_finance.xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
    <!-- Minimalist Ruble emblem -->
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M6,4h6.2c2.65,0 4.8,1.95 4.8,4.5c0,2.55 -2.15,4.5 -4.8,4.5H8.5v2H13v2H8.5V20H6v-3H4.5v-2H6v-2H4.5v-2H6V4zM8.5,6.2v4.6h3.6c1.45,0 2.4,-1 2.4,-2.3c0,-1.3 -0.95,-2.3 -2.4,-2.3H8.5z"/>
    <!-- Rising financial well-being arrow -->
    <path
        android:fillColor="#FFFFFFFF"
        android:pathData="M14.5,18.2l3.8,-3.8l1.2,1.2L21,11h-4.6l1.15,1.15l-3.05,3.05l-1.5,1.5z"/>
</vector>
`,
  'utf8'
);

// =========================================================================
// 3. SYNTHESIZED 16-BIT PCM .WAV MELODIES IN res/raw/
// =========================================================================
const SAMPLE_RATE = 22050;

function sampleWave(type, phase) {
  const norm = phase % (2 * Math.PI);
  if (type === 'triangle') {
    const t = norm / (2 * Math.PI);
    return 4 * Math.abs(t - 0.5) - 1;
  }
  return Math.sin(norm);
}

function synthesizeWavBuffer(notes, totalDurationSec) {
  const numSamples = Math.max(1, Math.floor(totalDurationSec * SAMPLE_RATE));
  const mix = new Float32Array(numSamples);

  for (const n of notes) {
    const startIdx = Math.floor(n.start * SAMPLE_RATE);
    const durSamples = Math.floor(n.dur * SAMPLE_RATE);
    const attackSamples = Math.max(1, Math.floor(0.014 * SAMPLE_RATE));

    for (let i = 0; i < durSamples; i++) {
      const idx = startIdx + i;
      if (idx >= numSamples) break;
      const tLocal = i / SAMPLE_RATE;
      const attackEnv = i < attackSamples ? i / attackSamples : 1.0;
      const decayEnv = Math.exp(-5.5 * (i / Math.max(1, durSamples)));
      const env = attackEnv * decayEnv;

      let s = sampleWave(n.type || 'sine', 2 * Math.PI * n.freq * tLocal) * n.vol * env;
      if (n.overtoneFreq && n.overtoneVol) {
        const ovDecay = Math.exp(-7.5 * (i / Math.max(1, durSamples)));
        s += Math.sin(2 * Math.PI * n.overtoneFreq * tLocal) * n.overtoneVol * attackEnv * ovDecay;
      }
      mix[idx] += s;
    }
  }

  // Soft-clip & normalize gently to prevent any digital clipping on phone speakers
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const a = Math.abs(mix[i]);
    if (a > peak) peak = a;
  }
  const scale = peak > 0.85 ? 0.85 / peak : 1.0;

  const dataByteLen = numSamples * 2;
  const buf = Buffer.alloc(44 + dataByteLen);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataByteLen, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(SAMPLE_RATE, 24);
  buf.writeUInt32LE(SAMPLE_RATE * 2, 28); // Byte rate
  buf.writeUInt16LE(2, 32); // Block align
  buf.writeUInt16LE(16, 34); // Bits per sample
  buf.write('data', 36);
  buf.writeUInt32LE(dataByteLen, 40);

  for (let i = 0; i < numSamples; i++) {
    const clamped = Math.max(-1, Math.min(1, mix[i] * scale));
    buf.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }
  return buf;
}

const rawDir = path.join(ANDROID_RES, 'raw');
fs.mkdirSync(rawDir, { recursive: true });

const WAV_PRESETS = [
  {
    file: 'sound_soft.wav',
    duration: 0.9,
    notes: [
      { freq: 587.33, start: 0.0, dur: 0.48, vol: 0.42, type: 'sine' },
      { freq: 880.0, start: 0.11, dur: 0.52, vol: 0.42, type: 'sine' },
      { freq: 1174.66, start: 0.22, dur: 0.62, vol: 0.36, type: 'sine' },
    ],
  },
  {
    file: 'sound_coin.wav',
    duration: 0.78,
    notes: [
      { freq: 987.77, start: 0.0, dur: 0.25, vol: 0.4, type: 'triangle', overtoneFreq: 2637.02, overtoneVol: 0.16 },
      { freq: 1318.51, start: 0.08, dur: 0.38, vol: 0.46, type: 'triangle', overtoneFreq: 3135.96, overtoneVol: 0.18 },
      { freq: 1975.53, start: 0.17, dur: 0.52, vol: 0.38, type: 'sine', overtoneFreq: 3951.07, overtoneVol: 0.12 },
    ],
  },
  {
    file: 'sound_chord.wav',
    duration: 0.85,
    notes: [
      { freq: 523.25, start: 0.0, dur: 0.46, vol: 0.32, type: 'sine' },
      { freq: 659.25, start: 0.035, dur: 0.46, vol: 0.32, type: 'sine' },
      { freq: 783.99, start: 0.07, dur: 0.48, vol: 0.32, type: 'triangle' },
      { freq: 1046.5, start: 0.18, dur: 0.58, vol: 0.38, type: 'sine' },
    ],
  },
  {
    file: 'sound_pulse.wav',
    duration: 0.46,
    notes: [
      { freq: 880.0, start: 0.0, dur: 0.14, vol: 0.48, type: 'sine' },
      { freq: 1108.73, start: 0.15, dur: 0.24, vol: 0.5, type: 'sine' },
    ],
  },
];

for (const preset of WAV_PRESETS) {
  const wav = synthesizeWavBuffer(preset.notes, preset.duration);
  fs.writeFileSync(path.join(rawDir, preset.file), wav);
}
console.log(
  `[sync-android-assets] Generated ${WAV_PRESETS.length} .wav notification sounds in res/raw/`
);

// =========================================================================
// 4. NATIVE ANDROID NOTIFICATION SETTINGS BRIDGE (NotificationSettingsPlugin)
// =========================================================================
fs.mkdirSync(ANDROID_JAVA_PKG, { recursive: true });

fs.writeFileSync(
  path.join(ANDROID_JAVA_PKG, 'NotificationSettingsPlugin.java'),
  `package ru.mybudget.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NotificationSettings")
public class NotificationSettingsPlugin extends Plugin {

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        String channelId = call.getString("channelId", "");
        String pkg = getContext().getPackageName();
        boolean opened = false;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (channelId != null && !channelId.isEmpty()) {
                try {
                    Intent intent = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                    intent.putExtra(Settings.EXTRA_CHANNEL_ID, channelId);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    opened = true;
                } catch (Exception ignored) {
                    // Fallback to app notification settings below
                }
            }
            if (!opened) {
                try {
                    Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, pkg);
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(intent);
                    opened = true;
                } catch (Exception ignored) {
                    // Fallback to application details below
                }
            }
        }

        if (!opened) {
            try {
                Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                intent.setData(Uri.parse("package:" + pkg));
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                opened = true;
            } catch (Exception ignored) {
                opened = false;
            }
        }

        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }
}
`,
  'utf8'
);

// Register NotificationSettingsPlugin in MainActivity.java cleanly
fs.writeFileSync(
  path.join(ANDROID_JAVA_PKG, 'MainActivity.java'),
  `package ru.mybudget.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NotificationSettingsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
`,
  'utf8'
);
console.log('[sync-android-assets] Installed NotificationSettingsPlugin & updated MainActivity.java');

// =========================================================================
// 5. ANDROID 13+ POST_NOTIFICATIONS & VIBRATE PERMISSIONS
// =========================================================================
if (fs.existsSync(ANDROID_MANIFEST)) {
  let manifest = fs.readFileSync(ANDROID_MANIFEST, 'utf8');
  const neededPermissions = [
    'android.permission.POST_NOTIFICATIONS',
    'android.permission.VIBRATE',
  ];
  let updated = false;
  for (const perm of neededPermissions) {
    if (!manifest.includes(perm)) {
      manifest = manifest.replace(
        '<application',
        `    <uses-permission android:name="${perm}" />\n\n    <application`
      );
      updated = true;
    }
  }
  if (updated) {
    fs.writeFileSync(ANDROID_MANIFEST, manifest, 'utf8');
    console.log('[sync-android-assets] Added notification permissions to AndroidManifest.xml');
  }
}

console.log('[sync-android-assets] All Android icons, .wav sounds, plugin, and manifest synced successfully.');
