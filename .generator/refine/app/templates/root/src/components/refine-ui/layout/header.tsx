import { UserAvatar } from "@/components/refine-ui/layout/user-avatar";
import { ThemeToggle } from "@/components/refine-ui/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  getPersistedLocale,
  normalizeSupportedLocale,
  supportedLocales,
  type SupportedLocale,
} from "@/providers/i18n";
import { backendModules, resources } from "@/providers/resources";
import {
  HeaderExtensionActions,
  useAppExtensions,
} from "@/domain/app-extensions";
import {
  useActiveAuthProvider,
  useGetLocale,
  useList,
  useLogout,
  useNotification,
  useRefineOptions,
  useSetLocale,
  useTranslate,
} from "@refinedev/core";
import { Bell, Check, Globe2, LogOutIcon, Server } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

export const Header = () => {
  const { isMobile } = useSidebar();

  return <>{isMobile ? <MobileHeader /> : <DesktopHeader />}</>;
};

function DesktopHeader() {
  return (
    <header
      className={cn(
        "sticky",
        "top-0",
        "flex",
        "h-16",
        "shrink-0",
        "items-center",
        "gap-4",
        "border-b",
        "border-border",
        "bg-sidebar",
        "pr-3",
        "justify-end",
        "z-40"
      )}
    >
      <HeaderExtensionActions />
      <NotificationIndicator />
      <ModuleSwitcher />
      <LanguageSwitcher />
      <ThemeToggle />
      <UserDropdown />
    </header>
  );
}

function MobileHeader() {
  const { open, isMobile } = useSidebar();

  const { title } = useRefineOptions();

  return (
    <header
      className={cn(
        "sticky",
        "top-0",
        "flex",
        "h-12",
        "shrink-0",
        "items-center",
        "gap-2",
        "border-b",
        "border-border",
        "bg-sidebar",
        "pr-3",
        "justify-between",
        "z-40"
      )}
    >
      <SidebarTrigger
        className={cn("text-muted-foreground", "rotate-180", "ml-1", {
          "opacity-0": open,
          "opacity-100": !open || isMobile,
          "pointer-events-auto": !open || isMobile,
          "pointer-events-none": open && !isMobile,
        })}
      />

      <div
        className={cn(
          "whitespace-nowrap",
          "flex",
          "min-w-0",
          "flex-1",
          "flex-row",
          "h-full",
          "items-center",
          "justify-start",
          "gap-2",
          "overflow-hidden",
          "pr-1",
          "transition-discrete",
          "duration-200",
          {
            "pl-3": !open,
            "pl-5": open,
          }
        )}
      >
        <div className={cn("flex", "h-9", "w-9", "shrink-0", "items-center", "justify-center")}>
          {title.icon}
        </div>
        <h2
          className={cn(
            "text-sm",
            "font-bold",
            "min-w-0",
            "truncate",
            "transition-opacity",
            "duration-200",
            {
              "opacity-0": !open,
              "opacity-100": open,
            }
          )}
        >
          {title.text}
        </h2>
      </div>

      <div className={cn("flex", "shrink-0", "items-center", "gap-1")}>
        <HeaderExtensionActions compact />
        <NotificationIndicator compact />
        <ModuleSwitcher compact />
        <LanguageSwitcher compact />
        <ThemeToggle className={cn("h-8", "w-8")} />
      </div>
    </header>
  );
}

type NotificationSummaryRecord = {
  notificationId?: string;
  latestNotificationId?: string;
  unreadCount?: number;
  latestSeverity?: string;
  latestPublishedAt?: string;
  hasUnreadError?: boolean;
  fallbackTitle?: string;
  fallbackBody?: string;
  messageKey?: string;
  toastPolicy?: string;
};

const resourceListRoute = (resource?: { list?: unknown; name?: string }) => {
  if (typeof resource?.list === "string") return resource.list;
  return resource?.name ? `/${resource.name.replaceAll("_", "-")}` : undefined;
};

