import type {
  BaseRecord,
  DataProvider,
  GetListParams,
  GetListResponse,
  GetManyParams,
  GetManyResponse,
  GetOneParams,
  GetOneResponse,
} from "@refinedev/core";
import { dataProvider as supabaseDataProvider } from "@refinedev/supabase";
import camelcaseKeys from "camelcase-keys";
import { supabaseClient } from "./supabase-client";

const provider = supabaseDataProvider(supabaseClient) as Required<DataProvider>;

const camelcaseData = async <T extends { data?: unknown }>(
  promise: Promise<T>,
): Promise<T> => {
  const response = await promise;

  if (!("data" in response)) {
    return response;
  }

  return {
    ...response,
    data: camelcaseKeys(response.data as Record<string, unknown>[], {
      deep: true,
    }) as T["data"],
  };
};

export const dataProvider: Required<DataProvider> = {
  ...provider,
  getList: <TData extends BaseRecord = BaseRecord>(
    params: GetListParams,
  ): Promise<GetListResponse<TData>> =>
    camelcaseData(provider.getList<TData>(params)),
  getMany: <TData extends BaseRecord = BaseRecord>(
    params: GetManyParams,
  ): Promise<GetManyResponse<TData>> =>
    camelcaseData(provider.getMany<TData>(params)),
  getOne: <TData extends BaseRecord = BaseRecord>(
    params: GetOneParams,
  ): Promise<GetOneResponse<TData>> =>
    camelcaseData(provider.getOne<TData>(params)),
};
