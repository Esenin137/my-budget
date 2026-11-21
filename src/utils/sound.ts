export function playReminderChime(variant: 'default' | 'test' | 'urgent' = 'default'): boolean {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return false;
    const ctx = new AudioCtx();
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const now = ctx.currentTime;

    const notes =
      variant === 'urgent'
        ? [659.25, 880, 1318.51] // E5 -> A5 -> E6 crisp alert triad
        : variant === 'test'
        ? [523.25, 659.25, 783.99, 1046.5] // C5 -> E5 -> G5 -> C6 pleasant preview chime
        : [587.33, 880, 1174.66]; // D5 -> A5 -> D6 soft bell chord

    const stepSec = variant === 'test' ? 0.095 : 0.11;
    notes.forEach((freq, idx) => {
      const startAt = now + idx * stepSec;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, startAt);

      gain.gain.setValueAtTime(0.001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.15, startAt + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.52);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startAt);
      osc.stop(startAt + 0.56);
    });

    window.setTimeout(() => {
      ctx.close().catch(() => {});
    }, 1300);
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
