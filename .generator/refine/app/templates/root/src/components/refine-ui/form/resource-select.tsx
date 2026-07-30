import { useSelect, type BaseRecord } from "@refinedev/core";
import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormControl } from "@/components/ui/form";
import { cn } from "@/lib/utils";

type UseSelectParams = NonNullable<Parameters<typeof useSelect>[0]>;

type ResourceSelectProps = Omit<
  React.ComponentProps<typeof SelectTrigger>,
  "defaultValue" | "disabled" | "onValueChange" | "value"
> & {
  resource: UseSelectParams["resource"];
  value?: string | number | null;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  loadingPlaceholder?: string;
  emptyPlaceholder?: string;
  disabled?: boolean;
  optionLabel?: string | ((item: BaseRecord) => string);
  optionValue?: string | ((item: BaseRecord) => string | number);
  defaultValue?: UseSelectParams["defaultValue"];
  dataProviderName?: UseSelectParams["dataProviderName"];
  filters?: UseSelectParams["filters"];
  sorters?: UseSelectParams["sorters"];
  pagination?: UseSelectParams["pagination"];
  meta?: UseSelectParams["meta"];
  queryOptions?: UseSelectParams["queryOptions"];
  triggerClassName?: string;
  contentClassName?: string;
  withFormControl?: boolean;
};

const isLoadingSelect = (select: ReturnType<typeof useSelect>) =>
  Boolean(
    (select as { query?: { isLoading?: boolean } }).query?.isLoading ??
      (select as { queryResult?: { isLoading?: boolean } }).queryResult
        ?.isLoading,
  );

const readableOptionLabel = (
  item: BaseRecord,
  preferred?: string | ((item: BaseRecord) => string),
  optionValue?: string | ((item: BaseRecord) => string | number),
) => {
  if (typeof preferred === "function") {
    const value = preferred(item);
    if (hasText(value)) {
      return String(value);
    }
  }

  const preferredValue =
    typeof preferred === "string" ? item[preferred] : undefined;
  if (hasText(preferredValue)) {
    return String(preferredValue);
  }

  for (const key of [
    "displayName",
    "datasetName",
    "runtimeName",
    "organizationName",
    "federationName",
    "featureDomain",
    "name",
    "title",
    "label",
    "code",
    "valueCode",
  ]) {
    if (hasText(item[key])) {
      return String(item[key]);
    }
  }

  const value =
    typeof optionValue === "function"
      ? optionValue(item)
      : typeof optionValue === "string"
        ? item[optionValue]
        : item.id;
  return hasText(value) ? String(value) : "Unnamed";
};

const hasText = (value: unknown) =>
  value !== null && value !== undefined && String(value).trim().length > 0;

export const ResourceSelect = React.forwardRef<
  React.ComponentRef<typeof SelectTrigger>,
  ResourceSelectProps
>(
  (
    {
      resource,
      value,
      onValueChange,
      placeholder = "Select",
      loadingPlaceholder = "Loading...",
      emptyPlaceholder = "No options",
      disabled,
      optionLabel,
      optionValue,
      defaultValue,
      dataProviderName,
      filters,
      sorters,
      pagination,
      meta,
      queryOptions,
      triggerClassName,
      contentClassName,
      withFormControl = false,
      className,
      ...triggerProps
    },
    ref,
  ) => {
    const select = useSelect<BaseRecord>({
      resource,
      optionLabel: ((item: BaseRecord) =>
        readableOptionLabel(item, optionLabel, optionValue)) as UseSelectParams["optionLabel"],
      optionValue: optionValue as UseSelectParams["optionValue"],
      defaultValue,
      dataProviderName,
      filters,
      sorters,
      pagination,
      meta,
      queryOptions,
    });
    const options = select.options ?? [];
    const loading = isLoadingSelect(select);
    const trigger = (
      <SelectTrigger
        {...triggerProps}
        ref={ref}
        className={cn(triggerClassName, className)}
      >
        <SelectValue placeholder={loading ? loadingPlaceholder : placeholder} />
      </SelectTrigger>
    );

    return (
      <Select
        value={value === null || value === undefined ? "" : String(value)}
        onValueChange={onValueChange}
        disabled={disabled || loading}
      >
        {withFormControl ? <FormControl>{trigger}</FormControl> : trigger}
        <SelectContent className={contentClassName}>
          {options.length === 0 ? (
            <SelectItem value="__empty" disabled>
              {loading ? loadingPlaceholder : emptyPlaceholder}
            </SelectItem>
          ) : (
            options.map((option) => (
              <SelectItem
                key={String(option.value)}
                value={String(option.value)}
              >
                {option.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>
    );
  },
);

ResourceSelect.displayName = "ResourceSelect";
