#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const DEFAULT_NAMESPACE = "event-modeling:app";
const generatorRoot = path.resolve(
  process.env.CODEGEN_GENERATOR_ROOT || "/opt/codegen/.generator",
);

function camelCaseFlag(flag) {
  return flag.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function parseArgs(argv) {
  const options = {};
  const positionals = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
    const name = camelCaseFlag(rawName);
    const next = argv[index + 1];

    if (inlineValue !== undefined) {
      options[name] = inlineValue;
    } else if (next && !next.startsWith("--")) {
      options[name] = next;
      index += 1;
    } else {
      options[name] = true;
    }
  }

  return { options, positionals };
}

function isPathLike(value) {
  return value.startsWith("/") || value.startsWith(".") || value.includes(path.sep);
}

function resolveGeneratorPath(value) {
  const resolved = path.resolve(process.cwd(), value);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, "index.js");
  }
  return resolved;
}

async function main() {
  const input = process.argv.slice(2);
  const target = input[0] && isPathLike(input[0])
    ? resolveGeneratorPath(input.shift())
    : path.join(generatorRoot, "app", "index.js");
  const { options, positionals } = parseArgs(input);

  if (!fs.existsSync(target)) {
    throw new Error(`Generator entry not found: ${target}`);
  }

  const { createEnv } = await import(
    pathToFileURL(path.join(generatorRoot, "node_modules", "yeoman-environment", "dist", "index.js")).href
  );
  const env = createEnv({ cwd: process.cwd() });
  env.registerGeneratorPath(target, DEFAULT_NAMESPACE, generatorRoot);
  await env.run([DEFAULT_NAMESPACE, ...positionals], options);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || error);
  process.exit(1);
});
