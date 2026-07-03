// Generated from config.json by the refine generator.
import { useParsed } from "@refinedev/core";
import { useTranslate } from "@refinedev/core";
import { useNavigate, useSearchParams } from "react-router";
<% if (command.hasArrayFields) { -%>
import type { Control } from "react-hook-form";
import { useFieldArray } from "react-hook-form";
<% } -%>
<% if (command.hasArrayFields) { -%>
import { Plus, Trash2 } from "lucide-react";
<% } -%>

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

<% if (command.hasArrayFields) { -%>
type ScalarArrayFieldProps = {
  control: Control<any>;
  name: string;
  label: string;
  inputType?: string | null;
  itemDefaultValue: string | number | boolean;
};

function ScalarArrayField({
  control,
  name,
  label,
  inputType,
  itemDefaultValue,
}: ScalarArrayFieldProps) {
  return (
    <FormField
      control={control}
      name={name as never}
      render={({ field }) => {
        const values = Array.isArray(field.value) ? field.value : [];

        return (
          <FormItem>
            <div className="flex items-center justify-between gap-2">
              <FormLabel>{label}</FormLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => field.onChange([...values, itemDefaultValue])}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <div className="space-y-2">
              {values.map((value, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    type={inputType ?? undefined}
                    value={value ?? ""}
                    onChange={(event) => {
                      const next = [...values];
                      next[index] = inputType === "number"
                        ? Number(event.target.value)
                        : event.target.value;
                      field.onChange(next);
                    }}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => field.onChange(values.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
            </div>
            <FormMessage />
          </FormItem>
        );
      }}
    />
  );
}
<% } -%>

export const <%= command.pageComponent %> = () => {
  const t = useTranslate();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParsed();
  const defaultValues = {
<% command.prefillFields.forEach((field) => { -%>
    <%= field.name %>: searchParams.get("<%= field.name %>") ?? undefined,
<% }) -%>
<% command.defaultValueFields.forEach((field) => { -%>
    <%= field.name %>: <%- field.defaultValue %>,
<% }) -%>
  };

  const { refineCore: { onFinish }, ...form } = useCommandForm<<%= command.inputTypeName %>, <%= command.inputTypeName %>>({
    resource: "<%= resource.name %>",
    command: "<%= command.name %>",
    aggregateId: id?.toString(),
    redirect: false,
    dataProviderName: "<%= command.dataProviderName %>",
    queryDataProviderName: "<%= resource.dataProviderName %>",
    meta: {
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      label: t("<%= resource.i18nKey %>", "<%= resource.label %>"),
      aggregateRoute: "<%= command.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
      dataProviderName: "<%= command.dataProviderName %>",
    },
    queryMeta: {
      tableName: "<%= resource.tableName %>",
      idField: "<%= resource.idField %>",
      label: t("<%= resource.i18nKey %>", "<%= resource.label %>"),
      aggregateRoute: "<%= resource.aggregateRoute %>",
      queryRoute: "<%= resource.queryRoute %>",
      dataProviderName: "<%= resource.dataProviderName %>",
    },
    formProps: {
      defaultValues,
      resolver: zodResolver(<%= command.schemaName %>),
    },
  });
<% command.fields.filter((field) => field.object && field.list).forEach((field) => { -%>
  const <%= field.fieldArrayName %> = useFieldArray({
    control: form.control,
    name: "<%= field.name %>" as never,
  });
<% }) -%>

  function onSubmit(values: <%= command.inputTypeName %>) {
    onFinish({
      ...defaultValues,
      ...values,
    });
  }

  return (
    <CreateView>
      <CreateViewHeader title={t("<%= command.i18nKey %>", "<%= command.label %>")} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
<% command.fields.forEach((field) => { -%>
<% if (field.object && field.list) { -%>
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex items-center justify-between gap-2">
              <FormLabel>{t("<%= field.i18nKey %>", "<%= field.label %>")}</FormLabel>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => <%= field.fieldArrayName %>.append(<%- field.defaultValue %> as never)}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            {<%= field.fieldArrayName %>.fields.map((item, index) => (
              <div key={item.id} className="space-y-4 rounded-md border p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium">{t("<%= field.i18nKey %>", "<%= field.label %>")} {index + 1}</div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => <%= field.fieldArrayName %>.remove(index)}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
<% field.nestedFields.forEach((nestedField) => { -%>
<% if (nestedField.scalarList) { -%>
                  <ScalarArrayField
                    control={form.control}
                    name={`<%= field.name %>.${index}.<%= nestedField.name %>`}
                    label={t("<%= nestedField.i18nKey %>", "<%= nestedField.label %>")}
                    inputType={<%- nestedField.inputType ? JSON.stringify(nestedField.inputType) : 'null' %>}
                    itemDefaultValue={<%- nestedField.scalarListItemDefaultValue %>}
                  />
<% } else { -%>
                  <FormField
                    control={form.control}
                    name={`<%= field.name %>.${index}.<%= nestedField.name %>` as never}
                    rules={<%- nestedField.rules %>}
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("<%= nestedField.i18nKey %>", "<%= nestedField.label %>")}</FormLabel>
<% if (nestedField.boolean) { -%>
                        <Select
                          value={field.value === undefined || field.value === null ? undefined : String(field.value)}
                          onValueChange={(value) => field.onChange(value === "true")}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("<%= nestedField.placeholderKey %>", "Select <%= nestedField.label %>")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="true">{t("values.boolean.true", "True")}</SelectItem>
                            <SelectItem value="false">{t("values.boolean.false", "False")}</SelectItem>
                          </SelectContent>
                        </Select>
<% } else { -%>
                        <FormControl>
                          <<%= nestedField.inputComponent %>
<% if (nestedField.inputType) { -%>
                            type="<%= nestedField.inputType %>"
<% } -%>
                            {...field}
                            value={field.value ?? ""}
                            placeholder={t("<%= nestedField.placeholderKey %>", <%- JSON.stringify(nestedField.placeholder) %>)}
<% if (nestedField.rows) { -%>
                            rows={<%= nestedField.rows %>}
<% } -%>
                          />
                        </FormControl>
<% } -%>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
<% } -%>
<% }) -%>
                </div>
              </div>
            ))}
          </div>
<% } else if (field.object) { -%>
          <div className="space-y-4 rounded-md border p-4">
            <FormLabel>{t("<%= field.i18nKey %>", "<%= field.label %>")}</FormLabel>
            <div className="grid gap-4 md:grid-cols-2">
<% field.nestedFields.forEach((nestedField) => { -%>
<% if (nestedField.scalarList) { -%>
              <ScalarArrayField
                control={form.control}
                name="<%= field.name %>.<%= nestedField.name %>"
                label={t("<%= nestedField.i18nKey %>", "<%= nestedField.label %>")}
                inputType={<%- nestedField.inputType ? JSON.stringify(nestedField.inputType) : 'null' %>}
                itemDefaultValue={<%- nestedField.scalarListItemDefaultValue %>}
              />
<% } else { -%>
              <FormField
                control={form.control}
                name="<%= field.name %>.<%= nestedField.name %>"
                rules={<%- nestedField.rules %>}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("<%= nestedField.i18nKey %>", "<%= nestedField.label %>")}</FormLabel>
<% if (nestedField.boolean) { -%>
                    <Select
                      value={field.value === undefined || field.value === null ? undefined : String(field.value)}
                      onValueChange={(value) => field.onChange(value === "true")}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("<%= nestedField.placeholderKey %>", "Select <%= nestedField.label %>")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="true">{t("values.boolean.true", "True")}</SelectItem>
                        <SelectItem value="false">{t("values.boolean.false", "False")}</SelectItem>
                      </SelectContent>
                    </Select>
<% } else { -%>
                    <FormControl>
                      <<%= nestedField.inputComponent %>
<% if (nestedField.inputType) { -%>
                        type="<%= nestedField.inputType %>"
<% } -%>
                        {...field}
                        value={field.value ?? ""}
                        placeholder={t("<%= nestedField.placeholderKey %>", <%- JSON.stringify(nestedField.placeholder) %>)}
<% if (nestedField.rows) { -%>
                        rows={<%= nestedField.rows %>}
<% } -%>
                      />
                    </FormControl>
<% } -%>
                    <FormMessage />
                  </FormItem>
                )}
              />
<% } -%>
<% }) -%>
            </div>
          </div>
<% } else if (field.scalarList) { -%>
          <ScalarArrayField
            control={form.control}
            name="<%= field.name %>"
            label={t("<%= field.i18nKey %>", "<%= field.label %>")}
            inputType={<%- field.inputType ? JSON.stringify(field.inputType) : 'null' %>}
            itemDefaultValue={<%- field.scalarListItemDefaultValue %>}
          />
<% } else { -%>
          <FormField
            control={form.control}
            name="<%= field.name %>"
            rules={<%- field.rules %>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("<%= field.i18nKey %>", "<%= field.label %>")}</FormLabel>
<% if (field.select) { -%>
                <ResourceSelect
                  withFormControl
                  resource="<%= field.select.resource %>"
                  dataProviderName="<%= field.select.dataProviderName %>"
                  optionLabel="<%= field.select.optionLabel %>"
                  optionValue="<%= field.select.optionValue %>"
                  value={field.value || ""}
                  onValueChange={field.onChange}
                  placeholder={t("<%= field.placeholderKey %>", "Select <%= field.label %>")}
                  meta={{
                    idField: "<%= field.select.meta.idField %>",
                    label: t("<%= field.i18nKey %>", "<%= field.select.meta.label %>"),
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
                      <SelectValue placeholder={t("<%= field.placeholderKey %>", "Select <%= field.label %>")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="true">{t("values.boolean.true", "True")}</SelectItem>
                    <SelectItem value="false">{t("values.boolean.false", "False")}</SelectItem>
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
                    placeholder={t("<%= field.placeholderKey %>", <%- JSON.stringify(field.placeholder) %>)}
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
<% } -%>
<% }) -%>
          <div className="flex gap-2">
            <Button
              type="submit"
              {...form.saveButtonProps}
              disabled={form.formState.isSubmitting}
            >
              {form.formState.isSubmitting ? t("buttons.submitting", "Submitting...") : t("buttons.submit", "Submit")}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
            >
              {t("buttons.cancel", "Cancel")}
            </Button>
          </div>
        </form>
      </Form>
    </CreateView>
  );
};
