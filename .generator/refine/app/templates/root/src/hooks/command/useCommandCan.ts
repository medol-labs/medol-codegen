import type { UseQueryResult } from "@tanstack/react-query";
import { useCan, type CanReturnType } from "@refinedev/core";

export type UseCommandButtonCanProps = {
  resource?: string;
  command: string;
  /**
   * Aggregate / Entity Id
   */
  id?: string | number;
  /**
   * 透传给 can 的其他参数
   */
  params?: Record<string, any>;
  /**
   * 是否启用权限校验（默认 true）
   */
  enabled?: boolean;
};

export const useCommandCan = ({
  resource,
  command,
  id,
  params,
  enabled = true,
}: UseCommandButtonCanProps): UseQueryResult<CanReturnType> => {
  return useCan({
    action: "create", // Command 在权限层等价于 create
    resource,
    params: {
      ...params,
      id,
      command, // 核心语义
    },
    queryOptions: {
      enabled,
    },
  });
};
