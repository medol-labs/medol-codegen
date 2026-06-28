// Generated from config.json by the refine generator.
export const defaultLocale = <%- JSON.stringify(defaultLocale) %>;

export const messages = <%- JSON.stringify(messages, null, 2) %> as const;

export type SupportedLocale = keyof typeof messages;

export const supportedLocales = Object.keys(messages) as SupportedLocale[];
