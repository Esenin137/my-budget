import React, { useState } from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';

export const HiddenSectionsContext = React.createContext<string[]>([]);

interface GlassSectionProps {
  id: string;
  title: React.ReactNode;
  rightExtra?: React.ReactNode;
  helpText?: string;
  collapsed: boolean;
  onToggleCollapse: (id: string) => void;
  children: React.ReactNode;
  className?: string;
}

export default function GlassSection({
  id,
  title,
  rightExtra,
  helpText,
  collapsed,
  onToggleCollapse,
  children,
  className = '',
}: GlassSectionProps) {
  const hiddenSections = React.useContext(HiddenSectionsContext);
  const [showHelp, setShowHelp] = useState(false);

  if (hiddenSections.includes(id)) return null;

  return (
    <section className={`glass-sec ${collapsed ? 'collapsed' : ''} ${className}`}>
      <h2
        className="sec-head"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest('button,a,input,select')) return;
          onToggleCollapse(id);
        }}
      >
        <span className="flex items-center gap-2 min-w-0 truncate">{title}</span>
        <span className="flex items-center gap-1.5 shrink-0">
          {rightExtra}
          {helpText && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowHelp((v) => !v);
              }}
              aria-label="Подсказка по блоку"
              title="Зачем нужен этот блок и как им пользоваться"
              className={`w-7 h-7 rounded-lg flex items-center justify-center transition cursor-pointer ${
                showHelp
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/40'
                  : 'bg-white/[0.04] text-slate-400 hover:text-white border border-white/[0.08]'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
          )}
          <span className="sec-chev" title="Свернуть или развернуть окно">
            <ChevronDown className="w-4 h-4" />
          </span>
        </span>
      </h2>
      {showHelp && helpText && (
        <div className="rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-slate-300 mb-3">
          <div className="font-bold text-emerald-300 mb-0.5">Как пользоваться блоком</div>
          <div>{helpText}</div>
        </div>
      )}
      {!collapsed && <div className="space-y-3">{children}</div>}
    </section>
  );
}
