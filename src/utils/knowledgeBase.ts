import { KnowledgeRule, KnowledgeSource } from '../types';
import { idbGetKv, idbPutKv } from './storage';

export const KB_ONLINE_CACHE_KEY = 'my-budget-kb-online-cache-v1';
export const MAX_RULE_FILE_BYTES = 512 * 1024; // 512 KB cap for .txt / .md uploads
const MAX_CACHED_ENTRIES_PER_SOURCE = 60;
const SOURCE_STALE_MS = 15 * 60 * 1000; // 15 minutes

export const HONEST_UNKNOWN_REPLY =
  'Я пока не могу точно ответить на этот вопрос: в моей базе знаний нет актуальных данных по этой теме. Добавьте нужную выжимку или ссылку в разделе «Настройки → База знаний ассистента», и я сразу научусь это учитывать.';

export interface CachedOnlineEntry {
  title: string;
  snippet: string;
  updatedAt?: string;
}

export interface CachedOnlineSourceRecord {
  sourceId: string;
  sourceName: string;
  fetchedAt: number;
  status: 'ok' | 'error';
  error?: string;
  entries: CachedOnlineEntry[];
}

export type OnlineCacheMap = Record<string, CachedOnlineSourceRecord>;

export interface KnowledgeSearchHit {
  title: string;
  snippet: string;
  sourceLabel: string;
  score: number;
  updatedAt?: string;
}

// =========================================================================
// PRIVACY & URL SAFETY VALIDATION
// =========================================================================

const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
];

export function validateSafeSourceUrl(
  rawUrl: string
): { ok: true; url: string; inferredKind: KnowledgeSource['kind'] } | { ok: false; error: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return { ok: false, error: 'Укажите ссылку на источник.' };
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: 'Некорректный формат ссылки. Пример: https://iss.moex.com/...' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, error: 'Разрешены только защищённые публичные ссылки (https://).' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Ссылка не должна содержать логин или пароль.' };
  }
  const host = parsed.hostname.toLowerCase();
  if (!host || !host.includes('.') || PRIVATE_HOST_PATTERNS.some((re) => re.test(host))) {
    return { ok: false, error: 'Локальные и внутренние сетевые адреса запрещены.' };
  }

  let inferredKind: KnowledgeSource['kind'] = 'text';
  if (host.includes('iss.moex.com')) {
    inferredKind = 'moex';
  } else if (/rss|feed|atom|rss2json/i.test(trimmed)) {
    inferredKind = 'rss';
  } else if (/\.json(\?|$)/i.test(parsed.pathname + parsed.search)) {
    inferredKind = 'json';
  }

  return { ok: true, url: parsed.toString(), inferredKind };
}

// =========================================================================
// SAFE HTML STRIPPING (PLAIN TEXT ONLY — NEVER RENDERED AS HTML)
// =========================================================================

const ENTITY_MAP: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  laquo: '«',
  raquo: '»',
  mdash: '—',
  ndash: '–',
  hellip: '…',
};

