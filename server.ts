/**
 * OPTIONAL SERVER-SIDE FALLBACK / DEV PROXY (`server.ts`)
 * -------------------------------------------------------------------------
 * Основное приложение «Мои финансы» работает по принципу Local-First / Zero-Server:
 * статическая веб-сборка (GitHub Pages / PWA) и нативный Android .apk (Capacitor)
 * НЕ требуют запуска этого сервера и НЕ отправляют личные финансы в облако.
 *
 * Этот файл используется исключительно для:
 *  - локальной разработки с опциональными маршрутами `/api/*`;
 *  - добровольного облачного режима ИИ-советника (Gemini / OpenAI-compatible API)
 *    и SSRF-защищённого прокси для публичных RSS-лент, если пользователь сам
 *    развернёт сервер с переменными из `.env.example`.
 */
import express from 'express';
import http from 'http';
import path from 'path';
import dns from 'dns/promises';
import net from 'net';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: '25mb' }));

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY не настроен на сервере.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function classifyAiError(err: unknown, fallback: string): { status: number; message: string } {
  const raw = err instanceof Error ? err.message : fallback;
  if (raw.includes('API_KEY') || raw.includes('PERMISSION_DENIED') || raw.includes('403')) {
    return {
      status: 403,
      message: 'Проблема с ключом Gemini API. Проверьте ключ в панели Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || raw.includes('429')) {
    return {
      status: 429,
      message: 'Превышен лимит запросов к ИИ. Попробуйте повторить через минуту.',
    };
  }
  return { status: 500, message: raw || fallback };
}

// =========================================================================
// SSRF-SAFE PUBLIC IP & URL VALIDATION FOR TRUSTED KNOWLEDGE SOURCES
// =========================================================================

const MAX_KB_PROXY_BYTES = 512 * 1024; // 512 KB

function isPublicIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 169 && b === 254) return false; // Link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return false; // Private RFC1918
  if (a === 192 && b === 168) return false; // Private RFC1918
  if (a === 192 && b === 0 && (parts[2] === 0 || parts[2] === 2)) return false;
  if (a === 198 && (b === 18 || b === 19)) return false; // Benchmark
  if (a >= 224) return false; // Multicast & reserved
  return true;
}

function isPublicIp(rawIp: string): boolean {
  const ip = rawIp.trim().toLowerCase();
  const family = net.isIP(ip);
  if (family === 4) return isPublicIpv4(ip);
  if (family === 6) {
    if (ip === '::' || ip === '::1') return false;
    if (ip.startsWith('::ffff:')) {
      const mapped = ip.slice(7);
      if (net.isIP(mapped) === 4) return isPublicIpv4(mapped);
      return false;
    }
    if (ip.startsWith('fc') || ip.startsWith('fd')) return false; // ULA
    if (ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
      return false; // Link-local fe80::/10
    }
    if (ip.startsWith('ff')) return false; // Multicast
    return true;
  }
  return false;
}

async function assertPublicHttpsUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Некорректный формат ссылки.');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Разрешены только публичные ссылки по протоколу HTTPS.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Ссылка не должна содержать учётные данные.');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error('Разрешён только стандартный HTTPS-порт (443).');
  }
  const host = parsed.hostname.toLowerCase();
  if (
    !host ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    net.isIP(host) !== 0
  ) {
    throw new Error('Локальные и внутренние сетевые адреса запрещены.');
  }

  const records = await dns.lookup(host, { all: true, verbatim: true });
  if (!records.length || records.some((r) => !isPublicIp(r.address))) {
    throw new Error('Домен указывает на непубличный или недопустимый IP-адрес.');
  }
  return parsed;
}

