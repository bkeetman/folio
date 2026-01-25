const isbnRegex = /\b(?:97[89][\s-]?)?\d{1,5}[\s-]?\d{1,7}[\s-]?\d{1,7}[\s-]?[\dX]\b/g;

export function extractIsbnCandidates(text: string): string[] {
  const matches = text.match(isbnRegex) ?? [];
  const normalized = matches
    .map((value) => normalizeIsbn(value))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(normalized));
}

export function normalizeIsbn(value: string): string | undefined {
  const cleaned = value.replace(/[^0-9X]/gi, "").toUpperCase();
  if (cleaned.length === 10 && isValidIsbn10(cleaned)) return cleaned;
  if (cleaned.length === 13 && isValidIsbn13(cleaned)) return cleaned;
  return undefined;
}

function isValidIsbn10(value: string): boolean {
  let sum = 0;
  for (let i = 0; i < 9; i += 1) {
    const digit = Number(value[i]);
    if (Number.isNaN(digit)) return false;
    sum += digit * (10 - i);
  }
  const check = value[9] === "X" ? 10 : Number(value[9]);
  if (Number.isNaN(check)) return false;
  sum += check;
  return sum % 11 === 0;
}

function isValidIsbn13(value: string): boolean {
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const digit = Number(value[i]);
    if (Number.isNaN(digit)) return false;
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const check = Number(value[12]);
  if (Number.isNaN(check)) return false;
  return (10 - (sum % 10)) % 10 === check;
}
