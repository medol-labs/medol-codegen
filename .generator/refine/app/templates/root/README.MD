# frontend-foundation

<div align="center" style="margin: 30px;">
    <a href="https://refine.dev">
    <img alt="refine logo" src="https://refine.ams3.cdn.digitaloceanspaces.com/readme/refine-readme-banner.png">
    </a>
</div>
<br/>

This [Refine](https://github.com/refinedev/refine) project was generated with [create refine-app](https://github.com/refinedev/refine/tree/master/packages/create-refine-app).

## Getting Started

A React Framework for building internal tools, admin panels, dashboards & B2B apps with unmatched flexibility ✨

Refine's hooks and components simplifies the development process and eliminates the repetitive tasks by providing industry-standard solutions for crucial aspects of a project, including authentication, access control, routing, networking, state management, and i18n.

## Available Scripts

### Running the development server.

```bash
    npm run dev
```

### Building for production.

```bash
    npm run build
```

### Running the production server.

```bash
    npm run start
```

## Container Image

Build the frontend image:

```bash
node scripts/build-images.mjs
```

Images default to `linux/amd64`. Override the target CPU architecture when needed:

```bash
node scripts/build-images.mjs --platform linux/arm64
```

The production image is a static nginx image. Runtime environment variables are written to `/usr/share/nginx/html/runtime-config.js` when the container starts, so the same image can be reused across environments.

Configure these values in `.env` or the Compose environment:

- `VITE_API_URL` for Supabase URL; default: `https://iwdfzvfqbtokqetmbmbp.supabase.co`
- `VITE_SUPABASE_API_KEY` for Supabase anon API key
- `VITE_AUTH_PROVIDER` for authentication mode: `local` or `supabase`; default: `local`
- `VITE_ACCESS_CONTROL_MODE` for frontend permission checks: `permissive` or `strict`; default: `permissive`
- `VITE_AUTH_API_URL` for login and current-user API; default: `http://localhost:8080`
<% backendModules.forEach((module) => { -%>
- `<%= module.envName %>` for `<%= module.label %>`; default: `<%= module.defaultApiUrl %>`
<% }) -%>

```bash
VITE_API_URL=https://iwdfzvfqbtokqetmbmbp.supabase.co \
VITE_SUPABASE_API_KEY=<supabase-anon-key> \
docker compose up -d
```

Export and import the image for an offline environment:

```bash
node scripts/export-images.mjs --output ./frontend-images.tar
node scripts/import-images.mjs --output ./frontend-images.tar
```

The image name defaults to `medol/<%= imageName %>:0.0.1-SNAPSHOT`. Override it with `--prefix`, `--image`, and `--version`.

Run the built image with Docker Compose:

```bash
docker compose up -d
```

The compose file maps `${CONSOLE_PORT:-5173}` on the host to nginx port `80` in the container. Override `CONSOLE_IMAGE` when using a custom image name.

## Learn More

To learn more about **Refine**, please check out the [Documentation](https://refine.dev/docs)

- **Supabase Data Provider** [Docs](https://refine.dev/docs/core/providers/data-provider/#overview)
- **shadcn/ui** [Docs](https://refine.dev/docs/guides-concepts/general-concepts/#headless-concept)
- **React Router** [Docs](https://refine.dev/docs/core/providers/router-provider/)

## License

MIT

## 自定义 CommandButtom

### Form

```js
const {
  refineCore: { onFinish },
  ...form
} = useForm({
  // resolver: zodResolver(formSchema),
  refineCoreProps: {
    resource: "demands",
    action: "create",
    dataProviderName: "command",
    meta: {
      command: "submitdemand",
    },
    redirect: false,
  },
});
```

useCommandForm

```js
const {
  refineCore: { onFinish },
  ...form
} = useCommandForm({
  resource: "giftcards",
  command: "redeem",
  aggregateId: id,
  redirect: false,
});

const {
  refineCore: { onFinish },
  ...form
} = useCommandForm({
  resource: "giftcards",
  command: "redeem",
  aggregateId: id,
  redirect: false,
});
```

### DataProvider

提供专门的 Provider，利用 refine create 方法，resource、command 拼写 command url

```js
import type { DataProvider } from "@refinedev/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { dataProvider as supabaseDataProvider } from "./data";

export const commandDataProvider = (
  supabaseClient: SupabaseClient<any, any, any>,
): Required<DataProvider> => {
  const baseUrl = "http://localhost:8080";

  return {
    ...supabaseDataProvider,
    create: async ({ resource, variables, meta }) => {
      const command = meta?.command;
      if (!command) {
        throw new Error(
          `[commandProvider] meta.command is required for command create`,
        );
      }

      const res = await fetch(
        `${baseUrl}/api/${resource}/${command}${
          meta.aggregateId ? "/" + meta.aggregateId : ""
        }`,
        {
          method: "POST",
          body: JSON.stringify(variables),
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      if (!res.ok) {
        throw new Error(`Command failed: ${resource}.${command}`);
      }

      return {
        data: await res.json(),
      };
    },
    getApiUrl: () => {
      throw Error("Not implemented on refine-supabase data provider.");
    },

    custom: () => {
      throw Error("Not implemented on refine-supabase data provider.");
    },
  };
};

import { supabaseClient } from "./supabase-client";

export const commandProvider = commandDataProvider(supabaseClient);
```

### userCommandButton

useCommandCan

```js
import type { UseQueryResult } from "@tanstack/react-query";
import { useCan, type CanReturnType } from "@refinedev/core";

export type UseCommandButtonCanProps = {
  resource?: string,
  command: string,
  /**
   * Aggregate / Entity Id
   */
  id?: string | number,
  /**
   * 透传给 can 的其他参数
   */
  params?: Record<string, any>,
  /**
   * 是否启用权限校验（默认 true）
   */
  enabled?: boolean,
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
```

useCommandButtonCanAccess

```js
import {
  AccessControlContext,
  BaseKey,
  CanReturnType,
  IResourceItem,
  useTranslate,
} from "@refinedev/core";
import React from "react";
import { useCommandCan } from "./useCommandCan";

type CommandCanAccessProps = {
  resource?: IResourceItem,
  command: string,
  id?: BaseKey,
  accessControl?: {
    enabled?: boolean,
    hideIfUnauthorized?: boolean,
  },
  meta?: Record<string, unknown>,
};

type CommandCanAccessValues = {
  title: string,
  hidden: boolean,
  disabled: boolean,
  canAccess: CanReturnType | undefined,
};

export const useCommandButtonCanAccess = (
  props: CommandCanAccessProps,
): CommandCanAccessValues => {
  const translate = useTranslate();
  const accessControlContext = React.useContext(AccessControlContext);

  const accessControlEnabled =
    props.accessControl?.enabled ??
    accessControlContext.options.buttons.enableAccessControl;

  const hideIfUnauthorized =
    props.accessControl?.hideIfUnauthorized ??
    accessControlContext.options.buttons.hideIfUnauthorized;

  const { data: canAccess } = useCommandCan({
    resource: props.resource?.name,
    command: props.command,
    params: { meta: props.meta, id: props.id, resource: props.resource },
    enabled: accessControlEnabled,
  });

  const title = React.useMemo(() => {
    if (canAccess?.can) return "";
    if (canAccess?.reason) return canAccess.reason;

    return translate(
      "buttons.notAccessTitle",
      "You don't have permission to access",
    );
  }, [canAccess?.can, canAccess?.reason, translate]);

  const hidden = accessControlEnabled && hideIfUnauthorized && !canAccess?.can;

  const disabled = canAccess?.can === false;

  return {
    title,
    hidden,
    disabled,
    canAccess,
  };
};
```

userCommandButton

```js
import {
  CanReturnType,
  useGo,
  useParsed,
  useResourceParams,
  type IResourceItem,
} from "@refinedev/core";
import { useCommandButtonCanAccess } from "./useCommandButtonCanAccess";

type CommandNavOpts = {
  resource?: string;
  command: string;
  id?: string | number;
  query?: Record<string, any>;
};

export const useCommandNavigation = () => {
  const { resources } = useResourceParams();
  const parsed = useParsed();
  const go = useGo();
  const resolveResource = (name?: string): IResourceItem | undefined => {
    return resources.find((r) => r.name === (name ?? parsed.resource));
  };

  const buildPath = (
    resource: IResourceItem,
    command: string,
    id?: string | number,
  ) => {
    const template =
      resource.meta?.commandRoute ?? "/:resource/:id/command/:command";

    return template
      .replace(":resource", resource.name)
      .replace(":id", id?.toString() ?? "")
      .replace(":command", command);
  };

  const commandUrl = ({
    resource,
    command,
    id,
    query,
  }: CommandNavOpts): string => {
    const resourceItem = resolveResource(resource);
    if (!resourceItem) return "";

    return go({
      to: buildPath(resourceItem, command, id ?? parsed.id),
      type: "path",
      query,
    }) as string;
  };

  const goCommand = (
    opts: CommandNavOpts,
    type: "push" | "replace" = "push",
  ) => {
    go({
      to: commandUrl(opts),
      type,
    });
  };

  return { commandUrl, goCommand };
};

export type UseCommandButtonProps = {
  command: string;
  id?: string | number;
  resource?: string;
  meta?: Record<string, unknown>;
  accessControl?: {
    enabled?: boolean;
    hideIfUnauthorized?: boolean;
  };
};

export type CommandButtonResult = {
  to: string;
  label: string;
  hidden: boolean;
  disabled: boolean;
  canAccess: CanReturnType | undefined;
  title: string;
};

export const useCommandButton = ({
  command,
  resource,
  id,
  accessControl,
  meta,
}: UseCommandButtonProps): CommandButtonResult => {
  const { id: paramId, resource: resourceItem } = useResourceParams({
    resource,
    id,
  });
  const { commandUrl } = useCommandNavigation();

  const commandMeta = resourceItem?.meta?.commands?.[command];

  const { canAccess, title, hidden, disabled } = useCommandButtonCanAccess({
    resource: resourceItem,
    command,
    accessControl: accessControl,
    meta: meta,
    id,
  });

  return {
    to: commandUrl({
      resource: resourceItem?.name,
      id: id ?? paramId,
      command,
    }),
    label: commandMeta?.label ?? command,
    hidden: hidden,
    disabled: disabled,
    canAccess,
    title,
  };
};

```

CommandButton

```js
import { Button } from "@/components/ui/button";
import { useCommandButton } from "@/hooks/command/useCommandButton";
import { BaseKey, Link } from "@refinedev/core";
import { Check } from "lucide-react";
import React from "react";

type CommandButtonProps = {
  /**
   * Resource name for API data interactions. `identifier` of the resource can be used instead of the `name` of the resource.
   * @default Inferred resource name from the route
   */
  command: string;
  /**
   * Data item identifier for the actions with the API
   * @default Reads `:id` from the URL
   */
  recordItemId?: BaseKey;
  /**
   * Access Control configuration for the button
   * @default `{ enabled: true, hideIfUnauthorized: false }`
   */
  accessControl?: {
    enabled?: boolean;
    hideIfUnauthorized?: boolean;
  };
  /**
   * `meta` property is used when creating the URL for the related action and path.
   */
  meta?: Record<string, unknown>;
} & React.ComponentProps<typeof Button>;

export const CommandButton = React.forwardRef<
  React.ComponentRef<typeof Button>,
  CommandButtonProps
>(
  (
    { resource, command, recordItemId, accessControl, meta, children, onClick, ...rest },
    ref
  ) => {
    const { to, label, hidden, disabled } = useCommandButton({
      resource,
      command,
      id: recordItemId,
    });

    const isDisabled = disabled || rest.disabled;
    const isHidden = hidden || rest.hidden;

    if (isHidden) return null;

    return (
      <Button {...rest} ref={ref} disabled={isDisabled} asChild>
        <Link
          to={to}
          replace={false}
          onClick={(e: React.PointerEvent<HTMLButtonElement>) => {
            if (isDisabled) {
              e.preventDefault();
              return;
            }
            if (onClick) {
              e.preventDefault();
              onClick(e);
            }
          }}
        >
          {children ?? (
            <div className="flex items-center gap-2 font-semibold">
              <Check className="h-4 w-4" />
              <span>{label}</span>
            </div>
          )}
        </Link>
      </Button>
    );
  }
);

```

```js
<CommandButton variant="ghost" command="submitdemand" size="sm" />
```
