import type { SearchMode, SearchSource } from "./types";

const SEARCH_RESULT_LIMIT = 5;
const SEARCH_SNIPPET_LIMIT = 700;

const CURRENT_WEB_PATTERNS = [
  /\b(latest|current|currently|today|tonight|tomorrow|yesterday|recent|recently|newest|this week|this month|this year)\b/i,
  /\b(news|weather|forecast|temperature|exchange rate|stock price|market price|score|standings|election|president|prime minister)\b/i,
  /\b(what happened|who won|release date|released|version|update|availability|available now|price|cost|hours|opening hours)\b/i,
  /\b(search|look up|find online|on the web|according to|source|sources|cite|verify|fact check|fact-check)\b/i,
  /\b(outdated|up to date|up-to-date|are you sure|you are confused|you're confused|i don't know|do you know|that's wrong|you are wrong)\b/i,
];

interface TavilySearchResult {
  title?: string | null;
  url?: string | null;
  content?: string | null;
  published_date?: string | null;
}

interface TavilySearchResponse {
  results?: TavilySearchResult[];
}

export function shouldUseWebSearch(query: string, mode: SearchMode): boolean {
  if (mode === "off" || !query.trim()) return false;
  if (mode === "always") return true;
  return CURRENT_WEB_PATTERNS.some((pattern) => pattern.test(query));
}

function cleanText(value: string | null | undefined, maxLength: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

export async function searchWeb(query: string): Promise<SearchSource[]> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey || !query.trim()) return [];

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: query.trim(),
      search_depth: "basic",
      max_results: SEARCH_RESULT_LIMIT,
      topic: "general",
      include_answer: false,
      include_raw_content: false,
      include_published_date: true,
      include_usage: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Tavily search failed (${response.status})${detail ? `: ${cleanText(detail, 180)}` : ""}`);
  }

  const payload = (await response.json()) as TavilySearchResponse;
  return (payload.results ?? [])
    .filter((result): result is TavilySearchResult & { url: string } => Boolean(result.url))
    .map((result, index) => ({
      id: `${index + 1}`,
      title: cleanText(result.title || result.url, 160) || result.url,
      url: result.url,
      snippet: cleanText(result.content, SEARCH_SNIPPET_LIMIT),
      publishedDate: result.published_date ?? undefined,
    }));
}

export function formatSearchContext(sources: SearchSource[]): string {
  if (sources.length === 0) return "";
  return [
    "The following web search context is current information retrieved for this user request. Use it when relevant, prefer it over stale assumptions, and cite claims with the matching [n] source marker. Do not invent facts or sources. If the context does not answer the question, say so.",
    ...sources.map(
      (source) =>
        `[${source.id}] ${source.title}\nURL: ${source.url}${source.snippet ? `\nExcerpt: ${source.snippet}` : ""}`
    ),
  ].join("\n\n");
}
