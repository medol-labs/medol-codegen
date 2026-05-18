import type { RedirectAction, BaseRecord } from "@refinedev/core";
import { useOne } from "@refinedev/core";
import { useForm, type UseFormProps } from "@refinedev/react-hook-form";
import React from "react";
import { FieldValues } from "react-hook-form";

type UseCommandFormProps<
  TVariables extends FieldValues = FieldValues,
  TData extends BaseRecord = BaseRecord,
> = {
  resource: string;
  command: string;
  aggregateId?: string;

  /** refine 原生能力透传 */
  redirect?: RedirectAction;
  dataProviderName?: string;
  queryDataProviderName?: string;
  meta?: Record<string, any>;
  queryMeta?: Record<string, any>;

  /** useForm 原生参数 */
  formProps?: Omit<
    UseFormProps<TData, any, TVariables>,
    "refineCoreProps"
  >;
};

export const useCommandForm = <
  TVariables extends FieldValues = FieldValues,
  TData extends BaseRecord = BaseRecord,
>(
  props: UseCommandFormProps<TVariables, TData>,
) => {
  const {
    resource,
    command,
    aggregateId,
    redirect = false,
    dataProviderName = "command",
    queryDataProviderName,
    meta,
    queryMeta,
    formProps,
  } = props;

  const form = useForm<TData, any, TVariables>({
    ...formProps,
    refineCoreProps: {
      resource,
      action: "create",
      dataProviderName,
      redirect,
      meta: {
        command,
        aggregateId,
        ...meta,
      },
    },
  });

  const query = useOne<TData>({
    resource,
    id: aggregateId,
    dataProviderName: queryDataProviderName,
    meta: {
      ...meta,
      ...queryMeta,
    },
    queryOptions: {
      enabled: !!aggregateId,
    },
  });
  const { getValues, setValue } = form;

  React.useEffect(() => {
    const data = query.result;
    if (!data) return;

    const registeredFields = Object.keys(getValues());

    registeredFields.forEach((field) => {
      if (Object.prototype.hasOwnProperty.call(data, field)) {
        setValue(field as any, data[field] as any);
      }
    });
  }, [query.result, getValues, setValue]);

  return {
    ...form,
    query,
  };
};
