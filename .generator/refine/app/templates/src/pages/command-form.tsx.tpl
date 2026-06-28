// Generated from config.json by the refine generator.
import { useParsed } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";

import {
  CreateView,
  CreateViewHeader,
} from "@/components/refine-ui/views/create-view";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useCommandForm } from "@/hooks/command/useCommandForm";
import { zodResolver } from "@hookform/resolvers/zod";
import { <%= command.schemaName %>, type <%= command.inputTypeName %> } from "@/domain/schemas";
<% if (command.hasSelectFields) { -%>
import { ResourceSelect } from "@/components/refine-ui/form/resource-select";
<% } -%>

export const <%= command.pageComponent %> = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParsed();
  const defaultValues = {
<% command.prefillFields.forEach((field) => { -%>
    <%= field.name %>: searchParams.get("<%= field.name %>") ?? undefined,
<% }) -%>
  };

  const { refineCore: { onFinish }, ...form } = useCommandForm<<%= command.inputTypeName %>, <%= command.inputTypeName %>>({
    resource: "<%= resource.name %>",
    command: "<%= command.name %>",
    aggregateId: id?.toString(),
    redirect: false,
    meta: {
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      label: "<%= resource.label %>",
      aggregateRoute: "<%= command.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
    },
    queryMeta: {
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      label: "<%= resource.label %>",
      aggregateRoute: "<%= resource.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
    },
    formProps: {
      defaultValues,
      resolver: zodResolver(<%= command.schemaName %>),
    },
  });

  function onSubmit(values: <%= command.inputTypeName %>) {
    onFinish({
      ...defaultValues,
      ...values,
    });
  }

  return (
    <CreateView>
      <CreateViewHeader title="<%= command.label %>" />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
<% command.fields.forEach((field) => { -%>
          <FormField
            control={form.control}
            name="<%= field.name %>"
            rules={<%- field.rules %>}
            render={({ field }) => (
              <FormItem>
                <FormLabel><%= field.label %></FormLabel>
<% if (field.select) { -%>
                <ResourceSelect
                  withFormControl
                  resource="<%= field.select.resource %>"
                  dataProviderName="command"
                  optionLabel="<%= field.select.optionLabel %>"
                  optionValue="<%= field.select.optionValue %>"
                  value={field.value || ""}
                  onValueChange={field.onChange}
                  placeholder="Select <%= field.label %>"
                  meta={{
                    idField: "<%= field.select.meta.idField %>",
                    label: "<%= field.select.meta.label %>",
                    aggregateRoute: "<%= field.select.meta.aggregateRoute %>",
                    queryRoute: "<%= field.select.meta.queryRoute %>",
                  }}
                />
<% } else if (field.boolean) { -%>
                <Select
                  value={field.value === undefined || field.value === null ? undefined : String(field.value)}
                  onValueChange={(value) => field.onChange(value === "true")}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select <%= field.label %>" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="true">True</SelectItem>
                    <SelectItem value="false">False</SelectItem>
                  </SelectContent>
                </Select>
<% } else { -%>
                <FormControl>
                  <<%= field.inputComponent %>
<% if (field.inputType) { -%>
                    type="<%= field.inputType %>"
<% } -%>
                    {...field}
<% if (field.json) { -%>
                    value={typeof field.value === "string" ? field.value : JSON.stringify(field.value ?? <%- field.jsonEmptyValue %>, null, 2)}
                    onChange={(event) => field.onChange(event.target.value)}
                    placeholder={<%- JSON.stringify(field.placeholder) %>}
<% } else { -%>
                    value={field.value || ""}
                    placeholder={<%- JSON.stringify(field.placeholder) %>}
<% } -%>
<% if (field.rows) { -%>
                    rows={<%= field.rows %>}
<% } -%>
                  />
                </FormControl>
<% } -%>
                <FormMessage />
              </FormItem>
            )}
          />
<% }) -%>
          <div className="flex gap-2">
            <Button
              type="submit"
              {...form.saveButtonProps}
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? "Submitting..." : "Submit"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Form>
    </CreateView>
  );
};
