import {
  useList,
  type BaseRecord,
  type CrudFilter,
  type IResourceItem,
} from "@refinedev/core";
import * as React from "react";

import { resources } from "@/providers/resources";
import { getCurrentLocale, LOCALE_CHANGE_EVENT } from "@/providers/i18n";

type DictionaryTranslationRecord = BaseRecord & {
  [key: string]: unknown;
};

type CapabilityProvider = {
  capability?: string;
  kind?: string;
  source?: string;
  mappings?: Record<string, string>;
};

type DictionaryTranslationProvider = {
  resource: IResourceItem;
  provider: CapabilityProvider;
};

const labelKey = (locale: string, dictionaryCode: string, valueCode: string) =>
  `${locale}\u0000${dictionaryCode}\u0000${valueCode}`;

const hasText = (value: unknown) =>
  value !== null && value !== undefined && String(value).trim().length > 0;

const findTranslationProvider = (): DictionaryTranslationProvider | undefined => {
  for (const resource of resources) {
    const providers = (resource.meta as { capabilityProviders?: CapabilityProvider[] } | undefined)
      ?.capabilityProviders ?? [];
    const provider = providers.find(
      (item) =>
        item.kind === "dictionaryTranslations" &&
        item.mappings?.code &&
        item.mappings?.value &&
        item.mappings?.locale &&
        item.mappings?.label,
    );
    if (provider) return { resource, provider };
  }
  return undefined;
};

export const dictionaryCodeFromI18nPrefix = (prefix?: string) => {
  const match = /^dictionaries\.([^.]+)\.$/.exec(prefix ?? "");
  return match?.[1];
};

export const useDictionaryTranslation = () => {
  const [locale, setLocale] = React.useState(getCurrentLocale);
  const translationProvider = React.useMemo(() => findTranslationProvider(), []);
  const translationResource = translationProvider?.resource;
  const translationMappings = translationProvider?.provider.mappings;
  const localeField = translationMappings?.locale;
  const translationMeta = translationResource?.meta as
    | (Record<string, unknown> & { dataProviderName?: string })
    | undefined;
  const translationFilters = React.useMemo<CrudFilter[] | undefined>(() => {
    if (!localeField) {
      return undefined;
    }

    const locales = new Set<string>([locale]);
    const baseLocale = locale.includes("-") ? locale.split("-")[0] : undefined;
    if (baseLocale) {
      locales.add(baseLocale);
    }

    return [
      {
        field: localeField,
        operator: "in",
        value: [...locales],
      },
    ];
  }, [locale, localeField]);

  React.useEffect(() => {
    const handleLocaleChange = () => setLocale(getCurrentLocale());
    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
  }, []);

  const translationList = useList<DictionaryTranslationRecord>({
    resource: translationResource?.name ?? "__capability_dictionary_translations_missing__",
    dataProviderName: translationMeta?.dataProviderName,
    pagination: { mode: "off" },
    filters: translationFilters,
    meta: translationMeta,
    queryOptions: {
      enabled: Boolean(translationResource && localeField),
      staleTime: 5 * 60 * 1000,
    },
  });

  const labels = React.useMemo(() => {
    const next = new Map<string, string>();
    const codeField = translationMappings?.code;
    const valueField = translationMappings?.value;
    const localeField = translationMappings?.locale;
    const labelField = translationMappings?.label;
    if (!codeField || !valueField || !localeField || !labelField) return next;

    for (const record of translationList.query.data?.data ?? []) {
      const recordLocale = record[localeField];
      const dictionaryCode = record[codeField];
      const valueCode = record[valueField];
      const displayName = record[labelField];
      if (
        hasText(recordLocale) &&
        hasText(dictionaryCode) &&
        hasText(valueCode) &&
        hasText(displayName)
      ) {
        next.set(
          labelKey(String(recordLocale), String(dictionaryCode), String(valueCode)),
          String(displayName),
        );
      }
    }
    return next;
  }, [translationList.query.data?.data, translationMappings]);

  const dictionaryLabel = React.useCallback(
    (dictionaryCode: string | undefined, value: unknown, fallback?: string) => {
      if (!dictionaryCode || value === null || value === undefined || value === "") {
        return fallback ?? "";
      }

      const valueCode = String(value);
      const exact = labels.get(labelKey(locale, dictionaryCode, valueCode));
      if (exact) return exact;

      const baseLocale = locale.includes("-") ? locale.split("-")[0] : undefined;
      if (baseLocale) {
        const base = labels.get(labelKey(baseLocale, dictionaryCode, valueCode));
        if (base) return base;
      }

      return fallback ?? valueCode;
    },
    [labels, locale],
  );

  return { dictionaryLabel, locale };
};