export function stripHtmlToPlainText(raw: string): string {
  if (!raw) return '';
  let text = String(raw)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h[1-6]|article|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  text = text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, ent: string) => {
    const low = ent.toLowerCase();
    if (ENTITY_MAP[low]) return ENTITY_MAP[low];
    if (low.startsWith('#x')) {
      const code = parseInt(low.slice(2), 16);
      return Number.isFinite(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    if (low.startsWith('#')) {
      const code = parseInt(low.slice(1), 10);
      return Number.isFinite(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
    }
    return ' ';
  });

  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// =========================================================================
// RUSSIAN STEMMING, SYNONYM EXPANSION & KEYWORD EXTRACTION
// =========================================================================

const RU_STOP_WORDS = new Set([
  'как', 'что', 'где', 'когда', 'почему', 'зачем', 'какой', 'какая', 'какие', 'какое',
  'сколько', 'можно', 'нужно', 'надо', 'мне', 'мой', 'моя', 'мое', 'мои', 'меня', 'мной',
  'ваш', 'ваша', 'ваши', 'для', 'про', 'это', 'этот', 'эта', 'эти', 'если', 'или', 'при',
  'без', 'над', 'под', 'про', 'через', 'после', 'перед', 'есть', 'быть', 'был', 'была',
  'были', 'будет', 'будут', 'подскажи', 'подскажите', 'расскажи', 'расскажите', 'скажи',
  'скажите', 'помоги', 'помогите', 'привет', 'здравствуй', 'здравствуйте', 'пожалуйста',
  'сейчас', 'сегодня', 'завтра', 'вчера', 'очень', 'просто', 'такое', 'такой', 'каких',
  'каком', 'какую', 'каким', 'можно', 'ли', 'бы', 'же', 'то', 'не', 'ни', 'да', 'нет',
  'вопрос', 'ответ', 'проверка', 'связи', 'тест', 'дела', 'жизнь', 'погода',
]);

// Domain alias expansion so Russian questions match MOEX tickers & financial abbreviations locally
const SYNONYM_MAP: Record<string, string[]> = {
  sber: ['сбер', 'сбербанк'],
  сбер: ['sber', 'сбербанк'],
  сбербанк: ['sber', 'сбер'],
  gazp: ['газпром'],
  газпром: ['gazp'],
  lkoh: ['лукойл'],
  лукойл: ['lkoh'],
  ydex: ['яндекс'],
  яндекс: ['ydex'],
  rosn: ['роснефть'],
  роснефть: ['rosn'],
  vtbr: ['втб'],
  втб: ['vtbr'],
  moex: ['мосбирж', 'imoex'],
  imoex: ['мосбирж', 'индекс', 'moex'],
  мосбирж: ['moex', 'imoex'],
  nvtk: ['новатэк'],
  новатэк: ['nvtk'],
  plzl: ['полюс'],
  полюс: ['plzl'],
  gmkn: ['норникел', 'гмк'],
  норникел: ['gmkn'],
  rgbi: ['офз', 'облигац', 'rgbitr'],
  офз: ['rgbi', 'rgbitr', 'облигац'],
  иис3: ['иис', 'иис-3'],
  'иис-3': ['иис', 'иис3'],
  иис: ['иис3', 'иис-3'],
  ндфл: ['налог', 'вычет', '13%'],
  цб: ['ключев', 'ставк', 'центробанк'],
  ключев: ['ставк', 'цб'],
  рбк: ['новост', 'экономик'],
  котировк: ['акц', 'индекс', 'мосбирж', 'imoex'],
  акц: ['котировк', 'мосбирж', 'sber', 'gazp', 'lkoh'],
};

const RU_SUFFIX_RE =
  /(?:иями|ями|ами|ого|его|ому|ему|ими|ыми|ость|ение|ание|ться|ешь|ишь|ете|ите|ать|ять|ить|ыть|ов|ев|ей|ой|ий|ый|ая|яя|ое|ее|ие|ые|ам|ям|ах|ях|ом|ем|ую|юю|ию|ия|ии|у|ю|а|я|и|ы|е|о)$/;

export function stemRussian(rawWord: string): string {
  const w = rawWord.toLowerCase().replace(/ё/g, 'е').trim();
  if (w.length <= 3) return w;
  const stripped = w.replace(RU_SUFFIX_RE, '');
  return stripped.length >= 3 ? stripped : w.slice(0, Math.max(3, w.length - 1));
}

export function extractQueryTokens(rawText: string): string[] {
  const cleaned = rawText
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9%-]+/g, ' ')
    .trim();

  if (!cleaned) return [];
  const rawWords = cleaned.split(/\s+/).filter(Boolean);
  const tokens = new Set<string>();

  for (const w of rawWords) {
    if (w.length < 2) continue;
    if (RU_STOP_WORDS.has(w)) continue;
    // Keep short meaningful tickers/abbreviations (2-3 chars like цб, рф, иис, офз, втб, 13%)
    if (w.length === 2 && !/^(цб|рф|тк|нк|гк|жк|13)$/.test(w)) continue;
    const stem = stemRussian(w);
    tokens.add(w);
    if (stem.length >= 3) tokens.add(stem);

    const syns = SYNONYM_MAP[w] || SYNONYM_MAP[stem];
    if (syns) {
      syns.forEach((s) => tokens.add(s));
    }
  }

  return Array.from(tokens);
}

function buildStemSet(text: string): { lower: string; stems: Set<string> } {
  const lower = text.toLowerCase().replace(/ё/g, 'е');
  const words = lower.replace(/[^a-zа-я0-9%-]+/g, ' ').split(/\s+/).filter(Boolean);
  const stems = new Set<string>();
  for (const w of words) {
    if (w.length < 2) continue;
    stems.add(w);
    const st = stemRussian(w);
    if (st.length >= 3) stems.add(st);
  }
  return { lower, stems };
}

