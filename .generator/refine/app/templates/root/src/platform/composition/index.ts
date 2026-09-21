import { createElement } from "react";
import type { ComponentType, ReactElement, ReactNode } from "react";

export type ExtensionLayer = "blueprint" | "generated" | "extension" | "override";

export type ExtensionTarget = {
  id: string;
  kind: "resource" | "page" | "table" | "form" | "field" | "action" | "behavior";
  resource?: string;
  view?: string;
  field?: string;
  fallback?: string;
  slots: readonly string[];
};

export type ExtensionDefinition<Props = unknown> = {
  id: string;
  target: string;
  slot: string;
  order?: number;
  component?: ComponentType<Props>;
};

export type OverrideDefinition =
  | {
      target: string;
      type: "page";
      implementation: ReactElement;
    }
  | {
      target: string;
      type: "component" | "behavior";
      implementation: unknown;
    };

export type FieldRendererProps<RecordType = unknown> = {
  value: unknown;
  record?: RecordType;
  resource: string;
  field: string;
  view: string;
  compact?: boolean;
};

export type FieldRendererComponent<RecordType = unknown> = ComponentType<
  FieldRendererProps<RecordType>
>;

export type SlotExtensionProps<RecordType = unknown> = {
  resource: string;
  record?: RecordType;
  table?: unknown;
};

export type FormBehaviorExtension<TVariables = unknown> = {
  beforeSubmit?: (value: TVariables) => Promise<TVariables | void> | TVariables | void;
  afterSubmit?: (value: TVariables, result: unknown) => Promise<void> | void;
  validate?: (value: TVariables) => Promise<Record<string, string> | void> | Record<string, string> | void;
  mapCommandPayload?: (value: TVariables) => unknown;
};

export type FrontendBlueprintRegistration = {
  id: string;
  extends?: string;
  layer?: "medol-default" | "organization" | "project";
};

export type FrontendComposition = {
  targets: readonly ExtensionTarget[];
  blueprints: readonly FrontendBlueprintRegistration[];
  extensions: readonly ExtensionDefinition[];
  overrides: readonly OverrideDefinition[];
};

export type FrontendCompositionGenerated = FrontendComposition;

export type FrontendCompositionCustom = Partial<
  Pick<FrontendComposition, "blueprints" | "extensions" | "overrides">
>;

export function resolveFrontendComposition(
  generated: FrontendCompositionGenerated,
  custom: FrontendCompositionCustom,
): FrontendComposition {
  const resolved = {
    targets: generated.targets,
    blueprints: [...generated.blueprints, ...(custom.blueprints ?? [])],
    extensions: [...generated.extensions, ...(custom.extensions ?? [])].sort(
      (left, right) => (left.order ?? 0) - (right.order ?? 0),
    ),
    overrides: [...generated.overrides, ...(custom.overrides ?? [])],
  };

  validateResolvedComposition(resolved);

  return resolved;
}

export function renderFieldOverride<RecordType = unknown>(
  composition: FrontendComposition,
  target: string,
  props: FieldRendererProps<RecordType>,
): ReactNode | undefined {
  const override = composition.overrides.find(
    (item) => item.type === "component" && item.target === target,
  );

  if (!override) {
    return undefined;
  }

  const Component = override.implementation as FieldRendererComponent<RecordType>;
  return createElement(Component, props);
}

export function renderSlotExtensions<RecordType = unknown>(
  composition: FrontendComposition,
  target: string,
  slot: string,
  props: SlotExtensionProps<RecordType>,
): ReactNode[] {
  return composition.extensions
    .filter((extension) => extension.target === target && extension.slot === slot)
    .map((extension) =>
      extension.component
        ? createElement(extension.component as ComponentType<SlotExtensionProps<RecordType>>, {
            ...props,
            key: extension.id,
          })
        : null,
    )
    .filter((item) => item !== null) as ReactNode[];
}

export async function runFormBehavior<TVariables>(
  composition: FrontendComposition,
  target: string,
  values: TVariables,
  submit: (values: TVariables) => Promise<unknown>,
) {
  const behavior = composition.overrides.find(
    (item) => item.type === "behavior" && item.target === target,
  )?.implementation as FormBehaviorExtension<TVariables> | undefined;

  if (!behavior) {
    return submit(values);
  }

  const validationErrors = await behavior.validate?.(values);
  if (validationErrors && Object.keys(validationErrors).length > 0) {
    throw new Error(
      Object.entries(validationErrors)
        .map(([field, message]) => `${field}: ${message}`)
        .join("; "),
    );
  }

  const beforeSubmitValues = await behavior.beforeSubmit?.(values);
  const nextValues = (beforeSubmitValues ?? values) as TVariables;
  const payload = behavior.mapCommandPayload
    ? (behavior.mapCommandPayload(nextValues) as TVariables)
    : nextValues;
  const result = await submit(payload);
  await behavior.afterSubmit?.(nextValues, result);
  return result;
}

function validateResolvedComposition(composition: FrontendComposition) {
  const targets = new Map(composition.targets.map((target) => [target.id, target]));
  const extensionIds = new Set<string>();
  const overrideTargets = new Set<string>();

  for (const extension of composition.extensions) {
    if (extensionIds.has(extension.id)) {
      throw new Error(`MEDOL-FE-EXT-002 Duplicate extension id: ${extension.id}`);
    }
    extensionIds.add(extension.id);

    const target = targets.get(extension.target);
    if (!target) {
      throw new Error(
        `MEDOL-FE-EXT-001 Extension target not found: ${extension.target}. Available targets: ${[...targets.keys()].join(", ")}`,
      );
    }

    if (!target.slots.includes(extension.slot)) {
      throw new Error(
        `MEDOL-FE-EXT-003 Extension slot not found: ${extension.slot} on ${extension.target}. Available slots: ${target.slots.join(", ")}`,
      );
    }
  }

  for (const override of composition.overrides) {
    if (overrideTargets.has(override.target)) {
      throw new Error(`MEDOL-FE-EXT-004 Duplicate override target: ${override.target}`);
    }
    overrideTargets.add(override.target);

    if (!targets.has(override.target)) {
      throw new Error(
        `MEDOL-FE-EXT-005 Override target not found: ${override.target}. Available targets: ${[...targets.keys()].join(", ")}`,
      );
    }
  }
}
