#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_BASE_URL = "http://host.docker.internal:5172";

function usage() {
  console.error(`Usage: fetch-codegen-model [options]

Options:
      --base-url <url>       Medol service base URL. Default: ${DEFAULT_BASE_URL}
      --url <url>            Full CodegenModel endpoint URL.
      --workspace-id <id>    Medol workspace id. Defaults to the latest workspace.
      --version-id <id>      Medol workspace version id.
      --locale <locale>      Include stored Medol translations for the locale.
      --language <locale>    Alias for --locale.
  -o, --output <path>        Output file. Default: /workspace/codegen-model.json
      --stdout               Print JSON to stdout instead of writing a file.
      --list-workspaces      List workspaces from the Medol service.
  -h, --help                 Show this help.

Environment:
  MEDOL_BASE_URL             Default --base-url.
  MEDOL_WORKSPACE_ID         Default --workspace-id.
  MEDOL_VERSION_ID           Default --version-id.
  CODEGEN_MODEL_LOCALE       Default --locale.
  CODEGEN_MODEL_OUTPUT       Default --output.
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
  const options = {
    baseUrl: process.env.MEDOL_BASE_URL || DEFAULT_BASE_URL,
    url: process.env.CODEGEN_MODEL_URL,
    workspaceId: process.env.MEDOL_WORKSPACE_ID || process.env.CODEGEN_WORKSPACE_ID,
    versionId: process.env.MEDOL_VERSION_ID || process.env.CODEGEN_MODEL_VERSION_ID,
    locale: process.env.CODEGEN_MODEL_LOCALE || process.env.MEDOL_LOCALE,
    output: process.env.CODEGEN_MODEL_OUTPUT || "/workspace/codegen-model.json",
    stdout: false,
    listWorkspaces: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--base-url") {
      options.baseUrl = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
    } else if (arg === "--url") {
      options.url = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--url=")) {
      options.url = arg.slice("--url=".length);
    } else if (arg === "--workspace-id") {
      options.workspaceId = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--workspace-id=")) {
      options.workspaceId = arg.slice("--workspace-id=".length);
    } else if (arg === "--version-id") {
      options.versionId = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--version-id=")) {
      options.versionId = arg.slice("--version-id=".length);
    } else if (arg === "--locale" || arg === "--language") {
      options.locale = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--locale=") || arg.startsWith("--language=")) {
      options.locale = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "-o" || arg === "--output") {
      options.output = requireValue(argv, index, arg);
      index += 1;
    } else if (arg.startsWith("--output=")) {
      options.output = arg.slice("--output=".length);
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
    return JSON.parse(body);
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
  const json = await readJson(url);
  if (options.listWorkspaces) {
    printWorkspaces(json);
    return;
  }

  const content = `${JSON.stringify(json, null, 2)}\n`;
  if (options.stdout) {
    process.stdout.write(content);
    return;
  }

  const output = path.resolve(process.cwd(), options.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, content);
  console.error(`Wrote ${output}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
