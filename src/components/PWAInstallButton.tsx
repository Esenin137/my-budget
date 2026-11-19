import React, { useState } from 'react';
import { CheckCircle2, Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'icon' | 'card';
  onInstalledToast?: (msg: string) => void;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  variant = 'icon',
  onInstalledToast,
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  const handleInstallClick = async () => {
    if (isInstallable) {
      const ok = await install();
      if (ok) {
        onInstalledToast?.('Приложение «Мои финансы» установлено на устройство!');
      }
      return;
    }
    setShowGuide(true);
  };

  // Compact header icon: only show when not yet installed AND installable/iOS
  if (variant === 'icon') {
    if (isInstalled || (!isInstallable && !isIOS)) {
      return null;
    }

    return (
      <>
        <button
          type="button"
          onClick={handleInstallClick}
          className="icon-action-btn"
          title="Установить приложение на телефон"
          aria-label="Установить приложение на телефон"
        >
          <Download className="w-4 h-4 text-emerald-400" />
        </button>

        {showGuide && <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuide(false)} />}
      </>
    );
  }

  // Card variant inside App Settings
  if (isInstalled) {
    return (
      <div className="rounded-2xl bg-emerald-500/10 border border-emerald-400/30 p-3 flex items-center gap-2.5">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <div className="text-xs">
          <div className="font-extrabold text-emerald-200">Приложение установлено на устройство</div>
          <div className="text-[11px] text-slate-300 mt-0.5">
            Работает в полноэкранном режиме и доступно офлайн.
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="rounded-2xl bg-[var(--fld)] border border-[var(--line)] p-3 flex items-center justify-between gap-2.5">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/30 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4 text-emerald-400" />
          </span>
          <div className="min-w-0">
            <div className="text-xs font-extrabold text-white">Установить на телефон (PWA)</div>
            <div className="text-[11px] text-[var(--mute)] leading-snug">
              Иконка на рабочем столе, полный экран и работа офлайн
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleInstallClick}
          className="fin-btn sm flex items-center gap-1.5 shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>{isInstallable ? 'Установить' : 'Как установить'}</span>
        </button>
      </div>

      {showGuide && <InstallGuideModal isIOS={isIOS} onClose={() => setShowGuide(false)} />}
    </>
  );
};

const InstallGuideModal: React.FC<{ isIOS: boolean; onClose: () => void }> = ({
  isIOS,
  onClose,
}) => (
  <div
    className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    onClick={onClose}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-[#10181C] border border-white/15 p-4 shadow-2xl space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-extrabold text-white">
          {isIOS ? 'Установка на iPhone / iPad' : 'Установка на Android'}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="w-7 h-7 rounded-lg bg-white/8 hover:bg-white/15 flex items-center justify-center text-slate-300 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isIOS ? (
        <ol className="text-xs text-slate-200 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Откройте приложение в браузере <b>Safari</b>.</li>
          <li>Нажмите кнопку <b>«Поделиться»</b> (квадрат со стрелкой вверх) на нижней панели.</li>
          <li>Выберите <b>«На экран «Домой»»</b> и нажмите <b>«Добавить»</b>.</li>
        </ol>
      ) : (
        <ol className="text-xs text-slate-200 space-y-1.5 list-decimal list-inside leading-relaxed">
          <li>Откройте опубликованную ссылку приложения в браузере <b>Chrome</b> на телефоне.</li>
          <li>Нажмите меню <b>⋮</b> в правом верхнем углу браузера.</li>
          <li>Выберите <b>«Установить приложение»</b> (или <b>«Добавить на главный экран»</b>).</li>
        </ol>
      )}

      <p className="text-[11px] text-[var(--mute)] leading-relaxed">
        После установки «Мои финансы» появится на рабочем столе как обычное приложение без адресной
        строки и будет запускаться даже без интернета.
      </p>

      <button type="button" onClick={onClose} className="fin-btn w-full sm">
        Понятно
      </button>
    </div>
  </div>
);

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[82] flex items-center gap-2 rounded-xl bg-amber-500/95 text-[#1B1200] px-3.5 py-2 text-xs font-extrabold shadow-xl max-w-[92vw]"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0" />
      <span>Офлайн-режим — данные сохраняются на устройстве</span>
    </div>
  );
};
