#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const DEFAULT_LANGUAGE = "zh-CN";
const DEFAULT_BASE_URL = "http://host.docker.internal:5172";

function usage() {
  console.error(`Usage: init [workspace-id] [options]

Options:
      --base-url <url>       Medol service base URL. Default: ${DEFAULT_BASE_URL}
      --workspace-id <id>    Medol workspace id. Omit to export the current workspace.
      --version-id <id>      Medol workspace version id.
      --language <locale>    Codegen model translation language. Default: ${DEFAULT_LANGUAGE}
      --locale <locale>      Alias for --language.
      --skip-update          Create local workspace files without fetching codegen-model.json.
      --force                Overwrite generated workspace template files.
  -h, --help                 Show this help.

Environment:
  MEDOL_BASE_URL             Default --base-url.
  MEDOL_WORKSPACE_ID         Default --workspace-id.
  MEDOL_VERSION_ID           Default --version-id.
  CODEGEN_MODEL_LOCALE       Default --language.
`);
}

function parseArgs(argv) {
  const args = argv[0] === "init" ? argv.slice(1) : argv;
  const options = {
    baseUrl: process.env.MEDOL_BASE_URL || DEFAULT_BASE_URL,
    workspaceId: process.env.MEDOL_WORKSPACE_ID || process.env.CODEGEN_WORKSPACE_ID,
    versionId: process.env.MEDOL_VERSION_ID || process.env.CODEGEN_MODEL_VERSION_ID,
    language: process.env.CODEGEN_MODEL_LOCALE || process.env.MEDOL_LOCALE || DEFAULT_LANGUAGE,
    skipUpdate: false,
    force: false,
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
    } else if (arg === "--language" || arg === "--locale") {
      options.language = requireValue(args, index, arg);
      index += 1;
    } else if (arg.startsWith("--language=") || arg.startsWith("--locale=")) {
      options.language = arg.slice(arg.indexOf("=") + 1);
    } else if (arg === "--skip-update") {
      options.skipUpdate = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (!arg.startsWith("-") && !options.workspaceId) {
      options.workspaceId = arg;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${option}`);
  }
  return value;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    return;
  }

  const root = process.cwd();
  const medolDirectory = path.join(root, ".medol");
  fs.mkdirSync(medolDirectory, { recursive: true });

  writeFileIfAllowed(path.join(medolDirectory, "medol.yml"), renderMedolYml(), options.force);
  writeFileIfAllowed(path.join(root, "README.md"), renderReadme(), options.force);
  writeFileIfAllowed(path.join(root, "AGENTS.md"), renderAgents(), options.force);
  writeFileIfAllowed(path.join(root, ".gitignore"), renderGitignore(), options.force);

  if (!options.skipUpdate) {
    runUpdate(options);
  }

  console.error("Initialized Medol system workspace.");
}

function runUpdate(options) {
  const args = [
    "--base-url",
    options.baseUrl,
    "--language",
    options.language,
    "--output",
    "/workspace/.medol/codegen-model.json",
  ];
  if (options.workspaceId) {
    args.push("--workspace-id", options.workspaceId);
  }
  if (options.versionId) {
    args.push("--version-id", options.versionId);
  }

  const result = spawnSync("update", args, {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`update failed with exitCode=${result.status}`);
  }
}

function writeFileIfAllowed(file, content, force) {
  if (!force && fs.existsSync(file)) {
    console.error(`Kept existing ${file}`);
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.error(`Wrote ${file}`);
}

function renderMedolYml() {
  return [
    "name: Medol Generated System",
    "",
    "generators:",
    "  axon5:",
    "    output: backend",
    "  refine:",
    "    output: console",
    "  operations:",
    "    output: .",
    "",
    "operations:",
    "  # Configure this only when images are pushed to a registry.",
    "  # registry:",
    "  #   host: registry.internal:5000",
    "  #   scheme: http",
    "  #   namespace: team",
    "  #   insecure: true",
    "",
    "workspaceFiles:",
    "  overwrite: false",
    "",
  ].join("\n");
}

function renderReadme() {
  return [
    "# Medol Generated System",
    "",
    "This repository is a Medol generated system workspace.",
    "",
    "## Layout",
    "",
    "- `.medol/codegen-model.json` is exported from Medol and consumed by generators.",
    "- `.medol/medol.yml` configures generator output directories and operations settings.",
    "- `operations/` contains generated deployment and operations assets.",
    "",
    "## Generation",
    "",
    "Run generators from this repository root.",
    "",
  ].join("\n");
}

function renderAgents() {
  return [
    "# AGENTS.md",
    "",
    "- Treat `.medol/codegen-model.json` and `.medol/medol.yml` as system-level generation inputs.",
    "- Do not hand-edit generated backend `context/` code unless explicitly requested for an emergency local fix.",
    "- Put hand-written backend adapters under `infrastructure/` and hand-written decision overrides under `domain/`.",
    "- If a framework-level generated behavior is wrong, update `es-code-generator` templates instead of patching generated outputs.",
    "- Do not put concrete business-system behavior into the generator; express business behavior in the Medol model or generated project extension points.",
    "",
  ].join("\n");
}

function renderGitignore() {
  return [
    ".env",
    "**/.env",
    "**/target/",
    "**/build/",
    "**/dist/",
    "**/node_modules/",
    "**/.venv/",
    "volumes/",
    "operations/**/.work/",
    "deployment-compose-files/",
    "",
  ].join("\n");
}

main();