function scoreTextAgainstTokens(text: string, queryTokens: string[]): number {
  if (!queryTokens.length || !text.trim()) return 0;
  const { lower, stems } = buildStemSet(text);
  let score = 0;
  let uniqueHits = 0;

  for (const tok of queryTokens) {
    if (stems.has(tok)) {
      score += tok.length >= 4 ? 3 : 2;
      uniqueHits += 1;
    } else if (tok.length >= 4 && lower.includes(tok)) {
      score += 2;
      uniqueHits += 1;
    }
  }

  // Boost multi-keyword coverage
  if (uniqueHits >= 2) score += uniqueHits * 2;
  return score;
}

// =========================================================================
// LOCAL SEARCH IN USER'S KNOWLEDGE BASE RULES (.txt / .md / manual notes)
// =========================================================================

export function searchKnowledgeRules(
  query: string,
  rules: KnowledgeRule[],
  maxResults = 3
): KnowledgeSearchHit[] {
  if (!rules.length) return [];
  const tokens = extractQueryTokens(query);
  if (!tokens.length) return [];

  const hits: KnowledgeSearchHit[] = [];

  for (const rule of rules) {
    const titleScore = scoreTextAgainstTokens(rule.title, tokens) * 1.6;
    const blocks = rule.content
      .split(/\n{2,}|(?<=[.!?])\s+(?=[А-ЯЁA-Z0-9«"•—-])/)
      .map((b) => b.trim())
      .filter((b) => b.length > 0);

    let bestBlock = '';
    let bestBlockScore = 0;

    for (const block of blocks) {
      const sc = scoreTextAgainstTokens(block, tokens);
      if (sc > bestBlockScore) {
        bestBlockScore = sc;
        bestBlock = block;
      }
    }

    const totalScore = titleScore + bestBlockScore;
    if (totalScore >= 3) {
      const snippetRaw = bestBlock || rule.content;
      const snippet = snippetRaw.length > 420 ? `${snippetRaw.slice(0, 417).trim()}…` : snippetRaw;
      hits.push({
        title: rule.title,
        snippet,
        sourceLabel: rule.fileName
          ? `База знаний · файл «${rule.fileName}»`
          : `База знаний · «${rule.title}»`,
        score: totalScore,
      });
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// =========================================================================
// ONLINE PUBLIC SOURCES: FETCH -> SANITIZE -> CACHE IN INDEXEDDB -> SEARCH LOCALLY
// =========================================================================

export async function loadOnlineCacheMap(): Promise<OnlineCacheMap> {
  try {
    const cached = await idbGetKv<OnlineCacheMap>(KB_ONLINE_CACHE_KEY);
    return cached && typeof cached === 'object' ? cached : {};
  } catch {
    return {};
  }
}

export async function saveOnlineCacheMap(map: OnlineCacheMap): Promise<void> {
  await idbPutKv(KB_ONLINE_CACHE_KEY, map).catch(() => {});
}

function parseMoexJson(data: Record<string, unknown>): CachedOnlineEntry[] {
  const entries: CachedOnlineEntry[] = [];
  const secBlock = data.securities as { columns?: string[]; data?: unknown[][] } | undefined;
  const mdBlock = data.marketdata as { columns?: string[]; data?: unknown[][] } | undefined;
  if (!secBlock?.columns || !Array.isArray(secBlock.data)) return entries;

  const secCols = secBlock.columns;
  const secIdIdx = secCols.indexOf('SECID');
  const shortNameIdx = secCols.indexOf('SHORTNAME') >= 0 ? secCols.indexOf('SHORTNAME') : secCols.indexOf('NAME');
  const prevPriceIdx = secCols.indexOf('PREVPRICE') >= 0 ? secCols.indexOf('PREVPRICE') : secCols.indexOf('LASTVALUE');

  const mdBySecId = new Map<string, Record<string, unknown>>();
  if (mdBlock?.columns && Array.isArray(mdBlock.data)) {
    const mdCols = mdBlock.columns;
    const mdIdIdx = mdCols.indexOf('SECID');
    if (mdIdIdx >= 0) {
      for (const row of mdBlock.data) {
        const id = String(row[mdIdIdx] ?? '');
        if (!id) continue;
        const obj: Record<string, unknown> = {};
        mdCols.forEach((col, i) => {
          obj[col] = row[i];
        });
        mdBySecId.set(id, obj);
      }
    }
  }

  for (const row of secBlock.data.slice(0, MAX_CACHED_ENTRIES_PER_SOURCE)) {
    const secId = secIdIdx >= 0 ? String(row[secIdIdx] ?? '').trim() : '';
    if (!secId) continue;
    const shortName = shortNameIdx >= 0 ? String(row[shortNameIdx] ?? secId).trim() : secId;
    const md = mdBySecId.get(secId);

    const priceRaw =
      md?.CURRENTVALUE ??
      md?.LAST ??
      md?.MARKETPRICE ??
      (prevPriceIdx >= 0 ? row[prevPriceIdx] : null);
    const pctRaw = md?.LASTCHANGEPRC ?? md?.LASTTOPREVPRICE ?? null;
    const updRaw = md?.UPDATETIME ?? md?.SYSTIME ?? '';

    const priceNum = typeof priceRaw === 'number' ? priceRaw : Number(priceRaw);
    const pctNum = typeof pctRaw === 'number' ? pctRaw : Number(pctRaw);

    const priceStr = Number.isFinite(priceNum) && priceNum > 0
      ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(priceNum)
      : 'нет торгов';
    const pctStr = Number.isFinite(pctNum)
      ? `${pctNum >= 0 ? '+' : ''}${pctNum.toFixed(2)}%`
      : '';

    const title = `${secId} (${shortName})`;
    const snippet = `${title}: котировка ${priceStr}${pctStr ? ` (изменение за день: ${pctStr})` : ''}. Данные Мосбиржи (MOEX ISS).`;
    entries.push({
      title,
      snippet: stripHtmlToPlainText(snippet),
      updatedAt: updRaw ? String(updRaw).slice(0, 19) : undefined,
    });
  }

  return entries;
}

function parseRssOrJsonPayload(rawText: string, source: KnowledgeSource): CachedOnlineEntry[] {
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  // 1) Try JSON (MOEX ISS, rss2json, or generic JSON array/object)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown> | unknown[];

      if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
        // MOEX ISS format
        if (source.kind === 'moex' || ('securities' in parsed && 'marketdata' in parsed)) {
          const moexEntries = parseMoexJson(parsed);
          if (moexEntries.length > 0) return moexEntries;
        }

        // rss2json / standard feed JSON format ({ items: [...] })
        if (Array.isArray(parsed.items)) {
          return (parsed.items as Record<string, unknown>[])
            .slice(0, MAX_CACHED_ENTRIES_PER_SOURCE)
            .map((it) => {
              const title = stripHtmlToPlainText(String(it.title || 'Новость')).slice(0, 180);
              const desc = stripHtmlToPlainText(String(it.description || it.content || '')).slice(0, 360);
              const pub = typeof it.pubDate === 'string' ? it.pubDate.slice(0, 16) : undefined;
              return {
                title,
                snippet: desc ? `${title}. ${desc}` : title,
                updatedAt: pub,
              };
            })
            .filter((e) => e.snippet.length > 4);
        }
      }

      // Generic JSON fallback: flatten string lines safely
      const plain = stripHtmlToPlainText(JSON.stringify(parsed, null, 2)).slice(0, 8000);
      return plain
        .split(/\n+/)
        .map((l) => l.trim())
        .filter((l) => l.length >= 16)
        .slice(0, MAX_CACHED_ENTRIES_PER_SOURCE)
        .map((line, i) => ({
          title: `${source.name} #${i + 1}`,
          snippet: line.slice(0, 360),
        }));
    } catch {
      // Fall through to XML/text parser
    }
  }

  // 2) Try RSS / Atom XML
  if (/<(?:rss|feed|item|entry)\b/i.test(trimmed)) {
    const itemMatches = trimmed.match(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi) || [];
    if (itemMatches.length > 0) {
      return itemMatches
        .slice(0, MAX_CACHED_ENTRIES_PER_SOURCE)
        .map((block) => {
          const titleM = block.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const descM =
            block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) ||
            block.match(/<summary[^>]*>([\s\S]*?)<\/summary>/i) ||
            block.match(/<content[^>]*>([\s\S]*?)<\/content>/i);
          const pubM =
            block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) ||
            block.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i);
          const title = stripHtmlToPlainText(titleM?.[1] || 'Публикация').slice(0, 180);
          const desc = stripHtmlToPlainText(descM?.[1] || '').slice(0, 360);
          return {
            title,
            snippet: desc ? `${title}. ${desc}` : title,
            updatedAt: pubM?.[1] ? stripHtmlToPlainText(pubM[1]).slice(0, 22) : undefined,
          };
        })
        .filter((e) => e.snippet.length > 4);
    }
  }

  // 3) Plain text / Markdown / stripped HTML page
  const cleanText = stripHtmlToPlainText(trimmed).slice(0, 20000);
  const paragraphs = cleanText
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 20)
    .slice(0, MAX_CACHED_ENTRIES_PER_SOURCE);

  return paragraphs.map((p, idx) => ({
    title: `${source.name} · фрагмент ${idx + 1}`,
    snippet: p.slice(0, 380),
  }));
}