async function readResponseWithLimit(resp: Response, maxBytes: number): Promise<string> {
  if (!resp.body) {
    const txt = await resp.text();
    return txt.slice(0, maxBytes);
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      if (total + value.byteLength > maxBytes) {
        chunks.push(value.subarray(0, Math.max(0, maxBytes - total)));
        total = maxBytes;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const ch of chunks) {
    merged.set(ch, offset);
    offset += ch.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

app.get('/api/ai/status', (_req, res) => {
  const geminiAvailable = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const openaiAvailable = Boolean(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  res.json({
    ok: true,
    geminiAvailable,
    openaiAvailable,
    geminiModels: ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'],
    openaiModel: openaiAvailable ? (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() : null,
  });
});

app.post('/api/kb/fetch', async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'Не передана ссылка на источник.' });
      return;
    }

    let currentUrl = await assertPublicHttpsUrl(url);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      let resp: Response | null = null;
      for (let hop = 0; hop < 3; hop++) {
        resp = await fetch(currentUrl.toString(), {
          method: 'GET',
          redirect: 'manual',
          headers: {
            'User-Agent': 'MyFinanceKnowledgeSync/1.0',
            Accept: 'application/json, application/rss+xml, application/xml, text/xml, text/plain, text/html;q=0.8',
          },
          signal: controller.signal,
        });

        if (resp.status >= 300 && resp.status < 400) {
          const location = resp.headers.get('location');
          if (!location) break;
          const nextResolved = new URL(location, currentUrl).toString();
          currentUrl = await assertPublicHttpsUrl(nextResolved);
          continue;
        }
        break;
      }

      if (!resp || !resp.ok) {
        res.status(502).json({ error: `Источник вернул статус HTTP ${resp?.status || 502}.` });
        return;
      }

      const contentType = (resp.headers.get('content-type') || '').toLowerCase();
      if (
        contentType &&
        !/^(text\/|application\/(json|javascript|xml|rss\+xml|atom\+xml|xhtml\+xml))/i.test(contentType)
      ) {
        res.status(415).json({ error: 'Поддерживаются только текстовые, RSS, JSON и веб-источники.' });
        return;
      }

      const content = await readResponseWithLimit(resp, MAX_KB_PROXY_BYTES);
      res.json({ content, contentType });
    } finally {
      clearTimeout(timer);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Не удалось загрузить публичный источник.';
    res.status(400).json({ error: message });
  }
});

app.post('/api/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType, context } = req.body as {
      audioBase64?: string;
      mimeType?: string;
      context?: 'note' | 'advisor';
    };

    if (!audioBase64 || typeof audioBase64 !== 'string') {
      res.status(400).json({ error: 'Не переданы аудиоданные для расшифровки.' });
      return;
    }

    const cleanMime = (mimeType || 'audio/webm').split(';')[0].trim();
    const ai = getAiClient();

    const promptText =
      context === 'advisor'
        ? 'Расшифруй этот голосовой вопрос пользователя о личных финансах на русском языке точно и грамотно, с пунктуацией (учитывай термины: НДФЛ, ОФЗ, ИИС, вклад, кредит, ипотека, кэшбэк, подушка безопасности, бюджет). Верни только сам текст вопроса без вводных слов и комментариев.'
        : 'Расшифруй эту голосовую заметку на русском языке точно и грамотно, с пунктуацией. Верни только сам расшифрованный текст без вводных слов и комментариев.';

    const response = await ai.models.generateContent({
      model: 'gemini-3.5-transcribe',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: cleanMime,
              data: audioBase64,
            },
          },
          {
            text: promptText,
          },
        ],
      },
    });

    const text = (response.text || '').trim();
    if (!text) {
      res.status(422).json({ error: 'Не удалось распознать речь в записи. Попробуйте говорить ближе к микрофону.' });
      return;
    }

    res.json({ text });
  } catch (err: unknown) {
    const { status, message } = classifyAiError(err, 'Ошибка сервера при расшифровке аудио.');
    res.status(status).json({ error: message });
  }
});

interface AdvisorContextPayload {
  sumIn?: number;
  sumOut?: number;
  left?: number;
  dailyLimit?: number;
  daysLeft?: number;
  fixedSum?: number;
  flexSum?: number;
  depositsTotal?: number;
  depositsSummary?: string;
  investmentsSummary?: string;
  topCategories?: { name: string; amount: number }[];
  socialRefund?: number;
  taxMort?: number;
  budgetLimit?: number;
  saveRuleLabel?: string | null;
  periodLabel?: string;
}

interface AdvisorRequestOptions {
  provider?: 'auto' | 'gemini-flash' | 'gemini-lite' | 'openai';
  responseStyle?: 'concise' | 'balanced' | 'detailed';
  strictMode?: boolean;
  customInstruction?: string;
  includeFinanceContext?: boolean;
}

