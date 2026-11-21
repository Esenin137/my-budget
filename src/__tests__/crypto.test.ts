import { describe, expect, it } from 'vitest';
import { decryptPayload, encryptPayload, isEncryptedPackage } from '../utils/storage';

describe('Локальное шифрование резервной копии (AES-GCM-256 + PBKDF2-SHA256)', () => {
  const sampleBackup = {
    version: 1,
    budget: 150_000,
    tx: [
      { id: 1, t: 'in', a: 120_000, c: 'Зарплата', m: 'Карта', d: '2026-04-05', n: 'Аванс и оклад' },
      { id: 2, t: 'out', a: 3_450, c: 'Здоровье', m: 'Карта', d: '2026-04-12', n: 'Аптека' },
    ],
    investments: {
      broker: 'sber',
      freeCash: 12_500,
      monthlyPlan: 10_000,
      assets: [{ id: 10, kind: 'coupon', ticker: 'SU26243RMFS4', name: 'ОФЗ 26243', qty: 5, price: 745 }],
    },
  };

  it('шифрует и расшифровывает резервную копию без потери кириллицы и числовых данных', async () => {
    const pkg = await encryptPayload(sampleBackup, '7391');

    expect(isEncryptedPackage(pkg)).toBe(true);
    expect(pkg.enc).toBe(true);
    expect(pkg.alg).toBe('AES-GCM-256');
    expect(pkg.kdf).toBe('PBKDF2-SHA256-120000');
    expect(pkg.salt.length).toBeGreaterThan(10);
    expect(pkg.iv.length).toBeGreaterThan(10);
    expect(pkg.ct.length).toBeGreaterThan(20);
    // Убеждаемся, что исходный текст не хранится в открытом виде
    expect(pkg.ct).not.toContain('Зарплата');

    const restored = await decryptPayload<typeof sampleBackup>(pkg, '7391');
    expect(restored).toEqual(sampleBackup);
  });

  it('генерирует уникальные salt и iv при каждом шифровании одинаковых данных', async () => {
    const pkg1 = await encryptPayload(sampleBackup, 'MySecretPass#2026');
    const pkg2 = await encryptPayload(sampleBackup, 'MySecretPass#2026');

    expect(pkg1.salt).not.toBe(pkg2.salt);
    expect(pkg1.iv).not.toBe(pkg2.iv);
    expect(pkg1.ct).not.toBe(pkg2.ct);
  });

  it('отклоняет расшифровку при неверном пароле / ПИН-коде', async () => {
    const pkg = await encryptPayload(sampleBackup, '4821');

    await expect(decryptPayload(pkg, '0000')).rejects.toThrow();
    await expect(decryptPayload(pkg, '4822')).rejects.toThrow();
    await expect(decryptPayload(pkg, '')).rejects.toThrow();
  });

  it('обнаруживает подмену шифротекста (проверка тега целостности AES-GCM)', async () => {
    const pkg = await encryptPayload(sampleBackup, '9912');
    const tamperedBytes = Uint8Array.from(atob(pkg.ct), (ch) => ch.charCodeAt(0));
    tamperedBytes[0] ^= 0xff;
    let bin = '';
    for (let i = 0; i < tamperedBytes.length; i++) bin += String.fromCharCode(tamperedBytes[i]);
    const tamperedPkg = { ...pkg, ct: btoa(bin) };

    await expect(decryptPayload(tamperedPkg, '9912')).rejects.toThrow();
  });
});
