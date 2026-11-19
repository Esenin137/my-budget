import express from 'express';
import http from 'http';
import path from 'path';
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
  topCategories?: { name: string; amount: number }[];
  socialRefund?: number;
  taxMort?: number;
  budgetLimit?: number;
  saveRuleLabel?: string | null;
  periodLabel?: string;
}

app.post('/api/advisor', async (req, res) => {
  try {
    const { question, context, history } = req.body as {
      question?: string;
      context?: AdvisorContextPayload;
      history?: { role: 'user' | 'model'; text: string }[];
    };

    const cleanQuestion = (question || '').trim();
    if (!cleanQuestion) {
      res.status(400).json({ error: 'Не передан текст вопроса.' });
      return;
    }

    const ai = getAiClient();

    const ctx = context || {};
    const topCatsText =
      Array.isArray(ctx.topCategories) && ctx.topCategories.length > 0
        ? ctx.topCategories.map((c) => `${c.name}: ${Math.round(c.amount)} ₽`).join(', ')
        : 'данных о тратах пока нет';

    const financialSnapshot = [
      `Период: ${ctx.periodLabel || 'текущий'}`,
      `Доходы: ${Math.round(ctx.sumIn || 0)} ₽`,
      `Расходы: ${Math.round(ctx.sumOut || 0)} ₽ (обязательные: ${Math.round(ctx.fixedSum || 0)} ₽, гибкие: ${Math.round(ctx.flexSum || 0)} ₽)`,
      `Остаток: ${Math.round(ctx.left || 0)} ₽`,
      `Безопасный дневной лимит: ${Math.round(ctx.dailyLimit || 0)} ₽/день (осталось дней в месяце: ${ctx.daysLeft || 1})`,
      `Лимит бюджета на месяц: ${Math.round(ctx.budgetLimit || 0)} ₽`,
      `Топ категорий расходов: ${topCatsText}`,
      `Вклады и накопления: ${Math.round(ctx.depositsTotal || 0)} ₽${ctx.depositsSummary ? ` (${ctx.depositsSummary})` : ''}`,
      `Потенциальный социальный вычет 13% НДФЛ: ${Math.round(ctx.socialRefund || 0)} ₽; ипотечные платежи в периоде: ${Math.round(ctx.taxMort || 0)} ₽`,
      ctx.saveRuleLabel ? `Активное автоправило накопления: ${ctx.saveRuleLabel}` : 'Автоправило накопления: не задано',
    ].join('\n');

    const recentHistory = Array.isArray(history)
      ? history
          .slice(-6)
          .filter((h) => h && typeof h.text === 'string' && h.text.trim())
          .map((h) => `${h.role === 'user' ? 'Пользователь' : 'Советник'}: ${h.text.trim()}`)
          .join('\n')
      : '';

    const userPrompt = [
      'Актуальная финансовая сводка пользователя (используй эти цифры, если вопрос касается его бюджета):',
      financialSnapshot,
      recentHistory ? `\nПредыдущий контекст диалога:\n${recentHistory}` : '',
      `\nВопрос пользователя: ${cleanQuestion}`,
    ]
      .filter(Boolean)
      .join('\n');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: userPrompt,
      config: {
        systemInstruction:
          'Ты — персональный финансовый советник в мобильном приложении «Мои финансы» (Россия, валюта — рубли ₽). ' +
          'Отвечай на русском языке чётко, доброжелательно и по делу, с конкретными цифрами и практическими шагами. ' +
          'Учитывай российскую специфику (НДФЛ 13%, налоговые вычеты, вклады, накопительные счета, ИИС, ОФЗ, фонды ликвидности, подушка безопасности, досрочное погашение кредитов). ' +
          'Оформляй ответ компактно для экрана телефона: короткие абзацы и маркеры «•», без markdown-заголовков (#), звёздочек (**) и таблиц. ' +
          'Обычно укладывайся в 5–10 строк, если пользователь не просит подробный план.',
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
      },
    });

    const reply = (response.text || '').trim();
    if (!reply) {
      res.status(502).json({ error: 'ИИ вернул пустой ответ. Попробуйте переформулировать вопрос.' });
      return;
    }

    res.json({ reply });
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
