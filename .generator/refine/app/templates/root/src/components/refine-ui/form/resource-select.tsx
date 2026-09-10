import { useSelect, type BaseRecord, type CrudFilter } from "@refinedev/core";
import { Check, ChevronsUpDown, X } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormControl } from "@/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type UseSelectParams = NonNullable<Parameters<typeof useSelect>[0]>;

type ResourceSelectOption = {
  value: string | number;
  label: React.ReactNode;
  record?: BaseRecord;
};

type ResourceSelectProps = Omit<
  React.ComponentProps<typeof SelectTrigger>,
  "defaultValue" | "disabled" | "onValueChange" | "value"
> & {
  resource: UseSelectParams["resource"];
  value?: string | number | null;
  onValueChange?: (value: string, option?: ResourceSelectOption) => void;
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
  searchField?: UseSelectParams["searchField"];
  meta?: UseSelectParams["meta"];
  queryOptions?: UseSelectParams["queryOptions"];
  triggerClassName?: string;
  contentClassName?: string;
  withFormControl?: boolean;
};

type ResourceMultiSelectProps = Omit<
  React.ComponentProps<typeof Button>,
  "defaultValue" | "disabled" | "onChange" | "value"
> & {
  resource: UseSelectParams["resource"];
  value?: Array<string | number> | null;
  onValueChange?: (value: string[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
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
  searchField?: UseSelectParams["searchField"];
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

const readableOptionValue = (
  item: BaseRecord,
  optionValue?: string | ((item: BaseRecord) => string | number),
) =>
  typeof optionValue === "function"
    ? optionValue(item)
    : typeof optionValue === "string"
      ? item[optionValue]
      : item.id;

const searchFilters = (
  value: string,
  searchField: string | undefined,
  filters?: CrudFilter[],
): CrudFilter[] => {
  const trimmed = value.trim();
  const baseFilters = filters ?? [];

  if (!trimmed || !searchField) {
    return baseFilters;
  }

  return [
    ...baseFilters,
    {
      field: searchField,
      operator: "contains",
      value: trimmed,
    },
  ];
};

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
      searchField,
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
      searchField,
      onSearch: (value: string) =>
        searchFilters(
          value,
          searchField ?? (typeof optionLabel === "string" ? optionLabel : undefined),
          filters,
        ),
      meta,
      queryOptions,
    });
    const options = select.options ?? [];
    const loading = isLoadingSelect(select);
    const records = (
      (select as { query?: { data?: { data?: BaseRecord[] } } }).query?.data
        ?.data ??
      (select as { queryResult?: { data?: { data?: BaseRecord[] } } })
        .queryResult?.data?.data ??
      []
    ) as BaseRecord[];
    const recordsByValue = React.useMemo(() => {
      const next = new Map<string, BaseRecord>();
      records.forEach((record) => {
        const optionValueForRecord = readableOptionValue(record, optionValue);
        if (optionValueForRecord !== undefined && optionValueForRecord !== null) {
          next.set(String(optionValueForRecord), record);
        }
      });
      return next;
    }, [records, optionValue]);
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
        onValueChange={(nextValue) => {
          const selected = options.find(
            (option) => String(option.value) === nextValue,
          );
          onValueChange?.(
            nextValue,
            selected
              ? {
                  value: selected.value,
                  label: selected.label,
                  record: recordsByValue.get(nextValue),
                }
              : undefined,
          );
        }}
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

export const ResourceMultiSelect = React.forwardRef<
  React.ComponentRef<typeof Button>,
  ResourceMultiSelectProps
>(
  (
    {
      resource,
      value,
      onValueChange,
      placeholder = "Select",
      searchPlaceholder = "Search...",
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
      searchField,
      meta,
      queryOptions,
      triggerClassName,
      contentClassName,
      withFormControl = false,
      className,
      ...buttonProps
    },
    ref,
  ) => {
    const [open, setOpen] = React.useState(false);
    const currentValue = Array.isArray(value) ? value : [];
    const selectedOptionCache = React.useRef(
      new Map<string, { label: React.ReactNode; value: string | number }>(),
    );
    const select = useSelect<BaseRecord>({
      resource,
      optionLabel: ((item: BaseRecord) =>
        readableOptionLabel(item, optionLabel, optionValue)) as UseSelectParams["optionLabel"],
      optionValue: optionValue as UseSelectParams["optionValue"],
      defaultValue: currentValue.length > 0 ? currentValue : defaultValue,
      dataProviderName,
      filters,
      sorters,
      pagination: pagination ?? { currentPage: 1, pageSize: 50 },
      searchField,
      onSearch: (value: string) =>
        searchFilters(
          value,
          searchField ?? (typeof optionLabel === "string" ? optionLabel : undefined),
          filters,
        ),
      meta,
      queryOptions,
    });
    const options = select.options ?? [];
    const loading = isLoadingSelect(select);
    const selectedValues = new Set(currentValue.map(String));
    React.useEffect(() => {
      options.forEach((option) => {
        selectedOptionCache.current.set(String(option.value), {
          label: option.label,
          value: option.value,
        });
      });
    }, [options]);
    const selectedOptions = currentValue.map((item) => {
      const cached = selectedOptionCache.current.get(String(item));
      return cached ?? { label: String(item), value: item };
    });

    const update = (next: Set<string>) => onValueChange?.([...next]);
    const toggle = (nextValue: string) => {
      const next = new Set(selectedValues);
      if (next.has(nextValue)) {
        next.delete(nextValue);
      } else {
        next.add(nextValue);
      }
      update(next);
    };
    const remove = (nextValue: string) => {
      const next = new Set(selectedValues);
      next.delete(nextValue);
      update(next);
    };

    const trigger = (
      <PopoverTrigger asChild>
        <Button
          {...buttonProps}
          ref={ref}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn("min-h-10 w-full justify-between", triggerClassName, className)}
        >
          <span className="flex min-w-0 flex-1 flex-wrap gap-1">
            {selectedOptions.length > 0 ? (
              selectedOptions.map((option) => (
                <Badge key={String(option.value)} variant="secondary" className="max-w-full">
                  <span className="truncate">{option.label}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="ml-1 inline-flex"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      remove(String(option.value));
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        remove(String(option.value));
                      }
                    }}
                  >
                    <X className="size-3" />
                  </span>
                </Badge>
              ))
            ) : (
              <span className="text-muted-foreground">
                {loading ? loadingPlaceholder : placeholder}
              </span>
            )}
          </span>
          <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
    );

    return (
      <Popover open={open} onOpenChange={setOpen}>
        {withFormControl ? <FormControl>{trigger}</FormControl> : trigger}
        <PopoverContent className={cn("w-[--radix-popover-trigger-width] p-0", contentClassName)}>
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={searchPlaceholder}
              onValueChange={select.onSearch}
            />
            <CommandList>
              <CommandEmpty>{loading ? loadingPlaceholder : emptyPlaceholder}</CommandEmpty>
              <CommandGroup>
                {options.map((option) => {
                  const optionValueString = String(option.value);
                  const checked = selectedValues.has(optionValueString);
                  return (
                    <CommandItem
                      key={optionValueString}
                      value={`${option.label} ${optionValueString}`}
                      onSelect={() => toggle(optionValueString)}
                    >
                      <Checkbox checked={checked} aria-hidden="true" tabIndex={-1} />
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {checked ? <Check className="size-4" /> : null}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  },
);

ResourceMultiSelect.displayName = "ResourceMultiSelect";
