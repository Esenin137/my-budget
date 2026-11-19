import type { MLCEngineInterface } from '@mlc-ai/web-llm';

export interface LocalModelOption {
  id: string;
  name: string;
  sizeLabel: string;
  badge: string;
  description: string;
}

export const LOCAL_LLM_MODELS: LocalModelOption[] = [
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 · 0.5B',
    sizeLabel: '~390 МБ',
    badge: 'Рекомендуется',
    description: 'Компактная модель для смартфонов. Хорошо понимает русский язык и бытовые финансовые вопросы.',
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 · 360M',
    sizeLabel: '~260 МБ',
    badge: 'Ультралёгкая',
    description: 'Минимальный вес и быстрая загрузка. Подходит для телефонов с небольшим объёмом памяти.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 · 1.5B',
    sizeLabel: '~950 МБ',
    badge: 'Умнее',
    description: 'Более глубокие и подробные ответы на русском. Рекомендуется для мощных смартфонов (8+ ГБ RAM) и ПК.',
  },
];

export interface LocalLlmState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  modelId: string | null;
  progress: number; // 0..100
  statusText: string;
  error: string | null;
}

type Listener = (state: LocalLlmState) => void;

let engineInstance: MLCEngineInterface | null = null;
let currentState: LocalLlmState = {
  status: 'idle',
  modelId: null,
  progress: 0,
  statusText: 'Модель не загружена',
  error: null,
};

const listeners = new Set<Listener>();

function emit(patch: Partial<LocalLlmState>) {
  currentState = { ...currentState, ...patch };
  listeners.forEach((fn) => fn(currentState));
}

export function isWebGpuSupported(): boolean {
  return typeof navigator !== 'undefined' && 'gpu' in navigator;
}

export function getLocalLlmState(): LocalLlmState {
  return currentState;
}

export function subscribeLocalLlm(listener: Listener): () => void {
  listeners.add(listener);
  listener(currentState);
  return () => {
    listeners.delete(listener);
  };
}

export async function loadLocalModel(modelId: string): Promise<boolean> {
  if (currentState.status === 'loading') return false;
  if (engineInstance && currentState.status === 'ready' && currentState.modelId === modelId) {
    return true;
  }

  if (!isWebGpuSupported()) {
    emit({
      status: 'error',
      modelId: null,
      progress: 0,
      statusText: 'WebGPU недоступен',
      error:
        'Ваш браузер пока не поддерживает WebGPU (нужен Chrome на Android, современный Safari с включённым WebGPU или браузер на ПК). Вы можете использовать «Офлайн-Советник (0 МБ)» — он работает на любом телефоне без интернета.',
    });
    return false;
  }

  emit({
    status: 'loading',
    modelId,
    progress: 2,
    statusText: 'Подготовка движка WebLLM...',
    error: null,
  });

  try {
    if (engineInstance) {
      await engineInstance.unload();
      engineInstance = null;
    }

    const webllm = await import('@mlc-ai/web-llm');
    const engine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        const pct = Math.max(2, Math.min(100, Math.round((report.progress || 0) * 100)));
        emit({
          status: 'loading',
          modelId,
          progress: pct,
          statusText: report.text || `Загрузка модели: ${pct}%`,
          error: null,
        });
      },
    });

    engineInstance = engine;
    emit({
      status: 'ready',
      modelId,
      progress: 100,
      statusText: 'Модель загружена и готова к работе офлайн',
      error: null,
    });
    return true;
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : 'Не удалось загрузить локальную модель.';
    const friendly = raw.toLowerCase().includes('webgpu')
      ? 'Браузер не смог инициализировать WebGPU на этом устройстве. Попробуйте Chrome/Edge с аппаратным ускорением или выберите «Офлайн-Советник (0 МБ)».'
      : raw;
    emit({
      status: 'error',
      modelId: null,
      progress: 0,
      statusText: 'Ошибка загрузки модели',
      error: friendly,
    });
    return false;
  }
}

export async function unloadLocalModel(): Promise<void> {
  if (engineInstance) {
    try {
      await engineInstance.unload();
    } catch {
      // ignore
    }
    engineInstance = null;
  }
  emit({
    status: 'idle',
    modelId: null,
    progress: 0,
    statusText: 'Модель выгружена из памяти',
    error: null,
  });
}

export async function deleteLocalModelCache(modelId: string): Promise<void> {
  if (currentState.modelId === modelId && engineInstance) {
    await unloadLocalModel();
  }
  try {
    const webllm = await import('@mlc-ai/web-llm');
    await webllm.deleteModelAllInfoInCache(modelId);
  } catch {
    // Fallback: best-effort cleanup of webllm caches
    if (typeof caches !== 'undefined') {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.toLowerCase().includes('webllm') || n.toLowerCase().includes('mlc'))
          .map((n) => caches.delete(n))
      );
    }
  }
  emit({
    status: 'idle',
    modelId: null,
    progress: 0,
    statusText: 'Кэш локальной модели очищен',
    error: null,
  });
}

export async function askLocalLlm(
  question: string,
  financialSnapshot: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  if (!engineInstance || currentState.status !== 'ready') {
    throw new Error('Локальная модель ещё не загружена. Нажмите «Загрузить модель» в настройках или в чате.');
  }

  const systemPrompt =
    'Ты — персональный финансовый советник в приложении «Мои финансы» (Россия, рубли ₽). ' +
    'Отвечай на русском языке кратко, практично и понятно (3–6 предложений, без сложных таблиц). ' +
    'Используй реальные цифры пользователя:\n' +
    financialSnapshot;

  const trimmedHistory = history.slice(-4);
  const completion = await engineInstance.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: question },
    ],
    temperature: 0.4,
    max_tokens: 320,
  });

  const reply = (completion.choices[0]?.message?.content || '').trim();
  if (!reply) {
    throw new Error('Локальная модель не вернула ответ. Попробуйте переформулировать вопрос.');
  }
  return reply;
}
