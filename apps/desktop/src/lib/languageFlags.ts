/**
 * Maps ISO 639-1 language codes to country flag emojis.
 * Uses the most common country for each language.
 */
const languageToFlag: Record<string, string> = {
  // Major languages
  en: "🇬🇧", // English -> UK (could also use 🇺🇸)
  nl: "🇳🇱", // Dutch -> Netherlands
  de: "🇩🇪", // German -> Germany
  fr: "🇫🇷", // French -> France
  es: "🇪🇸", // Spanish -> Spain
  it: "🇮🇹", // Italian -> Italy
  pt: "🇵🇹", // Portuguese -> Portugal
  ru: "🇷🇺", // Russian -> Russia
  zh: "🇨🇳", // Chinese -> China
  ja: "🇯🇵", // Japanese -> Japan
  ko: "🇰🇷", // Korean -> South Korea
  ar: "🇸🇦", // Arabic -> Saudi Arabia
  fa: "🇮🇷", // Persian (Farsi)
  ur: "🇵🇰", // Urdu
  bn: "🇧🇩", // Bengali

  // European languages
  pl: "🇵🇱", // Polish
  cs: "🇨🇿", // Czech
  sv: "🇸🇪", // Swedish
  da: "🇩🇰", // Danish
  no: "🇳🇴", // Norwegian
  fi: "🇫🇮", // Finnish
  el: "🇬🇷", // Greek
  hu: "🇭🇺", // Hungarian
  ro: "🇷🇴", // Romanian
  bg: "🇧🇬", // Bulgarian
  uk: "🇺🇦", // Ukrainian
  hr: "🇭🇷", // Croatian
  sk: "🇸🇰", // Slovak
  sl: "🇸🇮", // Slovenian
  sr: "🇷🇸", // Serbian
  mk: "🇲🇰", // Macedonian
  sq: "🇦🇱", // Albanian
  bs: "🇧🇦", // Bosnian
  ca: "🇪🇸", // Catalan
  eu: "🇪🇸", // Basque
  gl: "🇪🇸", // Galician
  ga: "🇮🇪", // Irish
  cy: "🇬🇧", // Welsh
  is: "🇮🇸", // Icelandic
  mt: "🇲🇹", // Maltese
  lb: "🇱🇺", // Luxembourgish
  lt: "🇱🇹", // Lithuanian
  lv: "🇱🇻", // Latvian
  et: "🇪🇪", // Estonian

  // Other languages
  tr: "🇹🇷", // Turkish
  he: "🇮🇱", // Hebrew
  hi: "🇮🇳", // Hindi
  th: "🇹🇭", // Thai
  vi: "🇻🇳", // Vietnamese
  id: "🇮🇩", // Indonesian
  ms: "🇲🇾", // Malay
  tl: "🇵🇭", // Tagalog/Filipino
  sw: "🇹🇿", // Swahili
  af: "🇿🇦", // Afrikaans
  ta: "🇮🇳", // Tamil
  te: "🇮🇳", // Telugu
  ml: "🇮🇳", // Malayalam
  mr: "🇮🇳", // Marathi
  gu: "🇮🇳", // Gujarati
  pa: "🇮🇳", // Punjabi
  kk: "🇰🇿", // Kazakh
  uz: "🇺🇿", // Uzbek
  be: "🇧🇾", // Belarusian
  ka: "🇬🇪", // Georgian
  hy: "🇦🇲", // Armenian
  az: "🇦🇿", // Azerbaijani

  // Regional variants
  "en-US": "🇺🇸",
  "en-GB": "🇬🇧",
  "en-AU": "🇦🇺",
  "pt-BR": "🇧🇷",
  "zh-CN": "🇨🇳",
  "zh-TW": "🇹🇼",
  "es-MX": "🇲🇽",
  "es-AR": "🇦🇷",
  "fr-CA": "🇨🇦",
};

/**
 * Maps ISO 639-1 language codes to human-readable names.
 */
