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
  isSupportedLocale,
  supportedLocales,
  type SupportedLocale,
} from "@/providers/i18n";
import { backendModules } from "@/providers/resources";
import {
  HeaderExtensionActions,
  useAppExtensions,
} from "@/domain/app-extensions";
import {
  useActiveAuthProvider,
  useGetLocale,
  useLogout,
  useRefineOptions,
  useSetLocale,
} from "@refinedev/core";
import { Check, Globe2, LogOutIcon, Server } from "lucide-react";
import { useEffect } from "react";
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
        <ModuleSwitcher compact />
        <LanguageSwitcher compact />
        <ThemeToggle className={cn("h-8", "w-8")} />
      </div>
    </header>
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
          {!compact && <span className="text-xs font-semibold uppercase">{currentLocale}</span>}
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
  const candidate = locale ?? null;
  return isSupportedLocale(candidate) ? candidate : supportedLocales[0];
}

function localeLabel(locale: SupportedLocale) {
  if (locale === "en") return "English";
  if (locale === "zh-CN") return "中文";
  return locale;
}

Header.displayName = "Header";
MobileHeader.displayName = "MobileHeader";
DesktopHeader.displayName = "DesktopHeader";
