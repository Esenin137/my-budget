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
    badge: 'Для телефона',
    description: 'Оптимальная модель для смартфонов. Хорошо понимает русский язык и стабильно работает в мобильной памяти GPU.',
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 · 360M',
    sizeLabel: '~260 МБ',
    badge: 'Ультралёгкая',
    description: 'Минимальный расход памяти и быстрая загрузка. Подходит для телефонов с небольшим объёмом RAM.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 · 1.5B',
    sizeLabel: '~1.0 ГБ (~1.6 ГБ VRAM)',
    badge: 'Для ПК / флагманов',
    description: 'Более подробные ответы на русском, но требует много видеопамяти WebGPU. На части смартфонов браузер может выгружать её из-за лимита GPU.',
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
let loadedContextWindow = 1024;
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

function isMobileClient(): boolean {
  return typeof navigator !== 'undefined' && /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

function isGpuContextLostError(err: unknown): boolean {
  const raw = err instanceof Error ? err.message : String(err || '');
  return /mapasync|gpubuffer|instance reference|already been disposed|device.*lost|out of memory|oom|allocation failed|webgpu|vk_|context lost/i.test(
    raw
  );
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

export async function loadLocalModel(
  modelId: string,
  options?: { contextWindowSize?: number; forceReload?: boolean }
): Promise<boolean> {
  if (currentState.status === 'loading') return false;
  const targetCtx =
    options?.contextWindowSize ?? (isMobileClient() ? 1024 : 2048);

  if (
    !options?.forceReload &&
    engineInstance &&
    currentState.status === 'ready' &&
    currentState.modelId === modelId &&
    loadedContextWindow === targetCtx
  ) {
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
      try {
        await engineInstance.unload();
      } catch {
        // Already disposed GPU device — safe to ignore
      }
      engineInstance = null;
    }

    const webllm = await import('@mlc-ai/web-llm');
    const engine = await webllm.CreateMLCEngine(
      modelId,
      {
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
      },
      {
        // Reduced KV-cache window dramatically lowers WebGPU VRAM usage on smartphones
        context_window_size: targetCtx,
      }
    );

    engineInstance = engine;
    loadedContextWindow = targetCtx;
    emit({
      status: 'ready',
      modelId,
      progress: 100,
      statusText: 'Модель загружена и готова к работе офлайн',
      error: null,
    });
    return true;
  } catch (err: unknown) {
    engineInstance = null;
    const raw = err instanceof Error ? err.message : 'Не удалось загрузить локальную модель.';
    const friendly = isGpuContextLostError(err)
      ? 'Браузеру на телефоне не хватило видеопамяти WebGPU для этой модели. Переключитесь в Настройках на более лёгкую «Qwen 2.5 · 0.5B» (~390 МБ) или «Офлайн-Советник (0 МБ)».'
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

async function runCompletion(
  engine: MLCEngineInterface,
  question: string,
  financialSnapshot: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const mobile = isMobileClient();
  const systemPrompt =
    'Ты — персональный финансовый советник в приложении «Мои финансы» (Россия, рубли ₽). ' +
    'Отвечай на русском языке кратко, практично и понятно (3–5 предложений, без таблиц). ' +
    'Используй реальные цифры пользователя:\n' +
    financialSnapshot;

  const trimmedHistory = history.slice(mobile ? -2 : -4);
  const completion = await engine.chat.completions.create({
    messages: [
      { role: 'system', content: systemPrompt },
      ...trimmedHistory,
      { role: 'user', content: question },
    ],
    temperature: 0.4,
    max_tokens: mobile ? 240 : 320,
  });

  const reply = (completion.choices[0]?.message?.content || '').trim();
  if (!reply) {
    throw new Error('Локальная модель не вернула ответ. Попробуйте переформулировать вопрос.');
  }
  return reply;
}

export async function askLocalLlm(
  question: string,
  financialSnapshot: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const activeModelId = currentState.modelId;
  if (!engineInstance || currentState.status !== 'ready' || !activeModelId) {
    throw new Error('Локальная модель ещё не загружена. Нажмите «Загрузить модель» в настройках или в чате.');
  }

  try {
    return await runCompletion(engineInstance, question, financialSnapshot, history);
  } catch (err: unknown) {
    // Mobile Chrome WebGPU frequently drops GPUDevice on OOM or app backgrounding/voice modal.
    // Clean up the dead engine and try one automatic compact-VRAM recovery from local cache.
    if (isGpuContextLostError(err)) {
      engineInstance = null;
      emit({
        status: 'idle',
        modelId: null,
        progress: 0,
        statusText: 'Перезапуск WebGPU в экономном режиме...',
        error: null,
      });

      const recovered = await loadLocalModel(activeModelId, {
        contextWindowSize: 768,
        forceReload: true,
      });

      if (recovered && engineInstance) {
        try {
          return await runCompletion(engineInstance, question, financialSnapshot, []);
        } catch (retryErr: unknown) {
          engineInstance = null;
          if (!isGpuContextLostError(retryErr)) {
            throw retryErr;
          }
        }
      }

      const isBigModel = activeModelId.includes('1.5B');
      const friendlyErr = isBigModel
        ? 'На телефоне не хватило видеопамяти (WebGPU) для большой модели Qwen 2.5 · 1.5B (~1.6 ГБ VRAM) — браузер сбросил GPU. Откройте Настройки → ИИ и выберите «Qwen 2.5 · 0.5B» (~390 МБ) — она стабильно работает на смартфонах.'
        : 'Браузер сбросил видеопамять WebGPU (обычно при сворачивании вкладки или нехватке памяти). Нажмите «Загрузить модель» снова или переключитесь на «Офлайн-Советник (0 МБ)».';

      emit({
        status: 'error',
        modelId: null,
        progress: 0,
        statusText: 'Недостаточно памяти WebGPU',
        error: friendlyErr,
      });
      throw new Error(friendlyErr);
    }

    throw err;
  }
}