function buildAdvisorSystemInstruction(options?: AdvisorRequestOptions): string {
  const style = options?.responseStyle || 'balanced';
  const styleBlock =
    style === 'concise'
      ? 'Формат: максимально кратко (3–5 лаконичных пунктов, только суть и цифры).'
      : style === 'detailed'
      ? 'Формат: подробный практический разбор с расчётами, плюсами/минусами и пошаговым планом (до 14–16 строк).'
      : 'Формат: компактно для экрана телефона — короткие абзацы и маркеры «•», обычно 5–10 строк.';

  const strictBlock =
    options?.strictMode !== false
      ? 'Строгое правило точности: опирайся в первую очередь на цифры пользователя, его выжимки из Базы знаний и свежие данные из доверенных источников; не придумывай фиктивные активы, вклады или законы, а если опираешься на источник — коротко укажи его название.'
      : 'Опирайся на данные пользователя и Базу знаний; если данных не хватает, можно дать общие ориентиры с пометкой, что это ориентировочный пример.';

  const customBlock =
    typeof options?.customInstruction === 'string' && options.customInstruction.trim()
      ? `\nПерсональные указания пользователя: ${options.customInstruction.trim().slice(0, 800)}`
      : '';

  return (
    'Ты — персональный финансовый советник в приложении «Мои финансы» (Россия, валюта — рубли ₽). ' +
    'Отвечай на русском языке чётко, доброжелательно и по делу, без markdown-заголовков (#), звёздочек (**) и таблиц. ' +
    'Учитывай российскую специфику (НДФЛ 13%, налоговые вычеты, вклады, накопительные счета, ИИС, ОФЗ, фонды ликвидности, подушка безопасности, досрочное погашение кредитов). ' +
    `${styleBlock} ${strictBlock}${customBlock}`
  );
}

async function askOpenAiCompatibleServer(systemInstruction: string, userPrompt: string): Promise<string> {
  const apiKey = (process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) {
    throw new Error('Серверный OpenAI-совместимый API не настроен (отсутствует OPENAI_API_KEY).');
  }
  const rawBase = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
  let parsedBase: URL;
  try {
    parsedBase = new URL(rawBase);
  } catch {
    throw new Error('Некорректный адрес OPENAI_BASE_URL на сервере.');
  }
  if (parsedBase.protocol !== 'https:') {
    throw new Error('OPENAI_BASE_URL должен использовать защищённый протокол HTTPS.');
  }
  const model = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);
  try {
    const resp = await fetch(`${parsedBase.toString()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: systemInstruction },
          { role: 'user', content: userPrompt },
        ],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} при обращении к облачному ИИ.`);
    }
    const json = (await resp.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return (json?.choices?.[0]?.message?.content || '').trim();
  } finally {
    clearTimeout(timer);
  }
}

