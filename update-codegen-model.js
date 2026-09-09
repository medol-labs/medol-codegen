#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "http://host.docker.internal:5172";

function usage() {
  console.error(`Usage: update [workspace-id] [options]

Options:
      --base-url <url>       Medol service base URL. Default: ${DEFAULT_BASE_URL}
      --url <url>            Full CodegenModel endpoint URL.
      --workspace-id <id>    Medol workspace id. Omit to export the current workspace.
      --version-id <id>      Medol workspace version id.
      --locale <locale>      Include stored Medol translations for the locale.
      --language <locale>    Alias for --locale.
      --translations <path>  Merge a local translation bundle after fetching.
  -o, --output <path>        Output file. Default: /workspace/.medol/codegen-model.json
      --source-output <path> MEDOL source output file. Default: alongside --output as source.medol
      --no-source            Do not download the MEDOL source document.
      --stdout               Print JSON to stdout instead of writing a file.
      --list-workspaces      List workspaces from the Medol service.
  -h, --help                 Show this help.

Environment:
  MEDOL_BASE_URL             Default --base-url.
  MEDOL_WORKSPACE_ID         Default --workspace-id.
  MEDOL_VERSION_ID           Default --version-id.
  CODEGEN_MODEL_LOCALE       Default --locale.
  CODEGEN_TRANSLATIONS_PATH  Default --translations.
  CODEGEN_MODEL_OUTPUT       Default --output.
  MEDOL_SOURCE_OUTPUT        Default --source-output.
`);
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function parseArgs(argv) {
  const args = argv[0] === "update" ? argv.slice(1) : argv;
  const options = {
    baseUrl: process.env.MEDOL_BASE_URL || DEFAULT_BASE_URL,
    url: process.env.CODEGEN_MODEL_URL,
    workspaceId: process.env.MEDOL_WORKSPACE_ID || process.env.CODEGEN_WORKSPACE_ID,
    versionId: process.env.MEDOL_VERSION_ID || process.env.CODEGEN_MODEL_VERSION_ID,
    locale: process.env.CODEGEN_MODEL_LOCALE || process.env.MEDOL_LOCALE,
    translationsPath: process.env.CODEGEN_TRANSLATIONS_PATH || process.env.MEDOL_TRANSLATIONS_PATH,
    output: process.env.CODEGEN_MODEL_OUTPUT || "/workspace/.medol/codegen-model.json",
    sourceOutput: process.env.MEDOL_SOURCE_OUTPUT,
    source: process.env.MEDOL_SOURCE_OUTPUT !== "false",
    stdout: false,
    listWorkspaces: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--base-url") {
      options.baseUrl = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--url") {
      options.url = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
    } else if (arg === "--workspace-id") {
      options.workspaceId = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--workspace-id=")) {
      options.workspaceId = arg.slice("--workspace-id=".length);
    } else if (arg === "--version-id") {
      options.versionId = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--version-id=")) {
      options.versionId = arg.slice("--version-id=".length);
    } else if (arg === "--locale" || arg === "--language") {
      options.locale = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--locale=") || arg.startsWith("--language=")) {
      options.locale = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "--translations" || arg === "--translation-file") {
      options.translationsPath = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--translations=") || arg.startsWith("--translation-file=")) {
      options.translationsPath = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "-o" || arg === "--output") {
      options.output = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
    } else if (arg === "--source-output") {
      options.sourceOutput = requireValue(args, index, arg);
      options.source = true;
      index += 1;
    } else if (arg.startsWith("--source-output=")) {
      options.sourceOutput = arg.slice("--source-output=".length);
      options.source = true;
    } else if (arg === "--no-source") {
      options.source = false;
    } else if (arg === "--stdout") {
      options.stdout = true;
    } else if (arg === "--list-workspaces") {
      options.listWorkspaces = true;
    } else if (!arg.startsWith("-") && !options.workspaceId) {
      options.workspaceId = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function endpointUrl(options) {
  if (options.url) return new URL(options.url);

  const url = new URL(
    options.listWorkspaces
      ? "/api/modeling/workspaces"
      : "/api/modeling/codegen-model",
    options.baseUrl
  );
  if (!options.listWorkspaces) {
    if (options.workspaceId) url.searchParams.set("workspaceId", options.workspaceId);
    if (options.versionId) url.searchParams.set("versionId", options.versionId);
    if (options.locale) url.searchParams.set("locale", options.locale);
  }
  return url;
}

async function readJson(url) {
  return (await readJsonResponse(url)).json;
}

async function readJsonResponse(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
    },
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url} failed with ${response.status}: ${body}`);
  }
  try {
    return {
      json: JSON.parse(body),
      headers: response.headers,
    };
  } catch (error) {
    throw new Error(`GET ${url} did not return valid JSON: ${error.message}`);
  }
}

function printWorkspaces(payload) {
  const workspaces = Array.isArray(payload.workspaces) ? payload.workspaces : [];
  if (workspaces.length === 0) {
    console.log("No Medol workspaces found.");
    return;
  }
  for (const workspace of workspaces) {
    console.log(`${workspace.id}\t${workspace.name ?? ""}\t${workspace.updatedAt ?? ""}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const url = endpointUrl(options);
  const response = await readJsonResponse(url);
  let json = response.json;
  if (options.listWorkspaces) {
    printWorkspaces(json);
    return;
  }

  const output = path.resolve(process.cwd(), options.output);
  const sourceOutput = path.resolve(
    process.cwd(),
    options.sourceOutput || path.join(path.dirname(options.output), "source.medol")
  );
  const localTranslations = loadLocalTranslationBundle({
    cwd: process.cwd(),
    output,
    locale: options.locale,
    translationsPath: options.translationsPath,
  });
  if (localTranslations) {
    json = withTranslationBundle(json, localTranslations.bundle, {
      localOverrides: localTranslations.explicit,
    });
    console.error(`Merged translations from ${localTranslations.paths.join(", ")}`);
  }
  reportLocaleStatus(json, options.locale);

  const content = `${JSON.stringify(json, null, 2)}\n`;
  if (options.stdout) {
    process.stdout.write(content);
    return;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
  console.error(`Wrote ${output}`);

  if (options.source) {
    const source = await readMedolSource(options, response.headers);
    fs.mkdirSync(path.dirname(sourceOutput), { recursive: true });
    fs.writeFileSync(sourceOutput, source.endsWith("\n") ? source : `${source}\n`);
    console.error(`Wrote ${sourceOutput}`);
  }
}

async function readMedolSource(options, codegenHeaders) {
  const workspaceId = options.workspaceId || codegenHeaders.get("x-medol-workspace-id");
  const versionId = options.versionId || codegenHeaders.get("x-medol-version-id");
  if (!workspaceId) {
    throw new Error("Could not resolve Medol workspace id for source download. Pass --workspace-id or --no-source.");
  }

  const payload = await readJson(sourceEndpointUrl(options, workspaceId, versionId));
  const source = versionId ? payload.version?.dsl : payload.workspace?.dsl;
  if (typeof source !== "string") {
    throw new Error("MEDOL source endpoint did not return a dsl string.");
  }
  return source;
}

function sourceEndpointUrl(options, workspaceId, versionId) {
  const workspaceSegment = encodeURIComponent(workspaceId);
  const path = versionId
    ? `/api/modeling/workspaces/${workspaceSegment}/versions/${encodeURIComponent(versionId)}`
    : `/api/modeling/workspaces/${workspaceSegment}`;
  return new URL(path, options.baseUrl);
}

function loadLocalTranslationBundle(options) {
  const paths = localTranslationCandidates(options)
    .filter((candidate) => fs.existsSync(candidate));
  if (paths.length === 0) return undefined;

  const bundles = paths
    .map((candidate) => normalizeTranslationBundle(readFileJson(candidate)))
    .filter(Boolean);
  if (bundles.length === 0) return undefined;

  return {
    paths,
    bundle: mergeTranslationBundles(bundles),
    explicit: Boolean(options.translationsPath),
  };
}

function localTranslationCandidates(options) {
  if (options.translationsPath) {
    const explicit = path.resolve(options.cwd, options.translationsPath);
    if (!fs.existsSync(explicit)) {
      throw new Error(`Translations file was not found: ${explicit}`);
    }
    return [explicit];
  }

  const roots = Array.from(new Set([
    path.dirname(options.output),
    options.cwd,
  ]));
  const names = [
    "translations.json",
    "model-translations.json",
    ...(options.locale ? [`model-translations.${options.locale}.json`] : []),
  ];
  const candidates = roots.flatMap((root) => [
    options.output,
    ...names.map((name) => path.join(root, name)),
  ]);
  return Array.from(new Set(candidates));
}

function readFileJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function normalizeTranslationBundle(bundle) {
  if (!bundle || typeof bundle !== "object") return undefined;
  const source = bundle.codegen && typeof bundle.codegen === "object"
    ? bundle.codegen
    : bundle;
  const translations = source.translations && typeof source.translations === "object"
    ? source.translations
    : undefined;
  if (!translations) return undefined;
  return {
    translations,
    ...(Array.isArray(source.locales) ? { locales: source.locales } : {}),
    ...(typeof source.defaultLocale === "string" ? { defaultLocale: source.defaultLocale } : {}),
  };
}

function withTranslationBundle(model, bundle, options = {}) {
  const translations = options.localOverrides
    ? mergeTranslationMaps(model.translations, bundle.translations)
    : mergeTranslationMaps(bundle.translations, model.translations);
  const locales = [
    ...(model.locales ?? []),
    ...(bundle.locales ?? Object.keys(bundle.translations ?? {})),
  ].filter(Boolean);
  return {
    ...model,
    translations,
    ...(locales.length > 0 ? { locales: Array.from(new Set(locales)) } : {}),
    defaultLocale: model.defaultLocale ?? bundle.defaultLocale,
  };
}

function mergeTranslationBundles(bundles) {
  return bundles.reduce((merged, bundle) => ({
    translations: mergeTranslationMaps(merged.translations, bundle.translations),
    locales: Array.from(new Set([
      ...(merged.locales ?? []),
      ...(bundle.locales ?? Object.keys(bundle.translations ?? {})),
    ].filter(Boolean))),
    defaultLocale: bundle.defaultLocale ?? merged.defaultLocale,
  }), {
    translations: {},
    locales: [],
    defaultLocale: undefined,
  });
}

function mergeTranslationMaps(...translationMaps) {
  const merged = {};
  translationMaps.filter(Boolean).forEach((translationMap) => {
    Object.entries(translationMap).forEach(([locale, translations]) => {
      merged[locale] = {
        ...(merged[locale] ?? {}),
        ...(translations ?? {}),
      };
    });
  });
  return merged;
}

function reportLocaleStatus(model, locale) {
  if (!locale) return;
  const count = Object.keys(model.translations?.[locale] ?? {}).length;
  if (count === 0) {
    console.error(`Warning: requested locale ${locale}, but no translations were returned or merged. Generate/store Medol model translations first, or provide translations.json / model-translations.${locale}.json / --translations <path>.`);
  } else {
    console.error(`Included ${count} ${locale} translations.`);
  }
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
