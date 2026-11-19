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
    description: 'Быстрая компактная модель для смартфонов. Хорошо понимает русский язык и бытовые финансовые вопросы.',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    name: 'Qwen 2.5 · 0.5B (Adreno / f32)',
    sizeLabel: '~450 МБ',
    badge: 'Для Snapdragon',
    description: 'Версия без f16-шейдеров — максимально стабильна на Qualcomm Snapdragon / Adreno (OnePlus, Samsung, Xiaomi), если f16 сбрасывает GPU.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 · 1.5B',
    sizeLabel: '~1.0 ГБ',
    badge: 'Умнее',
    description: 'Более подробные ответы на русском. Работает в отдельном потоке (Web Worker) с экономным буфером памяти.',
  },
  {
    id: 'Qwen2.5-1.5B-Instruct-q4f32_1-MLC',
    name: 'Qwen 2.5 · 1.5B (Adreno / f32)',
    sizeLabel: '~1.1 ГБ',
    badge: 'Snapdragon 1.5B',
    description: 'Умная модель 1.5B без проблемных f16-шейдеров — специально для мощных смартфонов на Snapdragon 888 / 8 Gen с 8–12+ ГБ RAM.',
  },
  {
    id: 'SmolLM2-360M-Instruct-q4f16_1-MLC',
    name: 'SmolLM2 · 360M',
    sizeLabel: '~260 МБ',
    badge: 'Ультралёгкая',
    description: 'Минимальный расход памяти и быстрая загрузка. Подходит для телефонов с небольшим объёмом RAM.',
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
let workerInstance: Worker | null = null;
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

async function disposeEngineAndWorker(): Promise<void> {
  if (engineInstance) {
    try {
      await engineInstance.unload();
    } catch {
      // Already disposed GPU device — safe to ignore
    }
    engineInstance = null;
  }
  if (workerInstance) {
    try {
      workerInstance.terminate();
    } catch {
      // ignore
    }
    workerInstance = null;
  }
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
    await disposeEngineAndWorker();

    // Preflight WebGPU adapter check (detects disabled GPU process or missing shader-f16 on Adreno)
    let effectiveModelId = modelId;
    try {
      const gpuNav = (navigator as unknown as {
        gpu?: { requestAdapter: () => Promise<{ features?: Set<string> } | null> };
      }).gpu;
      const adapter = gpuNav ? await gpuNav.requestAdapter() : null;
      if (!adapter) {
        emit({
          status: 'error',
          modelId: null,
          progress: 0,
          statusText: 'WebGPU временно недоступен',
          error:
            'Браузер не выдал доступ к WebGPU (после прошлых сбоев Android Chrome может временно отключить GPU до перезапуска). Полностью закройте браузер из недавних приложений, откройте снова и выберите модель «(Adreno / f32)».',
        });
        return false;
      }
      const hasF16 = Boolean(adapter.features && adapter.features.has('shader-f16'));
      if (!hasF16 && effectiveModelId.includes('q4f16_1')) {
        effectiveModelId = effectiveModelId.replace('q4f16_1', 'q4f32_1');
      }
    } catch {
      // Proceed and let WebLLM report specific error
    }

    const webllm = await import('@mlc-ai/web-llm');
    const engineConfig = {
      initProgressCallback: (report: { progress?: number; text?: string }) => {
        const pct = Math.max(2, Math.min(100, Math.round((report.progress || 0) * 100)));
        emit({
          status: 'loading',
          modelId: effectiveModelId,
          progress: pct,
          statusText: report.text || `Загрузка модели: ${pct}%`,
          error: null,
        });
      },
    };
    const chatOpts = {
      // Reduced KV-cache window dramatically lowers WebGPU VRAM usage on smartphones
      context_window_size: targetCtx,
    };

    let engine: MLCEngineInterface;
    if (typeof Worker !== 'undefined') {
      try {
        const worker = new Worker(new URL('./llmWorker.ts', import.meta.url), {
          type: 'module',
        });
        workerInstance = worker;
        engine = await webllm.CreateWebWorkerMLCEngine(worker, effectiveModelId, engineConfig, chatOpts);
      } catch {
        // Fallback to main thread if module Worker cannot start in a restricted browser
        await disposeEngineAndWorker();
        engine = await webllm.CreateMLCEngine(effectiveModelId, engineConfig, chatOpts);
      }
    } else {
      engine = await webllm.CreateMLCEngine(effectiveModelId, engineConfig, chatOpts);
    }

    engineInstance = engine;
    loadedContextWindow = targetCtx;
    emit({
      status: 'ready',
      modelId: effectiveModelId,
      progress: 100,
      statusText: 'Модель загружена и готова к работе офлайн',
      error: null,
    });
    return true;
  } catch (err: unknown) {
    await disposeEngineAndWorker();
    const raw = err instanceof Error ? err.message : 'Не удалось загрузить локальную модель.';
    const shortRaw = raw.length > 140 ? `${raw.slice(0, 140)}…` : raw;
    const isF16Model = modelId.includes('q4f16');
    const friendly = isGpuContextLostError(err)
      ? isF16Model
        ? `Драйвер WebGPU сбросил модель формата f16. Выберите совместимый вариант «(Adreno / f32)» и перезапустите браузер. (${shortRaw})`
        : `Браузер не смог запустить модель в WebGPU. Полностью перезапустите браузер или используйте «Офлайн-Советник (0 МБ)». (${shortRaw})`
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
  await disposeEngineAndWorker();
  emit({
    status: 'idle',
    modelId: null,
    progress: 0,
    statusText: 'Модель выгружена из памяти',
    error: null,
  });
}

export async function deleteLocalModelCache(modelId: string): Promise<void> {
  if (currentState.modelId === modelId && (engineInstance || workerInstance)) {
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
    // Mobile Chrome WebGPU frequently drops GPUDevice on OOM, f16 driver bugs (Adreno 660),
    // or voice/background transitions. Terminate the dead worker and try one clean compact-VRAM recovery.
    if (isGpuContextLostError(err)) {
      await disposeEngineAndWorker();
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
          await disposeEngineAndWorker();
          if (!isGpuContextLostError(retryErr)) {
            throw retryErr;
          }
        }
      }

      const isF16Model = activeModelId.includes('q4f16');
      const friendlyErr = isF16Model
        ? 'Драйвер WebGPU (часто на Snapdragon / Adreno) сбросил модель формата f16. Откройте Настройки → ИИ и выберите совместимый вариант «Qwen 2.5 · 1.5B (Adreno / f32)» или «Qwen 2.5 · 0.5B (Adreno / f32)» — они работают без f16-шейдеров.'
        : 'Браузер сбросил видеопамять WebGPU. Попробуйте более лёгкую «Qwen 2.5 · 0.5B (Adreno / f32)» в Настройках → ИИ или используйте «Офлайн-Советник (0 МБ)».';

      emit({
        status: 'error',
        modelId: null,
        progress: 0,
        statusText: 'Сброс видеопамяти WebGPU',
        error: friendlyErr,
      });
      throw new Error(friendlyErr);
    }

    throw err;
  }
}
