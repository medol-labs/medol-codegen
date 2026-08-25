type RuntimeAppConfig = Record<string, string | undefined>;

declare global {
  interface Window {
    __APP_CONFIG__?: RuntimeAppConfig;
  }
}

export function getAppConfig(name: string, fallback = ""): string {
  const runtimeValue = window.__APP_CONFIG__?.[name];
  if (runtimeValue !== undefined && runtimeValue !== "") {
    return runtimeValue;
  }

  const buildValue = import.meta.env[name] as string | undefined;
  if (buildValue !== undefined && buildValue !== "") {
    return buildValue;
  }

  return fallback;
}