app.post('/api/advisor', async (req, res) => {
  try {
    const { question, context, history, knowledgeSnippets, options } = req.body as {
      question?: string;
      context?: AdvisorContextPayload | null;
      history?: { role: 'user' | 'model'; text: string }[];
      knowledgeSnippets?: { source: string; text: string }[];
      options?: AdvisorRequestOptions;
    };

    const cleanQuestion = (question || '').trim().slice(0, 2000);
    if (!cleanQuestion) {
      res.status(400).json({ error: 'Не передан текст вопроса.' });
      return;
    }

    const includeFinance = options?.includeFinanceContext !== false && context != null;
    let financialSnapshot = '';
    if (includeFinance) {
      const ctx = context || {};
      const topCatsText =
        Array.isArray(ctx.topCategories) && ctx.topCategories.length > 0
          ? ctx.topCategories.map((c) => `${c.name}: ${Math.round(c.amount)} ₽`).join(', ')
          : 'данных о тратах пока нет';

      financialSnapshot = [
        `Период: ${ctx.periodLabel || 'текущий'}`,
        `Доходы: ${Math.round(ctx.sumIn || 0)} ₽`,
        `Расходы: ${Math.round(ctx.sumOut || 0)} ₽ (обязательные: ${Math.round(ctx.fixedSum || 0)} ₽, гибкие: ${Math.round(ctx.flexSum || 0)} ₽)`,
        `Остаток: ${Math.round(ctx.left || 0)} ₽`,
        `Безопасный дневной лимит: ${Math.round(ctx.dailyLimit || 0)} ₽/день (осталось дней в месяце: ${ctx.daysLeft || 1})`,
        `Лимит бюджета на месяц: ${Math.round(ctx.budgetLimit || 0)} ₽`,
        `Топ категорий расходов: ${topCatsText}`,
        `Вклады и накопления: ${Math.round(ctx.depositsTotal || 0)} ₽${ctx.depositsSummary ? ` (${ctx.depositsSummary})` : ''}`,
        ctx.investmentsSummary ? `ИИС и активы: ${ctx.investmentsSummary}` : '',
        `Потенциальный социальный вычет 13% НДФЛ: ${Math.round(ctx.socialRefund || 0)} ₽; ипотечные платежи в периоде: ${Math.round(ctx.taxMort || 0)} ₽`,
        ctx.saveRuleLabel ? `Активное автоправило накопления: ${ctx.saveRuleLabel}` : 'Автоправило накопления: не задано',
      ]
        .filter(Boolean)
        .join('\n');
    }

    const kbBlock = Array.isArray(knowledgeSnippets)
      ? knowledgeSnippets
          .slice(0, 6)
          .filter((k) => k && typeof k.text === 'string' && k.text.trim())
          .map((k) => `• [${String(k.source || 'База знаний').slice(0, 80)}] ${k.text.trim().slice(0, 500)}`)
          .join('\n')
      : '';

    const recentHistory = Array.isArray(history)
      ? history
          .slice(-6)
          .filter((h) => h && typeof h.text === 'string' && h.text.trim())
          .map((h) => `${h.role === 'user' ? 'Пользователь' : 'Советник'}: ${h.text.trim().slice(0, 600)}`)
          .join('\n')
      : '';

    const userPrompt = [
      financialSnapshot
        ? `Актуальная финансовая сводка пользователя (используй эти цифры, если вопрос касается его бюджета или ИИС):\n${financialSnapshot}`
        : 'Финансовая сводка отключена пользователем в настройках приватности.',
      kbBlock ? `\nМатериалы из Базы знаний и доверенных источников пользователя:\n${kbBlock}` : '',
      recentHistory ? `\nПредыдущий контекст диалога:\n${recentHistory}` : '',
      `\nВопрос пользователя: ${cleanQuestion}`,
    ]
      .filter(Boolean)
      .join('\n');

    const systemInstruction = buildAdvisorSystemInstruction(options);
    const provider = options?.provider || 'auto';

    let reply = '';
    let usedProvider = '';

    const useOpenAi =
      provider === 'openai' || (provider === 'auto' && !process.env.GEMINI_API_KEY && Boolean(process.env.OPENAI_API_KEY));

    if (useOpenAi) {
      reply = await askOpenAiCompatibleServer(systemInstruction, userPrompt);
      usedProvider = `OpenAI API (${(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim()})`;
    } else if (process.env.GEMINI_API_KEY) {
      const ai = getAiClient();
      const targetModel = provider === 'gemini-lite' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';
      const thinkingLevel = provider === 'gemini-lite' ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
      const response = await ai.models.generateContent({
        model: targetModel,
        contents: userPrompt,
        config: {
          systemInstruction,
          thinkingConfig: {
            thinkingLevel,
          },
        },
      });
      reply = (response.text || '').trim();
      usedProvider = targetModel;
    } else {
      throw new Error('GEMINI_API_KEY не настроен на сервере. Проверьте панель Settings > Secrets.');
    }

    if (!reply) {
      res.status(502).json({ error: 'ИИ вернул пустой ответ. Попробуйте переформулировать вопрос.' });
      return;
    }

    res.json({ reply, provider: usedProvider });
  } catch (err: unknown) {
    const { status, message } = classifyAiError(err, 'Ошибка сервера при обращении к ИИ-Советнику.');
    res.status(status).json({ error: message });
  }
});

async function startServer() {
  const PORT = Number(process.env.PORT) || 3000;
  const httpServer = http.createServer(app);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled = process.env.DISABLE_HMR === 'true';
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
        hmr: !hmrDisabled,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
