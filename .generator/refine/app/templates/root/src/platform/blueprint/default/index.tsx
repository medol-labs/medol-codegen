import type {
  BlueprintRenderProps,
  DetailPageModel,
  FieldModel,
  FormPageModel,
  ListPageModel,
  ResolvedFrontendBlueprint,
} from "../contracts";
import type { ReactNode } from "react";

function DefaultLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

function DefaultPageLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section>
      <h1 className="sr-only">{title}</h1>
      {children}
    </section>
  );
}

function DefaultListPage({ model }: BlueprintRenderProps<ListPageModel>) {
  return <DefaultPageLayout title={model.title}>Default list page</DefaultPageLayout>;
}

function DefaultDetailPage({ model }: BlueprintRenderProps<DetailPageModel>) {
  return <DefaultPageLayout title={model.title}>Default detail page</DefaultPageLayout>;
}

function DefaultFormPage({ model }: BlueprintRenderProps<FormPageModel>) {
  return <DefaultPageLayout title={model.title}>Default form page</DefaultPageLayout>;
}

function DefaultTable(_props: BlueprintRenderProps<ListPageModel>) {
  return null;
}

function DefaultForm(_props: BlueprintRenderProps<FormPageModel>) {
  return null;
}

function DefaultField(_props: BlueprintRenderProps<FieldModel>) {
  return null;
}

function DefaultToolbar(_props: BlueprintRenderProps<ListPageModel | FormPageModel>) {
  return null;
}

export const medolDefaultBlueprint: ResolvedFrontendBlueprint = {
  id: "medol-default",
  pages: {
    list: DefaultListPage,
    detail: DefaultDetailPage,
    create: DefaultFormPage,
    edit: DefaultFormPage,
  },
  components: {
    table: DefaultTable,
    form: DefaultForm,
    field: DefaultField,
    toolbar: DefaultToolbar,
  },
  layouts: {
    app: DefaultLayout,
    page: DefaultPageLayout,
  },
};
