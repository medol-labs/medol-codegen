import type { RedirectAction, BaseRecord } from "@refinedev/core";
import { useForm, type UseFormProps } from "@refinedev/react-hook-form";
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
  meta?: Record<string, any>;

  /** useForm 原生参数 */
  formProps?: Omit<
    UseFormProps<TData, any, TVariables>["refineCoreProps"],
    "resource" | "action" | "meta" | "dataProviderName"
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
    meta,
    formProps,
  } = props;

  return useForm<TData, any, TVariables>({
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

      ...formProps,
    },
  });
};
