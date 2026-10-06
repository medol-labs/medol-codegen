// Generated from config.json by the refine generator.
import { useShow, useTranslate } from "@refinedev/core";

import { frontendComposition } from "@/app/composition/composition.resolved";
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
import { useDictionaryTranslation } from "@/lib/dictionary-i18n";
import { Separator } from "@/components/ui/separator";
import { renderFieldOverride } from "@/platform/composition";

const formatValue = (
  value: unknown,
  t: ReturnType<typeof useTranslate>,
  dictionaryLabel: ReturnType<typeof useDictionaryTranslation>["dictionaryLabel"],
  options?: Array<{ label: string; value: string }>,
  dictionaryCode?: string,
): string => {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value)) {
    const formatted: string[] = value.map((item) => formatValue(item, t, dictionaryLabel, options, dictionaryCode)).filter((item) => item !== "-");
    return formatted.length > 0 ? formatted.join(", ") : "-";
  }
  if (typeof value === "boolean") return value ? t("values.boolean.true", "True") : t("values.boolean.false", "False");
  const stringValue = String(value);
  if (dictionaryCode) return dictionaryLabel(dictionaryCode, stringValue, t(`dictionaries.${dictionaryCode}.${stringValue}`, stringValue));
  return options?.find((option) => option.value === stringValue)?.label ?? stringValue;
};

export const <%= resource.component %>Show = () => {
  const t = useTranslate();
  const { dictionaryLabel } = useDictionaryTranslation();
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
              {renderFieldOverride(frontendComposition, "field:<%= resource.route %>:display:<%= field.name %>", { value: record?.<%= field.name %>, record, resource: "<%= resource.route %>", field: "<%= field.name %>", view: "display" }) ?? <CopyableText value={record?.<%= field.name %>} />}
<% } else { -%>
              {renderFieldOverride(frontendComposition, "field:<%= resource.route %>:display:<%= field.name %>", { value: record?.<%= field.name %>, record, resource: "<%= resource.route %>", field: "<%= field.name %>", view: "display" }) ?? <p className="text-sm text-muted-foreground">{formatValue(record?.<%= field.name %>, t, dictionaryLabel<% if (field.enumOptions.length > 0) { -%>, [
<% field.enumOptions.forEach((option) => { -%>
                { label: t("<%= option.i18nKey %>", <%- JSON.stringify(option.label) %>), value: <%- JSON.stringify(option.value) %> },
<% }) -%>
              ]<% } else { -%>, undefined<% } -%><% if (field.dictionary) { -%>, "<%= field.dictionary %>"<% } -%>)}</p>}
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
