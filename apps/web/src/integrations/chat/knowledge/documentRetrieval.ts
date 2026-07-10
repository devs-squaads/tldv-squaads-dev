import { CHAT_DOCUMENT_CORPUS, type KnowledgeDocument } from "@/integrations/chat/knowledge/documentCorpus";

const DEFAULT_TOP_K = 4;
const MAX_SNIPPET_LENGTH = 280;

export interface RetrievedSnippet {
  id: string;
  title: string;
  score: number;
  snippet: string;
}

const STOPWORDS = new Set([
  "de",
  "la",
  "el",
  "los",
  "las",
  "y",
  "o",
  "u",
  "en",
  "con",
  "por",
  "para",
  "que",
  "como",
  "qué",
  "cual",
  "cuál",
  "un",
  "una",
  "del",
  "al",
  "se",
  "me",
  "mi",
  "tu",
  "su",
  "es",
  "son",
  "lo",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function countTokenMatches(haystackTokens: string[], needleTokens: string[]): number {
  if (!needleTokens.length) return 0;
  const haystack = new Set(haystackTokens);
  let matches = 0;
  for (const token of needleTokens) {
    if (haystack.has(token)) matches++;
  }
  return matches;
}

function scoreDocument(query: string, queryTokens: string[], doc: KnowledgeDocument): number {
  const normalizedQuery = normalize(query);
  const searchable = `${doc.title} ${doc.tags.join(" ")} ${doc.content}`;
  const normalizedDoc = normalize(searchable);
  const docTokens = tokenize(searchable);

  const tokenMatches = countTokenMatches(docTokens, queryTokens);
  const tokenCoverage = queryTokens.length > 0 ? tokenMatches / queryTokens.length : 0;
  const exactPhraseBoost = normalizedQuery.length > 4 && normalizedDoc.includes(normalizedQuery) ? 0.35 : 0;
  const titleHitBoost = queryTokens.some((token) => normalize(doc.title).includes(token)) ? 0.2 : 0;

  return tokenCoverage + exactPhraseBoost + titleHitBoost;
}

function toSnippet(content: string): string {
  if (content.length <= MAX_SNIPPET_LENGTH) return content;
  return `${content.slice(0, MAX_SNIPPET_LENGTH - 1).trimEnd()}…`;
}

export function retrieveKnowledgeSnippets(
  query: string,
  input: { topK?: number } = {},
): RetrievedSnippet[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [];

  const queryTokens = tokenize(query);
  const topK = Math.max(1, Math.min(8, input.topK ?? DEFAULT_TOP_K));

  return CHAT_DOCUMENT_CORPUS
    .map((doc) => ({ doc, score: scoreDocument(query, queryTokens, doc) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ doc, score }) => ({
      id: doc.id,
      title: doc.title,
      score,
      snippet: toSnippet(doc.content),
    }));
}
