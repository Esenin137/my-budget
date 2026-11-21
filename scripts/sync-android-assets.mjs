/**
 * Synchronizes the «Мои финансы» Web PWA launcher icon, Adaptive Icon foreground/background,
 * monochrome notification status-bar icon (ic_stat_finance), and Android 13+ notification
 * permissions into the generated Capacitor Android project before Gradle compiles the APK.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');
const ANDROID_MANIFEST = path.join(ROOT, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');

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
  // Safe fallback: Android supports scaling high-res PNGs directly
  fs.copyFileSync(src, dst);
}

// 1. Generate legacy, round, and adaptive foreground launcher icons matching the Web PWA icon
for (const d of DENSITIES) {
  const dir = path.join(ANDROID_RES, d.name);
  fs.mkdirSync(dir, { recursive: true });

  resizePng(ICON_SRC, path.join(dir, 'ic_launcher.png'), d.legacyPx);
  resizePng(ICON_SRC, path.join(dir, 'ic_launcher_round.png'), d.legacyPx);
  resizePng(FOREGROUND_SRC, path.join(dir, 'ic_launcher_foreground.png'), d.fgPx);
}

// 2. Set Adaptive Icon background color to match the deep obsidian-emerald brand backdrop (#061912)
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

// Ensure mipmap-anydpi-v26 adaptive icon XMLs reference our foreground + background cleanly
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

// 3. Create clean monochrome Android notification status-bar icon (ic_stat_finance.xml)
// Depicts a crisp minimalist ruble + upward financial well-being arrow in pure white (Android tints via iconColor)
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

// 4. Ensure Android 13+ POST_NOTIFICATIONS & VIBRATE permissions exist in AndroidManifest.xml
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

console.log('[sync-android-assets] Launcher icons, adaptive icon, notification icon, and manifest synced successfully.');