const languageNames: Record<string, string> = {
  en: "English",
  nl: "Nederlands",
  de: "Deutsch",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  ru: "Русский",
  zh: "中文",
  ja: "日本語",
  ko: "한국어",
  ar: "العربية",
  fa: "فارسی",
  ur: "اردو",
  bn: "বাংলা",
  pl: "Polski",
  cs: "Čeština",
  sv: "Svenska",
  da: "Dansk",
  no: "Norsk",
  fi: "Suomi",
  el: "Ελληνικά",
  hu: "Magyar",
  ro: "Română",
  bg: "Български",
  uk: "Українська",
  hr: "Hrvatski",
  sk: "Slovenčina",
  sl: "Slovenščina",
  sr: "Srpski",
  mk: "Македонски",
  sq: "Shqip",
  bs: "Bosanski",
  ca: "Català",
  eu: "Euskara",
  gl: "Galego",
  ga: "Gaeilge",
  cy: "Cymraeg",
  is: "Íslenska",
  mt: "Malti",
  lb: "Lëtzebuergesch",
  lt: "Lietuvių",
  lv: "Latviešu",
  et: "Eesti",
  tr: "Türkçe",
  he: "עברית",
  hi: "हिन्दी",
  th: "ไทย",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  ms: "Bahasa Melayu",
  tl: "Tagalog",
  sw: "Kiswahili",
  af: "Afrikaans",
  ta: "தமிழ்",
  te: "తెలుగు",
  ml: "മലയാളം",
  mr: "मराठी",
  gu: "ગુજરાતી",
  pa: "ਪੰਜਾਬੀ",
  kk: "Қазақша",
  uz: "O'zbek",
  be: "Беларуская",
  ka: "ქართული",
  hy: "Հայերեն",
  az: "Azərbaycan dili",
};

const unknownLanguageCodes = new Set(["und", "unknown", "unk", "n/a", "na", "none", "null", ""]);

export const LANGUAGE_OPTIONS = Object.entries(languageNames)
  .map(([code, name]) => ({
    code,
    name,
    flag: getLanguageFlag(code),
  }))
  .sort((left, right) => left.name.localeCompare(right.name));

/**
 * Get the flag emoji for a language code.
 * Returns undefined if the language is not recognized.
 */
export function getLanguageFlag(languageCode: string | null | undefined): string | undefined {
  if (!languageCode) return undefined;

  // Try exact match first (for regional variants like en-US)
  const normalized = languageCode.toLowerCase().trim();
  if (unknownLanguageCodes.has(normalized)) return undefined;
  if (languageToFlag[normalized]) {
    return languageToFlag[normalized];
  }

  // Try the base language code (en from en-US)
  const baseCode = normalized.split("-")[0].split("_")[0];
  return languageToFlag[baseCode];
}

/**
 * Get the human-readable name for a language code.
 * Returns the code itself if not recognized.
 */
export function getLanguageName(languageCode: string | null | undefined): string {
  if (!languageCode) return "Unknown";

  const normalized = languageCode.toLowerCase().trim();
  if (unknownLanguageCodes.has(normalized)) return "Unknown";
  const baseCode = normalized.split("-")[0].split("_")[0];

  if (unknownLanguageCodes.has(baseCode)) return "Unknown";
  return languageNames[baseCode] ?? languageCode.toUpperCase();
}

export function isKnownLanguageCode(languageCode: string | null | undefined): boolean {
  if (!languageCode) return false;
  const normalized = languageCode.toLowerCase().trim();
  const baseCode = normalized.split("-")[0].split("_")[0];
  return !unknownLanguageCodes.has(normalized) && !unknownLanguageCodes.has(baseCode);
}

/**
 * Get both flag and name for display.
 */
export function getLanguageDisplay(languageCode: string | null | undefined): {
  flag: string | undefined;
  name: string;
  code: string;
} {
  const code = languageCode?.toLowerCase().trim() ?? "";
  return {
    flag: getLanguageFlag(code),
    name: getLanguageName(code),
    code: code || "unknown",
  };
}
