const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

function runAgentTask({ runtime }) {
  const agentDir = path.resolve(__dirname, "..");
  const projectRoot = path.resolve(agentDir, "..");
  const tasksPath = path.join(agentDir, "tasks.json");
  const outDir = path.join(agentDir, "out");

  ensureTasksFile(tasksPath);
  fs.mkdirSync(outDir, { recursive: true });

  const taskFile = readTasks(tasksPath);
  const task = taskFile.tasks.find((candidate) => ["queued", "pending"].includes(candidate.status || "queued"));

  if (!task) {
    console.log("[ralph] no queued tasks");
    return;
  }

  task.status = "running";
  task.startedAt = new Date().toISOString();
  writeTasks(tasksPath, taskFile);

  const prompt = buildPrompt({ agentDir, projectRoot, task, runtime });
  const promptPath = path.join(outDir, `${safeName(task.id || task.title || "task")}.prompt.md`);
  fs.writeFileSync(promptPath, prompt, "utf8");
  console.log(`[ralph] prompt written: ${path.relative(projectRoot, promptPath)}`);

  const command = resolveCommand(runtime);
  if (!command) {
    task.status = "needs-runtime";
    task.promptPath = path.relative(projectRoot, promptPath);
    task.finishedAt = new Date().toISOString();
    writeTasks(tasksPath, taskFile);
    console.log("[ralph] no agent runtime found; set AGENT_COMMAND or install the selected CLI");
    return;
  }

  const result = childProcess.spawnSync(command, {
    cwd: projectRoot,
    input: prompt,
    shell: true,
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env,
  });

  task.promptPath = path.relative(projectRoot, promptPath);
  task.finishedAt = new Date().toISOString();
  task.status = result.status === 0 ? "done" : "failed";
  task.exitCode = result.status;
  if (result.error) task.error = result.error.message;
  writeTasks(tasksPath, taskFile);

  if (result.status !== 0) {
    process.exitCode = result.status || 1;
  }
}

function ensureTasksFile(tasksPath) {
  if (!fs.existsSync(tasksPath)) {
    fs.writeFileSync(tasksPath, "[]\n", "utf8");
  }
}

function readTasks(tasksPath) {
  const raw = fs.readFileSync(tasksPath, "utf8").trim();
  const parsed = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed)) return { shape: "array", tasks: parsed };
  if (parsed && Array.isArray(parsed.tasks)) return { shape: "object", tasks: parsed.tasks, extra: parsed };
  throw new Error(".agent/tasks.json must be an array or an object with a tasks array");
}

function writeTasks(tasksPath, taskFile) {
  const data = taskFile.shape === "object" ? { ...taskFile.extra, tasks: taskFile.tasks } : taskFile.tasks;
  fs.writeFileSync(tasksPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function buildPrompt({ agentDir, projectRoot, task, runtime }) {
  const skillNames = normalizeSkills(task.skills);
  const skillBlocks = skillNames.map((skillName) => readSkill(agentDir, skillName)).filter(Boolean);
  const files = findContextFiles(projectRoot);

  return [
    `# Ralph Task: ${task.title || task.id || "Untitled Task"}`,
    "",
    `Runtime: ${runtime}`,
    `Project root: ${projectRoot}`,
    `Task id: ${task.id || "(none)"}`,
    "",
    "## User Task",
    "",
    task.prompt || task.description || task.title || "",
    "",
    "## Requested Skills",
    "",
    skillNames.map((skill) => `- ${skill}`).join("\n") || "- medol-generated-code",
    "",
    "## Project Context Files",
    "",
    files.map((file) => `- ${path.relative(projectRoot, file)}`).join("\n") || "- No standard MEDOL context files found.",
    "",
    "## Skill Instructions",
    "",
    skillBlocks.join("\n\n---\n\n"),
    "",
    "## Operating Rules",
    "",
    "- Read the relevant project files before editing.",
    "- Keep generated-code changes narrow; update MEDOL or generator templates for repeatable changes.",
    "- Verify with the smallest useful build or test command.",
    "- Update `.agent/tasks.json` if task status needs a manual note.",
    "",
  ].join("\n");
}

function normalizeSkills(skills) {
  const requested = Array.isArray(skills) ? skills.filter(Boolean) : [];
  const defaults = ["load-medol-context", "medol-generated-code"];
  return Array.from(new Set([...defaults, ...requested]));
}

function readSkill(agentDir, skillName) {
  const skillPath = resolveSkillPath(agentDir, skillName);
  if (!fs.existsSync(skillPath)) {
    return `# Missing Skill: ${skillName}\n\nNo file found at ${path.relative(agentDir, skillPath)}.`;
  }
  return fs.readFileSync(skillPath, "utf8");
}

function resolveSkillPath(agentDir, skillName) {
  const normalized = String(skillName).replace(/\\/g, "/").replace(/^\/+/, "");
  const direct = path.join(agentDir, "skills", normalized, "SKILL.md");
  if (fs.existsSync(direct)) return direct;

  const axon5BackendAliases = new Set(["build-state-change", "build-read-model", "build-automation"]);
  if (axon5BackendAliases.has(normalized)) {
    return path.join(agentDir, "skills", "axon5-backend", normalized, "SKILL.md");
  }

  return direct;
}

function findContextFiles(projectRoot) {
  return ["codegen-model.json", "translations.json", "translation.json", "README.md"]
    .map((file) => path.join(projectRoot, file))
    .filter((file) => fs.existsSync(file));
}

function resolveCommand(runtime) {
  if (process.env.AGENT_COMMAND) return process.env.AGENT_COMMAND;
  if (runtime === "claude" && commandExists("claude")) return "claude -p";
  if (runtime === "codex" && commandExists("codex")) return "codex exec";
  return null;
}

function commandExists(command) {
  const result = childProcess.spawnSync("sh", ["-lc", `command -v ${shellQuote(command)}`], {
    env: process.env,
    stdio: "ignore",
  });
  return result.status === 0;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function safeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "task";
}

module.exports = { runAgentTask };
