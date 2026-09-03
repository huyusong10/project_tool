import { match } from "pinyin-pro";

const removableArtifacts = /[\u00ad\u200b\u2060\ufeff]/gu;
const labelJoiners = /[\u200c\u200d]/gu;
const allFormatCharacters = /\p{Cf}/gu;
const bidiControls = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/u;
const unsafeControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u;
const lineBreaks = /[\r\n\u2028\u2029]/u;
const fullwidthAlphaNumeric = /[\uff10-\uff19\uff21-\uff3a\uff41-\uff5a]/gu;
const latinPinyinQuery = /^[a-z\s\u00fcv]+$/iu;
const hanText = /\p{Script=Han}/u;

export type TextSafetyIssue = "control" | "bidi" | "line_break";

export function textSafetyIssue(value: unknown, multiline = true): TextSafetyIssue | null {
  const text = String(value ?? "");
  if (unsafeControls.test(text)) return "control";
  if (bidiControls.test(text)) return "bidi";
  if (!multiline && lineBreaks.test(text)) return "line_break";
  return null;
}

function compatibilityText(value: unknown) {
  return String(value ?? "")
    .normalize("NFC")
    .replace(removableArtifacts, "")
    .replace(/\u3000/gu, " ")
    .replace(fullwidthAlphaNumeric, (character) => String.fromCharCode(character.charCodeAt(0) - 0xfee0));
}

function contentText(value: unknown) {
  return String(value ?? "").normalize("NFC").replace(removableArtifacts, "");
}

export function canonicalizeLabel(value: unknown) {
  return compatibilityText(value).replace(labelJoiners, "").replace(/\s+/gu, " ").trim();
}

export function canonicalizeContent(value: unknown) {
  return contentText(value).replace(/\r\n?/gu, "\n").trim();
}

export function normalizeSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(allFormatCharacters, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("zh-CN");
}

export type SearchField = string | null | undefined | {
  text: string | null | undefined;
  weight?: number;
  pinyin?: boolean;
};

function directScore(text: string, query: string) {
  if (!text || !query) return 0;
  if (text === query) return 1000;
  if (text.startsWith(query)) return 900;
  const index = text.indexOf(query);
  return index >= 0 ? Math.max(760, 820 - index) : 0;
}

function fieldValue(field: SearchField) {
  if (typeof field === "string" || field === null || field === undefined) {
    return { text: String(field ?? ""), weight: 0, pinyin: true };
  }
  return { text: String(field.text ?? ""), weight: field.weight || 0, pinyin: field.pinyin !== false };
}

export function searchScore(fields: SearchField[], rawQuery: unknown) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return 0;
  const compactQuery = query.replace(/\s+/gu, "");
  const values = fields.map(fieldValue);
  let best = 0;

  for (const field of values) {
    const normalized = normalizeSearchText(field.text);
    best = Math.max(best, directScore(normalized, query) + field.weight);
    if (!field.pinyin || !latinPinyinQuery.test(query) || !hanText.test(normalized)) continue;
    const indexes = match(normalized, compactQuery, {
      continuous: true,
      insensitive: true,
      space: "ignore",
      v: true,
    });
    if (indexes?.length) {
      best = Math.max(best, (indexes[0] === 0 ? 700 : 650) + field.weight - Math.min(indexes[0], 20));
    }
  }

  const tokens = query.split(" ").filter(Boolean);
  if (tokens.length > 1) {
    const joined = values.map((field) => normalizeSearchText(field.text)).join(" ");
    if (tokens.every((token) => joined.includes(token))) best = Math.max(best, 740);
  }
  return Math.max(0, best);
}

export function matchesSearch(fields: SearchField[], query: unknown) {
  return !normalizeSearchText(query) || searchScore(fields, query) > 0;
}

export function rankSearchItems<T>(items: readonly T[], query: unknown, fields: (item: T) => SearchField[]) {
  if (!normalizeSearchText(query)) return [...items];
  return items
    .map((item, index) => ({ item, index, score: searchScore(fields(item), query) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.item);
}

export function matchesPlainText(fields: Array<string | null | undefined>, rawQuery: unknown) {
  const query = normalizeSearchText(rawQuery);
  if (!query) return true;
  const joined = fields.map(normalizeSearchText).join(" ");
  return query.split(" ").filter(Boolean).every((token) => joined.includes(token));
}
