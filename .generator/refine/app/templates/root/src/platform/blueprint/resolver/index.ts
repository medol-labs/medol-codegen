import type { FrontendBlueprint, ResolvedFrontendBlueprint } from "../contracts";

export type BlueprintMap = Record<string, FrontendBlueprint>;

export function resolveFrontendBlueprint(
  blueprints: readonly FrontendBlueprint[],
  selectedId = "medol-default",
): ResolvedFrontendBlueprint {
  const byId = Object.fromEntries(blueprints.map((blueprint) => [blueprint.id, blueprint]));
  const selected = byId[selectedId];

  if (!selected) {
    throw new Error(
      `MEDOL-FE-BLUEPRINT-001 Blueprint not found: ${selectedId}. Available blueprints: ${Object.keys(byId).join(", ")}`,
    );
  }

  return mergeBlueprint(selected, byId, new Set());
}

function mergeBlueprint(
  blueprint: FrontendBlueprint,
  byId: BlueprintMap,
  seen: Set<string>,
): ResolvedFrontendBlueprint {
  if (seen.has(blueprint.id)) {
    throw new Error(
      `MEDOL-FE-BLUEPRINT-002 Circular blueprint inheritance detected: ${[...seen, blueprint.id].join(" -> ")}`,
    );
  }

  if (!blueprint.extends) {
    assertCompleteBlueprint(blueprint);
    return blueprint;
  }

  const parent = byId[blueprint.extends];
  if (!parent) {
    throw new Error(
      `MEDOL-FE-BLUEPRINT-003 Parent blueprint not found: ${blueprint.extends} for ${blueprint.id}`,
    );
  }

  const mergedParent = mergeBlueprint(parent, byId, new Set([...seen, blueprint.id]));

  return {
    ...mergedParent,
    ...blueprint,
    pages: {
      ...mergedParent.pages,
      ...(blueprint.pages ?? {}),
    },
    components: {
      ...mergedParent.components,
      ...(blueprint.components ?? {}),
    },
    layouts: {
      ...mergedParent.layouts,
      ...(blueprint.layouts ?? {}),
    },
  };
}

function assertCompleteBlueprint(
  blueprint: FrontendBlueprint,
): asserts blueprint is ResolvedFrontendBlueprint {
  const missing = [
    ["pages", "list"],
    ["pages", "detail"],
    ["pages", "create"],
    ["pages", "edit"],
    ["components", "table"],
    ["components", "form"],
    ["components", "field"],
    ["components", "toolbar"],
    ["layouts", "app"],
    ["layouts", "page"],
  ].filter(([group, key]) => {
    const values = blueprint[group as "pages" | "components" | "layouts"] as
      | Record<string, unknown>
      | undefined;
    return !values?.[key];
  });

  if (missing.length > 0) {
    throw new Error(
      `MEDOL-FE-BLUEPRINT-004 Blueprint ${blueprint.id} is missing required contract: ${missing.map(([group, key]) => `${group}.${key}`).join(", ")}`,
    );
  }
}
