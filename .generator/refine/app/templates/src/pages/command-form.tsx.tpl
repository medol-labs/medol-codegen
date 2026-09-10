// Generated from config.json by the refine generator.
import { useParsed<% if (command.hasHistoryPrefillFields) { -%>, useList<% } -%> } from "@refinedev/core";
import { useTranslate } from "@refinedev/core";
<% if (command.hasFileFields) { -%>
import { useNotification } from "@refinedev/core";
<% } -%>
<% const reactImports = []; if (command.hasFileFields || command.hasResultFields) reactImports.push('useState'); if (command.hasHistoryPrefillFields) reactImports.push('useEffect'); -%>
<% if (reactImports.length) { -%>
import { <%= reactImports.join(', ') %> } from "react";
<% } -%>
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
<% if (command.hasResultFields) { -%>
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
<% } -%>
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
import { <%= command.schemaName %>, type <%= command.inputTypeName %> } from "@/contexts/domain/schemas";
<% if (command.hasSelectFields) { -%>
import { ResourceMultiSelect, ResourceSelect } from "@/components/refine-ui/form/resource-select";
<% } -%>
<% if (command.hasFileFields) { -%>
import { uploadFile, type PendingFileUpload } from "@/lib/upload-file";
<% } -%>
<% if (command.hasArrayFields) { -%>
type ScalarArrayFieldProps = {
  control: Control<any>;
  name: string;
  label: string;
  inputType?: string | null;
  itemDefaultValue: string | number | boolean;
  options?: Array<{ value: string; label: string }>;
};

function ScalarArrayField({
  control,
  name,
  label,
  inputType,
  itemDefaultValue,
  options,
}: ScalarArrayFieldProps) {
  const optionItems = options ?? [];

  return (
    <FormField
      control={control}
      name={name as never}
      render={({ field }) => {
        const values = (Array.isArray(field.value) ? field.value : []) as Array<string | number | boolean>;

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
<%_ /* Runtime branch: enum-like scalar arrays render each item as a Select. */ _%>
                  {optionItems.length > 0 ? (
                    <Select
                      value={value === undefined || value === null ? undefined : String(value)}
                      onValueChange={(nextValue) => {
                        const next = [...values];
                        next[index] = nextValue;
                        field.onChange(next);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder={label} />
                      </SelectTrigger>
                      <SelectContent>
                        {optionItems.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                  <Input
                    type={inputType ?? undefined}
                    value={typeof value === "boolean" ? String(value) : value ?? ""}
                    onChange={(event) => {
                      const next = [...values];
                      next[index] = inputType === "number"
                        ? Number(event.target.value)
                        : event.target.value;
                      field.onChange(next);
                    }}
                  />
                  )}
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
<% if (command.hasFileFields) { -%>
  const { open } = useNotification();
<% } -%>
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { id } = useParsed();
<% if (command.hasFileFields) { -%>
  const [pendingFileUploads, setPendingFileUploads] = useState<Record<string, PendingFileUpload | undefined>>({});
<% } -%>
<% if (command.hasResultFields) { -%>
  const [commandResult, setCommandResult] = useState<Record<string, unknown> | null>(null);
<% } -%>
  const defaultValues = {
<% command.prefillFields.forEach((field) => { -%>
    <%= field.name %>: <%- field.searchParamDefault %>,
<% }) -%>
<% command.defaultValueFields.forEach((field) => { -%>
    <%= field.name %>: <%- field.defaultValue %>,
<% }) -%>
  } as unknown as Partial<<%= command.inputTypeName %>>;

  const { refineCore: { onFinish }, ...form } = useCommandForm<<%= command.inputTypeName %>, <%= command.inputTypeName %>>({
    resource: "<%= resource.name %>",
    command: "<%= command.name %>",
    aggregateId: id?.toString(),
    redirect: <%- command.hasResultFields ? 'false' : '"list"' %>,
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
<% if (command.fileUploadProducer) { -%>
      resolver: zodResolver(<%= command.schemaName %>.pick({
<% command.fields.forEach((field) => { -%>
        <%= field.name %>: true,
<% }) -%>
      })) as never,
<% } else { -%>
      resolver: zodResolver(<%= command.schemaName %>) as never,
<% } -%>
    },
  });
<% command.historyPrefillFields.forEach((field) => { -%>
  const <%= field.fieldName %>History = useList<Record<string, unknown>>({
    resource: "<%= field.resource %>",
    dataProviderName: "<%= field.dataProviderName %>",
    pagination: { currentPage: 1, pageSize: 1000, mode: "server" },
    filters: defaultValues.<%= field.contextField %>
      ? [{ field: "<%= field.contextField %>", operator: "eq", value: defaultValues.<%= field.contextField %> }]
      : [],
    meta: {
      tableName: "<%= field.meta.tableName %>",
      idField: "<%= field.meta.idField %>",
      label: "<%= field.meta.label %>",
      aggregateRoute: "<%= field.meta.aggregateRoute %>",
      queryRoute: "<%= field.meta.queryRoute %>",
      queryFields: <%- JSON.stringify(field.meta.queryFields ?? []) %>,
    },
    queryOptions: {
      enabled: Boolean(defaultValues.<%= field.contextField %>),
    },
  });

  useEffect(() => {
    const values = (<%= field.fieldName %>History.result.data ?? [])
      .map((item: Record<string, unknown>) => item.<%= field.valueField %>)
      .filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0);
    const current = form.getValues("<%= field.fieldName %>" as never) as unknown;
    if (values.length > 0 && (!Array.isArray(current) || current.length === 0)) {
      form.setValue("<%= field.fieldName %>" as never, Array.from(new Set(values)) as never, { shouldDirty: false });
    }
  }, [<%= field.fieldName %>History.result.data, form]);
<% }) -%>
<% command.fields.filter((field) => field.object && field.list).forEach((field) => { -%>
  const <%= field.fieldArrayName %> = useFieldArray({
    control: form.control,
    name: "<%= field.name %>" as never,
  });
<% }) -%>
<% if (command.hasFileFields) { -%>

  function setPendingFile(fieldName: string, file: File | undefined, onChange: (value: string) => void) {
    const uploadId = file ? crypto.randomUUID() : "";
    setPendingFileUploads((current) => ({
      ...current,
      [fieldName]: file ? { file, uploadId } : undefined,
    }));
    onChange(uploadId);
  }
<% } -%>

  async function onSubmit(values: <%= command.inputTypeName %>) {
<% if (command.hasFileFields) { -%>
    const nextValues = {
      ...defaultValues,
      ...values,
    } as <%= command.inputTypeName %>;
<% command.fileFields.forEach((field) => { -%>
<% if (command.fileUploadProducer || !field.optional) { -%>
    if (!pendingFileUploads.<%= field.name %>) {
      open?.({
        type: "error",
        message: t("notifications.fileUpload.required", "File is required"),
        description: t("notifications.fileUpload.chooseFile", "Choose a file before submitting."),
      });
      return;
    }
<% } -%>
    if (pendingFileUploads.<%= field.name %>) {
      let uploadedId: string;
      try {
        uploadedId = await uploadFile({
          file: pendingFileUploads.<%= field.name %>!.file,
          uploadId: pendingFileUploads.<%= field.name %>!.uploadId,
          source: "<%= resource.name %>.<%= command.name %>.<%= field.name %>",
          values: {
            ...nextValues,
            <%= field.name %>: pendingFileUploads.<%= field.name %>!.uploadId,
          } as Record<string, unknown>,
        });
      } catch (error) {
        open?.({
          type: "error",
          message: t("notifications.fileUpload.failed", "File upload failed"),
          description: error instanceof Error ? error.message : String(error),
        });
        return;
      }
      nextValues.<%= field.name %> = uploadedId as never;
<% if (command.fileUploadProducer) { -%>
      open?.({
        type: "success",
        message: t("notifications.fileUpload.staged", "File staged"),
        description: uploadedId,
      });
<% } -%>
    }
<% }) -%>
<% if (command.fileUploadProducer) { -%>
    navigate(-1);
    return;
<% } else { -%>
    const result = await onFinish(nextValues);
    navigate("/<%= resource.route %>");
    return result;
<% } -%>
<% } else { -%>
<% if (command.hasResultFields) { -%>
    const result = await onFinish({
      ...defaultValues,
      ...values,
    }) as { data?: Record<string, unknown> } | Record<string, unknown> | void;
    const data = result && typeof result === "object" && "data" in result
      ? result.data
      : result;
    if (data && typeof data === "object") {
      setCommandResult(data as Record<string, unknown>);
    }
    return result;
<% } else { -%>
    const result = await onFinish({
      ...defaultValues,
      ...values,
    });
    navigate("/<%= resource.route %>");
    return result;
<% } -%>
<% } -%>
  }

  return (
    <CreateView>
      <CreateViewHeader title={t("<%= command.i18nKey %>", "<%= command.label %>")} />
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, (errors) => console.error("<%= command.component %> validation failed", errors))} className="space-y-8">
<% command.hiddenPrefillFields.forEach((field) => { -%>
          {defaultValues.<%= field.name %> !== undefined && defaultValues.<%= field.name %> !== null ? (
            <input type="hidden" {...form.register("<%= field.name %>" as never)} />
          ) : null}
<% }) -%>
<% command.snapshotFields.forEach((field) => { -%>
          <input type="hidden" {...form.register("<%= field.name %>" as never)} />
<% }) -%>
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
                    options={<%- nestedField.enumOptions && nestedField.enumOptions.length ? JSON.stringify(nestedField.enumOptions.map((option) => ({ value: option.value, label: option.label }))) : 'undefined' %>}
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
<% } else if (nestedField.enumOptions && nestedField.enumOptions.length) { -%>
                        <Select
                          value={field.value === undefined || field.value === null ? undefined : String(field.value)}
                          onValueChange={field.onChange}
                        >
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder={t("<%= nestedField.placeholderKey %>", "Select <%= nestedField.label %>")} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
<% nestedField.enumOptions.forEach((option) => { -%>
                            <SelectItem value="<%= option.value %>">{t("<%= option.i18nKey %>", "<%= option.label %>")}</SelectItem>
<% }) -%>
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
                options={<%- nestedField.enumOptions && nestedField.enumOptions.length ? JSON.stringify(nestedField.enumOptions.map((option) => ({ value: option.value, label: option.label }))) : 'undefined' %>}
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
<% } else if (nestedField.enumOptions && nestedField.enumOptions.length) { -%>
                    <Select
                      value={field.value === undefined || field.value === null ? undefined : String(field.value)}
                      onValueChange={field.onChange}
                    >
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder={t("<%= nestedField.placeholderKey %>", "Select <%= nestedField.label %>")} />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
<% nestedField.enumOptions.forEach((option) => { -%>
                        <SelectItem value="<%= option.value %>">{t("<%= option.i18nKey %>", "<%= option.label %>")}</SelectItem>
<% }) -%>
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
<% } else if (field.select && field.scalarList) { -%>
          <FormField
            control={form.control}
            name="<%= field.name %>"
            rules={<%- field.rules %>}
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("<%= field.i18nKey %>", "<%= field.label %>")}</FormLabel>
                <ResourceMultiSelect
                  withFormControl
                  resource="<%= field.select.resource %>"
                  dataProviderName="<%= field.select.dataProviderName %>"
                  optionLabel="<%= field.select.optionLabel %>"
                  optionValue="<%= field.select.optionValue %>"
                  value={Array.isArray(field.value) ? field.value : []}
                  onValueChange={field.onChange}
                  placeholder={t("<%= field.placeholderKey %>", "Select <%= field.label %>")}
                  searchPlaceholder={t("<%= field.placeholderKey %>.search", "Search <%= field.label %>")}
<% if (field.select.filters?.length) { -%>
                  filters={<%- JSON.stringify(field.select.filters) %>}
<% } -%>
<% if (field.select.sorters?.length) { -%>
                  sorters={<%- JSON.stringify(field.select.sorters) %>}
<% } -%>
<% if (field.select.pagination) { -%>
                  pagination={<%- JSON.stringify(field.select.pagination) %>}
<% } -%>
                  meta={{
                    idField: "<%= field.select.meta.idField %>",
                    label: t("<%= field.i18nKey %>", "<%= field.select.meta.label %>"),
                    aggregateRoute: "<%= field.select.meta.aggregateRoute %>",
                    queryRoute: "<%= field.select.meta.queryRoute %>",
<% if (field.select.meta.queryFields?.length) { -%>
                    queryFields: <%- JSON.stringify(field.select.meta.queryFields) %>,
<% } -%>
                  }}
                />
                <FormMessage />
              </FormItem>
            )}
          />
<% } else if (field.scalarList) { -%>
          <ScalarArrayField
            control={form.control}
            name="<%= field.name %>"
            label={t("<%= field.i18nKey %>", "<%= field.label %>")}
            inputType={<%- field.inputType ? JSON.stringify(field.inputType) : 'null' %>}
            itemDefaultValue={<%- field.scalarListItemDefaultValue %>}
            options={<%- field.enumOptions && field.enumOptions.length ? JSON.stringify(field.enumOptions.map((option) => ({ value: option.value, label: option.label }))) : 'undefined' %>}
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
                  onValueChange={(value, option) => {
                    field.onChange(value);
<% if (field.select.snapshots?.length) { -%>
<% field.select.snapshots.forEach((snapshot) => { -%>
                    form.setValue(
                      "<%= snapshot.fieldName %>" as never,
                      String(option?.record?.["<%= snapshot.sourceField %>"] ?? option?.label ?? "") as never,
                      { shouldDirty: true, shouldValidate: true },
                    );
<% }) -%>
<% } -%>
                  }}
                  placeholder={t("<%= field.placeholderKey %>", "Select <%= field.label %>")}
<% if (field.select.filters?.length) { -%>
                  filters={<%- JSON.stringify(field.select.filters) %>}
<% } -%>
<% if (field.select.sorters?.length) { -%>
                  sorters={<%- JSON.stringify(field.select.sorters) %>}
<% } -%>
<% if (field.select.pagination) { -%>
                  pagination={<%- JSON.stringify(field.select.pagination) %>}
<% } -%>
                  meta={{
                    idField: "<%= field.select.meta.idField %>",
                    label: t("<%= field.i18nKey %>", "<%= field.select.meta.label %>"),
                    aggregateRoute: "<%= field.select.meta.aggregateRoute %>",
                    queryRoute: "<%= field.select.meta.queryRoute %>",
<% if (field.select.meta.queryFields?.length) { -%>
                    queryFields: <%- JSON.stringify(field.select.meta.queryFields) %>,
<% } -%>
                  }}
                />
<% } else if (field.enumOptions && field.enumOptions.length) { -%>
                <Select
                  value={field.value === undefined || field.value === null ? undefined : String(field.value)}
                  onValueChange={field.onChange}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder={t("<%= field.placeholderKey %>", "Select <%= field.label %>")} />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
<% field.enumOptions.forEach((option) => { -%>
                    <SelectItem value="<%= option.value %>">{t("<%= option.i18nKey %>", "<%= option.label %>")}</SelectItem>
<% }) -%>
                  </SelectContent>
                </Select>
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
<% if (field.fileInput) { -%>
                  <Input
                    type="file"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      setPendingFile("<%= field.name %>", file, field.onChange);
                    }}
                  />
<% } else { -%>
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
<% } -%>
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
<% if (command.hasResultFields) { -%>
      <Dialog open={commandResult !== null} onOpenChange={(open) => {
        if (!open) {
          setCommandResult(null);
          navigate(-1);
        }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("<%= command.i18nKey %>.result.title", "<%= command.label %> Result")}</DialogTitle>
            <DialogDescription>
              {t("<%= command.i18nKey %>.result.description", "Copy the returned values now. Sensitive values may not be shown again.")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
<% command.resultFields.forEach((field) => { -%>
            <div className="space-y-1">
              <div className="text-sm font-medium">{t("<%= field.i18nKey %>", "<%= field.label %>")}</div>
              <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm break-all">
                {commandResult?.<%= field.name %> == null ? "-" : String(commandResult.<%= field.name %>)}
              </div>
            </div>
<% }) -%>
          </div>
          <DialogFooter>
            <Button type="button" onClick={() => {
              setCommandResult(null);
              navigate(-1);
            }}>
              {t("buttons.done", "Done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
<% } -%>
    </CreateView>
  );
};