/**
 * Privacy-preserving public feed download:
 * NEVER sends the user's question, transaction sums, or any personal data outbound.
 * Downloads ONLY the static public source URL, strips all HTML, and caches plain text locally in IndexedDB.
 */
export async function fetchOnlineSourceToCache(
  source: KnowledgeSource
): Promise<CachedOnlineSourceRecord> {
  const valid = validateSafeSourceUrl(source.url);
  if (!valid.ok) {
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedAt: Date.now(),
      status: 'error',
      error: valid.error,
      entries: [],
    };
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);

  try {
    const resp = await fetch(valid.url, {
      method: 'GET',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}`);
    }
    const rawText = await resp.text();
    const entries = parseRssOrJsonPayload(rawText, source);
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedAt: Date.now(),
      status: 'ok',
      entries,
    };
  } catch (err: unknown) {
    const msg =
      err instanceof Error && err.name === 'AbortError'
        ? 'Таймаут загрузки (9 сек)'
        : 'Не удалось загрузить (нет сети или ограничение CORS на сайте)';
    return {
      sourceId: source.id,
      sourceName: source.name,
      fetchedAt: Date.now(),
      status: 'error',
      error: msg,
      entries: [],
    };
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function syncEnabledOnlineSources(
  sources: KnowledgeSource[],
  options?: { force?: boolean }
): Promise<OnlineCacheMap> {
  const cache = await loadOnlineCacheMap();
  const now = Date.now();
  const enabledSources = sources.filter((s) => s.enabled);

  const tasks = enabledSources.map(async (src) => {
    const existing = cache[src.id];
    const isFresh =
      !options?.force &&
      existing &&
      existing.status === 'ok' &&
      existing.entries.length > 0 &&
      now - existing.fetchedAt < SOURCE_STALE_MS;

    if (isFresh) return;

    const result = await fetchOnlineSourceToCache(src);
    // Keep previous valid entries if network temporarily fails so offline cache stays usable
    if (result.status === 'error' && existing?.entries?.length) {
      cache[src.id] = {
        ...existing,
        error: result.error,
      };
    } else {
      cache[src.id] = result;
    }
  });

  await Promise.all(tasks);
  await saveOnlineCacheMap(cache);
  return cache;
}

export function searchOnlineCache(
  query: string,
  sources: KnowledgeSource[],
  cache: OnlineCacheMap,
  maxResults = 3
): KnowledgeSearchHit[] {
  const tokens = extractQueryTokens(query);
  if (!tokens.length) return [];

  const hits: KnowledgeSearchHit[] = [];

  for (const src of sources) {
    if (!src.enabled) continue;
    const rec = cache[src.id];
    if (!rec || !Array.isArray(rec.entries) || !rec.entries.length) continue;

    for (const entry of rec.entries) {
      const titleScore = scoreTextAgainstTokens(entry.title, tokens) * 1.4;
      const bodyScore = scoreTextAgainstTokens(entry.snippet, tokens);
      const total = titleScore + bodyScore;
      if (total >= 3) {
        hits.push({
          title: entry.title,
          snippet: entry.snippet.length > 360 ? `${entry.snippet.slice(0, 357).trim()}…` : entry.snippet,
          sourceLabel: `Онлайн-источник · ${src.name}`,
          score: total,
          updatedAt: entry.updatedAt,
        });
      }
    }
  }

  return hits.sort((a, b) => b.score - a.score).slice(0, maxResults);
}
