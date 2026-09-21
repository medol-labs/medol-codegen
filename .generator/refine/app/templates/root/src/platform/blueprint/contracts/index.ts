import type { ComponentType, ReactNode } from "react";

export type ListPageModel = {
  id: string;
  resource: string;
  title: string;
  query: string;
  columns: readonly FieldModel[];
  actions: readonly ActionModel[];
  extensionPoints: readonly string[];
};

export type DetailPageModel = {
  id: string;
  resource: string;
  title: string;
  fields: readonly FieldModel[];
  actions: readonly ActionModel[];
  extensionPoints: readonly string[];
};

export type FormPageModel = {
  id: string;
  resource: string;
  command: string;
  title: string;
  fields: readonly FieldModel[];
  behaviorTarget: string;
  extensionPoints: readonly string[];
};

export type FieldModel = {
  name: string;
  label: string;
  tsType: string;
  required?: boolean;
};

export type ActionModel = {
  id: string;
  label: string;
  target: string;
};

export type BlueprintRenderProps<Model> = {
  model: Model;
  children?: ReactNode;
};

export type ResolvedFrontendBlueprint = {
  id: string;
  pages: {
    list: ComponentType<BlueprintRenderProps<ListPageModel>>;
    detail: ComponentType<BlueprintRenderProps<DetailPageModel>>;
    create: ComponentType<BlueprintRenderProps<FormPageModel>>;
    edit: ComponentType<BlueprintRenderProps<FormPageModel>>;
  };
  components: {
    table: ComponentType<BlueprintRenderProps<ListPageModel>>;
    form: ComponentType<BlueprintRenderProps<FormPageModel>>;
    field: ComponentType<BlueprintRenderProps<FieldModel>>;
    toolbar: ComponentType<BlueprintRenderProps<ListPageModel | FormPageModel>>;
  };
  layouts: {
    app: ComponentType<{ children: ReactNode }>;
    page: ComponentType<{ title: string; children: ReactNode }>;
  };
};

export type FrontendBlueprint = {
  id: string;
  extends?: string;
  pages?: Partial<ResolvedFrontendBlueprint["pages"]>;
  components?: Partial<ResolvedFrontendBlueprint["components"]>;
  layouts?: Partial<ResolvedFrontendBlueprint["layouts"]>;
};
