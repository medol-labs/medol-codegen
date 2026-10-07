import type { I18nProvider } from "@refinedev/core";
import { defaultLocale, messages, supportedLocales, type SupportedLocale } from "@/contexts/i18n/messages";

export const LOCALE_STORAGE_KEY = "refine.locale";
export const LOCALE_CHANGE_EVENT = "refine.localechange";
let currentLocale: SupportedLocale = defaultLocale;

export function normalizeSupportedLocale(locale: string | null | undefined): SupportedLocale | undefined {
  if (!locale) {
    return undefined;
  }

  if (Object.prototype.hasOwnProperty.call(messages, locale)) {
    return locale as SupportedLocale;
  }

  const normalized = locale.toLowerCase();
  return supportedLocales.find((supportedLocale) => supportedLocale.toLowerCase() === normalized);
}

export function isSupportedLocale(locale: string | null): locale is SupportedLocale {
  return normalizeSupportedLocale(locale) !== undefined;
}

export function getPersistedLocale(): SupportedLocale | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const locale = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return normalizeSupportedLocale(locale);
}

export function getCurrentLocale(): SupportedLocale {
  return currentLocale;
}

export { supportedLocales };
export type { SupportedLocale };

export const i18nProvider: I18nProvider = {
  translate: (key, params, defaultMessage) => {
    const locale = currentLocale;
    const fallback = typeof params === "string" && defaultMessage === undefined ? params : defaultMessage;
    const localeMessages = messages[locale] as Record<string, string>;
    const defaultMessages = messages[defaultLocale] as Record<string, string>;
    const value = localeMessages?.[key] ?? defaultMessages?.[key] ?? fallback ?? key;

    if (!params || typeof params === "string" || typeof value !== "string") {
      return value;
    }

    return Object.entries(params).reduce(
      (text, [name, replacement]) => text.replaceAll(`{{${name}}}`, String(replacement)),
      value,
    );
  },
  changeLocale: async (locale) => {
    const supportedLocale = normalizeSupportedLocale(locale);
    if (supportedLocale) {
      currentLocale = supportedLocale;
    }

    if (typeof window !== "undefined" && supportedLocale) {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, currentLocale);
      window.dispatchEvent(new CustomEvent(LOCALE_CHANGE_EVENT, { detail: currentLocale }));
    }
  },
  getLocale: () => currentLocale,
};
