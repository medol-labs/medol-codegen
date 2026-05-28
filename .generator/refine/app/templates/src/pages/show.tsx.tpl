// Generated from config.json by the refine generator.
import { useShow } from "@refinedev/core";

import { ShowView, ShowViewHeader } from "@/components/refine-ui/views/show-view";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
};

export const <%= resource.component %>Show = () => {
  const { result: record } = useShow({
    meta: {
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      label: "<%= resource.label %>",
      aggregateRoute: "<%= resource.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
    },
  });

  return (
    <ShowView>
      <ShowViewHeader />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>{record?.<%= resource.idField %> ?? "<%= resource.label %>"}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
<% resource.fields.forEach((field) => { -%>
            <div>
              <h4 className="mb-2 text-sm font-medium"><%= field.label %></h4>
              <p className="text-sm text-muted-foreground">{formatValue(record?.<%= field.name %>)}</p>
            </div>
            <Separator />
<% }) -%>
          </CardContent>
        </Card>
      </div>
    </ShowView>
  );
};
