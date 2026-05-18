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
import { Textarea } from "@/components/ui/textarea";
import { useCommandForm } from "@/hooks/command/useCommandForm";

export const <%= command.pageComponent %> = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParsed();
  const defaultValues = {
<% command.prefillFields.forEach((field) => { -%>
    <%= field.name %>: searchParams.get("<%= field.name %>") ?? undefined,
<% }) -%>
  };

  const { refineCore: { onFinish }, ...form } = useCommandForm({
    resource: "<%= resource.name %>",
    command: "<%= command.name %>",
    aggregateId: id?.toString(),
    redirect: false,
    meta: {
      tableName: "<%= resource.tableName %>",
    },
    formProps: {
      defaultValues,
    },
  });

  function onSubmit(values: Record<string, unknown>) {
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
                <FormControl>
                  <<%= field.inputComponent %>
<% if (field.inputType) { -%>
                    type="<%= field.inputType %>"
<% } -%>
                    {...field}
                    value={field.value || ""}
                    placeholder="Enter <%= field.label %>"
<% if (field.rows) { -%>
                    rows={<%= field.rows %>}
<% } -%>
                  />
                </FormControl>
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