function NotificationIndicator({ compact = false }: { compact?: boolean }) {
  const translate = useTranslate();
  const navigate = useNavigate();
  const { open } = useNotification();
  const lastToastIdRef = useRef<string | null>(null);
  const summaryResource = useMemo(
    () => resources.find((resource) => resource.name === "system_notification_summary"),
    [],
  );
  const catalogResource = useMemo(
    () => resources.find((resource) => resource.name === "system_notification_catalog"),
    [],
  );
  const summaryMeta = summaryResource?.meta as Record<string, unknown> | undefined;
  const catalogRoute = resourceListRoute(catalogResource);

  const summary = useList<NotificationSummaryRecord>({
    resource: summaryResource?.name ?? "__system_notification_summary_missing__",
    dataProviderName: summaryMeta?.dataProviderName as string | undefined,
    pagination: { currentPage: 1, pageSize: 1, mode: "server" },
    meta: summaryMeta,
    queryOptions: {
      enabled: Boolean(summaryResource),
      refetchInterval: 15000,
      staleTime: 10000,
    },
  });

  const record = summary.query.data?.data?.[0];
  const unreadCount = Number(record?.unreadCount ?? 0);
  const latestNotificationId = record?.latestNotificationId ?? record?.notificationId;
  const latestSeverity = String(record?.latestSeverity ?? "").toUpperCase();
  const toastPolicy = String(record?.toastPolicy ?? "").toUpperCase();
  const shouldToast =
    latestNotificationId
    && latestNotificationId !== lastToastIdRef.current
    && (toastPolicy === "DEFAULT"
      || toastPolicy === "IMPORTANT"
      || latestSeverity === "ERROR"
      || latestSeverity === "WARNING");

  useEffect(() => {
    if (!shouldToast || !latestNotificationId) return;
    lastToastIdRef.current = latestNotificationId;
    const message = record?.messageKey
      ? translate(record.messageKey, record.fallbackTitle ?? record.messageKey)
      : record?.fallbackTitle ?? translate("systemNotification.new", "New notification");
    const description = record?.fallbackBody;
    open?.({
      type: latestSeverity === "ERROR" ? "error" : "success",
      message,
      description,
    });
  }, [latestNotificationId, latestSeverity, open, record?.fallbackBody, record?.fallbackTitle, record?.messageKey, shouldToast, translate]);

  if (!summaryResource) {
    return null;
  }

  const label = unreadCount > 0
    ? translate("systemNotification.unreadCount", { count: unreadCount }, "{{count}} unread")
    : translate("systemNotification.noneUnread", "No unread notifications");

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn("relative", compact ? "h-8 w-8" : "h-9 w-9")}
      aria-label={label}
      title={label}
      onClick={() => {
        if (catalogRoute) {
          navigate(catalogRoute);
        }
      }}
    >
      <Bell className={cn("size-4", record?.hasUnreadError ? "text-destructive" : "text-muted-foreground")} />
      {unreadCount > 0 ? (
        <span
          className={cn(
            "absolute",
            "-right-0.5",
            "-top-0.5",
            "flex",
            "h-4",
            "min-w-4",
            "items-center",
            "justify-center",
            "rounded-full",
            "bg-destructive",
            "px-1",
            "text-[10px]",
            "font-medium",
            "leading-none",
            "text-destructive-foreground"
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </Button>
  );
}

function ModuleSwitcher({ compact = false }: { compact?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { filterBackendModules } = useAppExtensions();
  const visibleModules = filterBackendModules(backendModules);

  if (visibleModules.length <= 1) {
    return null;
  }

  const activeModule =
    visibleModules.find((module) =>
      module.resources.some((route) => location.pathname.startsWith(`/${route}`)),
    ) ?? visibleModules[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9",
            "gap-2",
            "border-border",
            "bg-background",
            "px-2",
            "text-foreground",
            "shadow-sm",
            "hover:bg-accent",
            "hover:text-accent-foreground",
            {
              "w-9": compact,
              "min-w-36": !compact,
            }
          )}
          aria-label="Switch backend module"
          title="Switch backend module"
        >
          <Server className="h-4 w-4" />
          {!compact && <span className="truncate text-xs font-semibold">{activeModule.label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {visibleModules.map((module) => (
          <DropdownMenuItem
            key={module.name}
            className={cn("cursor-pointer", "gap-2")}
            onClick={() => navigate(module.homeRoute)}
          >
            <span className="min-w-36">{module.label}</span>
            {module.name === activeModule.name && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const getLocale = useGetLocale();
  const setLocale = useSetLocale();
  const currentLocale = normalizeLocale(getLocale());

  useEffect(() => {
    const persistedLocale = getPersistedLocale();
    if (persistedLocale && persistedLocale !== currentLocale) {
      void setLocale(persistedLocale);
    }
  }, [currentLocale, setLocale]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className={cn(
            "h-9",
            "gap-2",
            "border-border",
            "bg-background",
            "px-2",
            "text-foreground",
            "shadow-sm",
            "hover:bg-accent",
            "hover:text-accent-foreground",
            {
              "w-9": compact,
              "min-w-20": !compact,
            }
          )}
          aria-label="Change language"
          title="Change language"
        >
          <Globe2 className="h-4 w-4" />
          {!compact && <span className="text-xs font-semibold">{localeLabel(currentLocale)}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {supportedLocales.map((locale) => (
          <DropdownMenuItem
            key={locale}
            className={cn("cursor-pointer", "gap-2")}
            onClick={() => {
              if (locale !== currentLocale) {
                void setLocale(locale);
              }
            }}
          >
            <span className="min-w-16">{localeLabel(locale)}</span>
            {locale === currentLocale && <Check className="ml-auto h-4 w-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const UserDropdown = () => {
  const { mutate: logout, isPending: isLoggingOut } = useLogout();

  const authProvider = useActiveAuthProvider();

  if (!authProvider?.getIdentity) {
    return null;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <UserAvatar />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className={cn(
            "cursor-pointer",
            "gap-2",
            "text-destructive",
            "focus:bg-destructive/10",
            "focus:text-destructive"
          )}
          onClick={() => {
            logout();
          }}
        >
          <LogOutIcon className={cn("h-4", "w-4")} />
          <span>{isLoggingOut ? "Logging out..." : "Logout"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

function normalizeLocale(locale: string | undefined): SupportedLocale {
  return normalizeSupportedLocale(locale) ?? supportedLocales[0];
}

function localeLabel(locale: SupportedLocale) {
  const normalized = locale.toLowerCase();
  if (normalized === "en") return "English";
  if (normalized === "zh-cn") return "中文";
  return locale;
}

Header.displayName = "Header";
MobileHeader.displayName = "MobileHeader";
DesktopHeader.displayName = "DesktopHeader";
