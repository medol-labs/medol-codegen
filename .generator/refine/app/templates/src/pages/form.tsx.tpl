// Generated from config.json by the refine generator.
import { useNavigate } from "react-router";

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

export const <%= command.pageComponent %> = () => {
  const navigate = useNavigate();

  const { refineCore: { onFinish }, ...form } = useCommandForm({
    resource: "<%= resource.name %>",
    command: "<%= command.name %>",
    redirect: false,
  });

  function onSubmit(values: Record<string, unknown>) {
    onFinish({
      ...values,
    });
  }

  return (
    <CreateView>
      <CreateViewHeader />
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
<% if (field.boolean) { -%>
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
                    value={field.value || ""}
                    placeholder="Enter <%= field.label %>"
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
              {form.formState.isSubmitting ? "Creating..." : "Create"}
            </Button>
            <Button type="submit">Submit</Button>
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
