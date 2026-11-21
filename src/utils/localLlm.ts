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
    id: 'Qwen2.5-0.5B-Instruct-q4f32_1-MLC',
    name: 'Qwen 2.5 · 0.5B (Adreno / f32)',
    sizeLabel: '~450 МБ',
    badge: 'Рекомендуется',
    description: 'Версия без f16-шейдеров — максимально стабильна на Android / Snapdragon (OnePlus, Samsung, Xiaomi) и на ПК.',
  },
  {
    id: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    name: 'Qwen 2.5 · 0.5B (f16)',
    sizeLabel: '~390 МБ',
    badge: 'Компактная',
    description: 'Быстрая компактная модель с f16-шейдерами. Если ваш GPU не поддерживает f16, автоматически переключится на f32.',
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
  return /mapasync|gpubuffer|instance reference|already been disposed|disposed|tokenizer|devicelost|device.*lost|out of memory|oom|allocation failed|webgpu|vk_|context lost/i.test(
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

export interface LocalLlmAskOptions {
  responseStyle?: 'concise' | 'balanced' | 'detailed';
  strictMode?: boolean;
  customInstruction?: string;
  historyTurns?: number;
}

async function runCompletion(
  engine: MLCEngineInterface,
  question: string,
  financialSnapshot: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  options?: LocalLlmAskOptions
): Promise<string> {
  const mobile = isMobileClient();
  const style = options?.responseStyle || 'balanced';
  const styleRule =
    style === 'concise'
      ? 'Отвечай максимально кратко: 2–4 коротких пункта без воды.'
      : style === 'detailed'
      ? 'Дай структурированный ответ с конкретными расчётами и практическими шагами (6–10 предложений).'
      : 'Отвечай кратко, практично и понятно (3–6 предложений, без таблиц).';
  const strictRule =
    options?.strictMode !== false
      ? 'Не выдумывай факты, ставки и законы, которых нет в переданных данных, выжимках или доверенных источниках.'
      : 'Опирайся на переданные данные, а при нехватке данных чётко обозначай общие ориентиры.';
  const customRule = options?.customInstruction?.trim()
    ? `\nДополнительные требования пользователя: ${options.customInstruction.trim().slice(0, 400)}`
    : '';

  const systemPrompt =
    `Ты — персональный финансовый советник в приложении «Мои финансы» (Россия, рубли ₽). ` +
    `${styleRule} ${strictRule}${customRule}\n` +
    `Используй реальные данные пользователя, выжимки и доверенные источники:\n` +
    financialSnapshot;

  const maxTurns = Math.min(mobile ? 4 : 6, Math.max(2, options?.historyTurns ?? (mobile ? 2 : 4)));
  const trimmedHistory = history.slice(-maxTurns);
  const maxTokens =
    style === 'concise' ? (mobile ? 180 : 220) : style === 'detailed' ? (mobile ? 340 : 480) : mobile ? 240 : 320;
  try {
    const completion = await engine.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        ...trimmedHistory,
        { role: 'user', content: question },
      ],
      temperature: options?.strictMode !== false ? 0.25 : 0.4,
      max_tokens: maxTokens,
    });

    const reply = (completion.choices[0]?.message?.content || '').trim();
    if (!reply) {
      throw new Error('Empty local LLM response');
    }
    return reply;
  } catch (err: unknown) {
    throw err instanceof Error ? err : new Error(String(err || 'WebLLM completion failed'));
  }
}

/**
 * Runs local WebLLM inference safely.
 * On ANY WebGPU / VRAM / Tokenizer / disposed / browser error:
 * - silently calls engine.unload() inside try/catch, resets engine = null,
 * - clears any technical red error state,
 * - returns null so the caller immediately serves the built-in «Офлайн-Советник (0 МБ)».
 */
export async function askLocalLlm(
  question: string,
  financialSnapshot: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  options?: LocalLlmAskOptions
): Promise<string | null> {
  const activeModelId = currentState.modelId;
  if (!engineInstance || currentState.status !== 'ready' || !activeModelId) {
    return null;
  }

  try {
    return await runCompletion(engineInstance, question, financialSnapshot, history, options);
  } catch (err: unknown) {
    // Always safely unload and reset engineInstance = null on GPU/Tokenizer/VRAM or unexpected errors
    const isMemoryOrGpuErr =
      isGpuContextLostError(err) ||
      /tokenizer|devicelost|device.?lost|deleted|disposed|gpubuffer|mapasync|abort|memory/i.test(
        err instanceof Error ? err.message : String(err || '')
      );

    await disposeEngineAndWorker();
    emit({
      status: 'idle',
      modelId: null,
      progress: 0,
      statusText: isMemoryOrGpuErr
        ? 'Движок WebGPU сброшен — активен Офлайн-Советник'
        : 'Модель выгружена — активен Офлайн-Советник',
      error: null,
    });

    // Silent fallback: never surface red technical GPU errors to the user
    return null;
  }
}
