// Generated from config.json by the refine generator.
import { useShow, useTranslate } from "@refinedev/core";

import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
<% if (resource.hasLongTextFields) { -%>
import { CopyableText } from "@/components/refine-ui/fields/copyable-text";
<% } -%>
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const formatValue = (value: unknown, t: ReturnType<typeof useTranslate>) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? t("values.boolean.true", "True") : t("values.boolean.false", "False");
  return String(value);
};

export const <%= resource.component %>Show = () => {
  const t = useTranslate();
  const { result: record } = useShow({
    dataProviderName: "<%= resource.dataProviderName %>",
    meta: {
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      label: t("<%= resource.i18nKey %>", "<%= resource.label %>"),
      aggregateRoute: "<%= resource.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
      dataProviderName: "<%= resource.dataProviderName %>",
    },
  });

  return (
    <ShowView>
      <ShowViewHeader />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{record?.<%= resource.idField %> ?? t("<%= resource.i18nKey %>", "<%= resource.label %>")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
<% resource.fields.forEach((field) => { -%>
            <div>
              <h4 className="mb-2 text-sm font-medium">{t("<%= field.i18nKey %>", "<%= field.label %>")}</h4>
<% if (field.longText) { -%>
              <CopyableText value={record?.<%= field.name %>} />
<% } else { -%>
              <p className="text-sm text-muted-foreground">{formatValue(record?.<%= field.name %>, t)}</p>
<% } -%>
            </div>
            <Separator />
<% }) -%>
          </CardContent>
        </Card>
      </div>
    </ShowView>
  );
};
