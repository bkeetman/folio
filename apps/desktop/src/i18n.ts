import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { deTranslation } from "./locales/de";
import { enTranslation } from "./locales/en";
import { esTranslation } from "./locales/es";
import { frTranslation } from "./locales/fr";
import { itTranslation } from "./locales/it";
import { nlTranslation } from "./locales/nl";
import { plTranslation } from "./locales/pl";
import { ptTranslation } from "./locales/pt";

const STORAGE_KEY = "folio.language";

export const APP_LANGUAGE_OPTIONS = [
  { code: "en", label: "English" },
  { code: "nl", label: "Nederlands" },
  { code: "de", label: "Deutsch" },
  { code: "fr", label: "Francais" },
  { code: "es", label: "Espanol" },
  { code: "it", label: "Italiano" },
  { code: "pt", label: "Portugues" },
  { code: "pl", label: "Polski" },
] as const;

type AppLanguage = (typeof APP_LANGUAGE_OPTIONS)[number]["code"];
const SUPPORTED_LANGUAGES = new Set<AppLanguage>(APP_LANGUAGE_OPTIONS.map((option) => option.code));

function resolveSupportedLanguage(rawLanguage: string | null | undefined): AppLanguage | null {
  if (!rawLanguage) return null;

  const normalized = rawLanguage.toLowerCase().trim();
  if (SUPPORTED_LANGUAGES.has(normalized as AppLanguage)) {
    return normalized as AppLanguage;
  }

  const baseLanguage = normalized.split("-")[0].split("_")[0];
  if (SUPPORTED_LANGUAGES.has(baseLanguage as AppLanguage)) {
    return baseLanguage as AppLanguage;
  }

  return null;
}

const resources = {
  en: {
    translation: enTranslation,
  },
  nl: {
    translation: nlTranslation,
  },
  de: {
    translation: deTranslation,
  },
  fr: {
    translation: frTranslation,
  },
  es: {
    translation: esTranslation,
  },
  it: {
    translation: itTranslation,
  },
  pt: {
    translation: ptTranslation,
  },
  pl: {
    translation: plTranslation,
  },
} as const;

const storedLanguage = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
const navigatorLanguage = typeof navigator !== "undefined" ? navigator.language.toLowerCase() : "en";
const initialLanguage =
  resolveSupportedLanguage(storedLanguage) ?? resolveSupportedLanguage(navigatorLanguage) ?? "en";

void i18n.use(initReactI18next).init({
  resources,
  lng: initialLanguage,
  supportedLngs: APP_LANGUAGE_OPTIONS.map((option) => option.code),
  nonExplicitSupportedLngs: true,
  fallbackLng: "en",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (language) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, language);
  }
});

export { i18n };
