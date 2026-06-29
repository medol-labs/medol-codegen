#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const agentDir = __dirname;
const projectRoot = path.resolve(agentDir, "..");
const tasksPath = path.join(agentDir, "tasks.json");

const workspaceId = process.env.MEDOL_WORKSPACE_ID;
const apiBaseUrl = (process.env.MEDOL_AGENT_API_URL || "http://127.0.0.1:5172/api/agent").replace(/\/$/, "");
const status = process.env.MEDOL_SLICE_STATUS || "planned";

if (!workspaceId) {
  console.error("[agent-sync] MEDOL_WORKSPACE_ID is required");
  process.exit(1);
}

main().catch((error) => {
  console.error("[agent-sync] failed:", error);
  process.exit(1);
});

async function main() {
  ensureTasksFile(tasksPath);
  const plannedSlices = await fetchPlannedSlices();
  const taskFile = readTasks(tasksPath);
  const model = readCodegenModel(projectRoot);
  let created = 0;

  for (const plannedSlice of plannedSlices) {
    const taskId = taskIdFor(plannedSlice);
    if (taskFile.tasks.some((task) => task.id === taskId)) continue;

    const modelSlice = findModelSlice(model, plannedSlice);
    taskFile.tasks.push({
      id: taskId,
      status: "queued",
      title: `Implement ${plannedSlice.contextName}.${plannedSlice.sliceName}`,
      prompt: buildPrompt(plannedSlice, modelSlice),
      skills: chooseSkills(modelSlice),
      source: {
        type: "medol-slice-status",
        workspaceId,
        sliceId: plannedSlice.sliceId,
        contextName: plannedSlice.contextName,
        sliceName: plannedSlice.sliceName,
        status: plannedSlice.status
      },
      createdAt: new Date().toISOString()
    });
    created += 1;
  }

  writeTasks(tasksPath, taskFile);
  console.log(`[agent-sync] planned=${plannedSlices.length} created=${created}`);
}

async function fetchPlannedSlices() {
  const url = new URL(`${apiBaseUrl}/slice-statuses`);
  url.searchParams.set("workspaceId", workspaceId);
  url.searchParams.set("status", status);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }
  const body = await response.json();
  return Array.isArray(body.slices) ? body.slices : [];
}

function ensureTasksFile(filePath) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, "[]\n", "utf8");
  }
}

function readTasks(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const parsed = raw ? JSON.parse(raw) : [];
  if (Array.isArray(parsed)) return { shape: "array", tasks: parsed };
  if (parsed && Array.isArray(parsed.tasks)) return { shape: "object", tasks: parsed.tasks, extra: parsed };
  throw new Error(".agent/tasks.json must be an array or an object with a tasks array");
}

function writeTasks(filePath, taskFile) {
  const data = taskFile.shape === "object" ? { ...taskFile.extra, tasks: taskFile.tasks } : taskFile.tasks;
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function readCodegenModel(root) {
  const modelPath = path.join(root, "codegen-model.json");
  if (!fs.existsSync(modelPath)) return undefined;
  return JSON.parse(fs.readFileSync(modelPath, "utf8"));
}

function findModelSlice(model, plannedSlice) {
  return model?.slices?.find((slice) => {
    return slice.name === plannedSlice.sliceName
      || slice.title === plannedSlice.sliceName
      || (slice.context === plannedSlice.contextName && slice.name === plannedSlice.sliceName);
  });
}

function chooseSkills(slice) {
  const skills = ["load-medol-context", "build-slice", "fix-generation-error", "update-task-status"];
  if (!slice) return skills;
  if (Array.isArray(slice.commands) && slice.commands.length > 0) {
    skills.push("axon5-backend/build-state-change");
  }
  if (Array.isArray(slice.readmodels) && slice.readmodels.length > 0) {
    skills.push("axon5-backend/build-read-model", "build-refine-resource");
  }
  if (Array.isArray(slice.processors) && slice.processors.length > 0) {
    skills.push("axon5-backend/build-automation");
  }
  return Array.from(new Set(skills));
}

function buildPrompt(plannedSlice, modelSlice) {
  const summary = modelSlice
    ? [
        `Commands: ${names(modelSlice.commands)}`,
        `Events: ${names(modelSlice.events)}`,
        `Read models: ${names(modelSlice.readmodels)}`,
        `Processors: ${names(modelSlice.processors)}`
      ].join("\n")
    : "The slice was planned in MEDOL, but no matching slice was found in codegen-model.json. Load context and report the mismatch before editing code.";

  return [
    `Implement the MEDOL planned slice ${plannedSlice.contextName}.${plannedSlice.sliceName}.`,
    "",
    summary,
    "",
    "Use the generated project conventions, update only the required backend/frontend files, and verify with the smallest useful build or test command."
  ].join("\n");
}

function names(items) {
  return Array.isArray(items) && items.length
    ? items.map((item) => item.name || item.title).filter(Boolean).join(", ")
    : "none";
}

function taskIdFor(slice) {
  return `medol-${safeName(slice.contextName)}-${safeName(slice.sliceName)}-${safeName(slice.sliceId)}`;
}

function safeName(value) {
  return String(value || "slice")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "slice";
}
