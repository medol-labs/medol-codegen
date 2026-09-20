"use client";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent as ShadcnSidebarContent,
  SidebarHeader as ShadcnSidebarHeader,
  SidebarRail as ShadcnSidebarRail,
  SidebarTrigger as ShadcnSidebarTrigger,
  useSidebar as useShadcnSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import {
  useLink,
  useCanWithoutCache,
  useMenu,
  useRefineOptions,
  useTranslate,
  type TreeMenuItem,
} from "@refinedev/core";
import { ChevronRight, ListIcon } from "lucide-react";
import React from "react";
import { useLocation } from "react-router";

import { resolveMenuIcon } from "@/domain/menu-icons";
import { useAppExtensions } from "@/domain/app-extensions";
import { backendModules } from "@/providers/resources";

export function Sidebar() {
  const { open } = useShadcnSidebar();
  const { can } = useCanWithoutCache();
  const { menuItems, selectedKey } = useMenu();
  const { filterBackendModules } = useAppExtensions();
  const location = useLocation();
  const visibleBackendModules = filterBackendModules(backendModules);
  const activeModule = getActiveBackendModule(location.pathname, visibleBackendModules);
  const moduleMenuItems = React.useMemo(
    () => filterMenuItemsForModule(menuItems, activeModule, visibleBackendModules),
    [menuItems, activeModule, visibleBackendModules],
  );
  const moduleMenuItemsKey = menuItemsSignature(moduleMenuItems);
  const [visibleMenuItems, setVisibleMenuItems] =
    React.useState<TreeMenuItem[]>([]);

  React.useEffect(() => {
    let cancelled = false;

    if (!can) {
      setVisibleMenuItems(moduleMenuItems);
      return () => {
        cancelled = true;
      };
    }

    filterMenuItemsForAccess(moduleMenuItems, can).then((items) => {
      if (!cancelled) {
        setVisibleMenuItems(items);
      }
    }).catch(() => {
      if (!cancelled) {
        setVisibleMenuItems([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [moduleMenuItemsKey, can]);

  React.useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const activeItem = document.querySelector<HTMLElement>(
        '[data-sidebar="content"] [data-sidebar-active="true"]',
      );
      activeItem?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [selectedKey, moduleMenuItemsKey]);

  return (
    <ShadcnSidebar collapsible="icon" className={cn("border-none")}>
      <ShadcnSidebarRail />
      <SidebarHeader />
      <ShadcnSidebarContent
        className={cn(
          "transition-discrete",
          "duration-200",
          "flex",
          "flex-col",
          "gap-2",
          "pt-2",
          "pb-8",
          "scroll-pb-8",
          "overscroll-contain",
          "border-r",
          "border-border",
          {
            "px-3": open,
            "px-1": !open,
          }
        )}
      >
        {visibleMenuItems.map((item: TreeMenuItem) => (
          <SidebarItem
            key={item.key || item.name}
            item={item}
            selectedKey={selectedKey}
          />
        ))}
      </ShadcnSidebarContent>
    </ShadcnSidebar>
  );
}

function getActiveBackendModule(
  pathname: string,
  modules: typeof backendModules,
) {
  if (modules.length <= 1) {
    return modules[0];
  }

  return modules.find((module) =>
    module.resources.some((route) => pathname.startsWith(`/${route}`)),
  ) ?? modules[0];
}

function filterMenuItemsForModule(
  items: TreeMenuItem[],
  activeModule: (typeof backendModules)[number] | undefined,
  modules: typeof backendModules,
): TreeMenuItem[] {
  if (!activeModule || modules.length <= 1) {
    return items;
  }

  const routeSet = new Set(activeModule.resources.map((route) => `/${route}`));

  return items
    .map((item) => filterMenuItemForModule(item, routeSet))
    .filter(Boolean) as TreeMenuItem[];
}

function filterMenuItemForModule(item: TreeMenuItem, activeRoutes: Set<string>): TreeMenuItem | null {
  const children = item.children
    ?.map((child) => filterMenuItemForModule(child, activeRoutes))
    .filter(Boolean) as TreeMenuItem[] | undefined;

  if (children?.length) {
    return { ...item, children };
  }

  if (item.name === "dashboard" || item.route === "/dashboard") {
    return item;
  }

  const itemRoute = item.route;
  if (itemRoute && Array.from(activeRoutes).some((route) => itemRoute === route || itemRoute.startsWith(`${route}/`))) {
    return item;
  }

  return null;
}

type CanAccessMenuItem = (args: {
  action: string;
  resource?: string;
  params?: Record<string, unknown>;
}) => Promise<{ can?: boolean }>;

async function filterMenuItemsForAccess(
  items: TreeMenuItem[],
  can: CanAccessMenuItem,
): Promise<TreeMenuItem[]> {
  const filtered = await Promise.all(
    items.map((item) => filterMenuItemForAccess(item, can)),
  );

  return filtered.filter(Boolean) as TreeMenuItem[];
}

async function filterMenuItemForAccess(
  item: TreeMenuItem,
  can: CanAccessMenuItem,
): Promise<TreeMenuItem | null> {
  const children = item.children?.length
    ? await filterMenuItemsForAccess(item.children, can)
    : [];

  if (children.length > 0) {
    return { ...item, children };
  }

  if (item.children?.length) {
    return null;
  }

  if (!item.route || item.name === "dashboard" || item.route === "/dashboard") {
    return item;
  }

  const result = await can({
    action: "list",
    resource: item.name,
  });

  return result.can ? item : null;
}

function menuItemsSignature(items: TreeMenuItem[]): string {
  return items
    .map((item) => [
      item.key,
      item.name,
      item.route,
      item.children?.length ? menuItemsSignature(item.children) : "",
    ].join(":"))
    .join("|");
}

type MenuItemProps = {
  item: TreeMenuItem;
  selectedKey?: string;
};

function SidebarItem({ item, selectedKey }: MenuItemProps) {
  const { open } = useShadcnSidebar();

  if (item.meta?.group) {
    return <SidebarItemGroup item={item} selectedKey={selectedKey} />;
  }

  if (item.children && item.children.length > 0) {
    if (open) {
      return <SidebarItemCollapsible item={item} selectedKey={selectedKey} />;
    }
    return <SidebarItemDropdown item={item} selectedKey={selectedKey} />;
  }

  return <SidebarItemLink item={item} selectedKey={selectedKey} />;
}

function SidebarItemGroup({ item, selectedKey }: MenuItemProps) {
  const { children } = item;
  const { open } = useShadcnSidebar();
  const translate = useTranslate();
  const displayName = getDisplayName(item, translate);

  return (
    <div className={cn("border-t", "border-sidebar-border", "pt-4")}>
      <span
        title={displayName}
        className={cn(
          "ml-3",
          "block",
          "pr-2",
          "text-xs",
          "font-semibold",
          "leading-snug",
          "tracking-normal",
          "line-clamp-2",
          "break-words",
          "overflow-hidden",
          "text-muted-foreground",
          "transition-all",
          "duration-200",
          {
            "max-h-16 py-1": open,
            "max-h-0 py-0": !open,
            "opacity-0": !open,
            "opacity-100": open,
            "pointer-events-none": !open,
            "pointer-events-auto": open,
          }
        )}
      >
        {displayName}
      </span>
      {children && children.length > 0 && (
        <div className={cn("flex", "flex-col")}>
          {children.map((child: TreeMenuItem) => (
            <SidebarItem
              key={child.key || child.name}
              item={child}
              selectedKey={selectedKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SidebarItemCollapsible({ item, selectedKey }: MenuItemProps) {
  const { name, children } = item;
  const containsSelectedItem = menuItemContainsKey(item, selectedKey);
  const [isOpen, setIsOpen] = React.useState(containsSelectedItem);

  React.useEffect(() => {
    if (containsSelectedItem) {
      setIsOpen(true);
    }
  }, [containsSelectedItem]);

  const chevronIcon = (
    <ChevronRight
      className={cn(
        "h-4",
        "w-4",
        "shrink-0",
        "text-muted-foreground",
        "transition-transform",
        "duration-200",
        "group-data-[state=open]:rotate-90"
      )}
    />
  );

  return (
    <Collapsible
      key={`collapsible-${name}`}
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("w-full", "group")}
    >
      <CollapsibleTrigger asChild>
        <SidebarButton item={item} rightIcon={chevronIcon} />
      </CollapsibleTrigger>
      <CollapsibleContent
        className={cn("ml-6", "flex", "flex-col", "gap-2", "border-l")}
      >
        {children?.map((child: TreeMenuItem) => (
          <SidebarItem
            key={child.key || child.name}
            item={child}
            selectedKey={selectedKey}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function menuItemContainsKey(item: TreeMenuItem, selectedKey?: string): boolean {
  if (!selectedKey) {
    return false;
  }

  return item.key === selectedKey || Boolean(
    item.children?.some((child) => menuItemContainsKey(child, selectedKey)),
  );
}

function SidebarItemDropdown({ item, selectedKey }: MenuItemProps) {
  const { children } = item;
  const Link = useLink();
  const translate = useTranslate();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarButton item={item} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="right"
        align="start"
        className={cn("w-72", "max-w-[calc(100vw-4rem)]")}
      >
        {children?.map((child: TreeMenuItem) => {
          const { key: childKey } = child;
          const isSelected = childKey === selectedKey;
          const displayName = getDisplayName(child, translate);

          return (
            <DropdownMenuItem
              key={childKey || child.name}
              asChild
              className={cn("items-start", "whitespace-normal")}
            >
              <Link
                to={child.route || ""}
                title={displayName}
                aria-label={displayName}
                className={cn("flex w-full min-w-0 items-start gap-2", {
                  "bg-accent text-accent-foreground": isSelected,
                })}
              >
                <ItemIcon
                  item={child}
                  icon={child.meta?.icon ?? child.icon}
                  isSelected={isSelected}
                />
                <span
                  className={cn(
                    "min-w-0",
                    "flex-1",
                    "break-words",
                    "leading-snug"
                  )}
                >
                  {displayName}
                </span>
              </Link>
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SidebarItemLink({ item, selectedKey }: MenuItemProps) {
  const isSelected = item.key === selectedKey;

  return <SidebarButton item={item} isSelected={isSelected} asLink={true} />;
}

function SidebarHeader() {
  const { title } = useRefineOptions();
  const { open, isMobile } = useShadcnSidebar();

  return (
    <ShadcnSidebarHeader
      className={cn(
        "p-0",
        "h-16",
        "border-b",
        "border-border",
        "flex-row",
        "items-center",
        "justify-between",
        "overflow-hidden"
      )}
    >
      <div
        className={cn(
          "whitespace-nowrap",
          "flex",
          "min-w-0",
          "flex-1",
          "flex-row",
          "h-full",
          "items-center",
          "gap-2",
          "overflow-hidden",
          "transition-discrete",
          "duration-200",
          {
            "justify-center px-1": !open,
            "justify-start pl-5 pr-1": open,
          }
        )}
      >
        <div className={cn("flex", "shrink-0", "items-center", "justify-center", {
          "h-8 w-8": !open,
          "h-10 w-10": open,
        })}>
          {title.icon}
        </div>
        <h2
          title={typeof title.text === "string" ? title.text : undefined}
          className={cn(
            "text-sm",
            "font-bold",
            "min-w-0",
            "line-clamp-2",
            "whitespace-normal",
            "break-words",
            "leading-snug",
            "transition-opacity",
            "duration-200",
            {
              "hidden w-0 opacity-0": !open,
              "block flex-1 opacity-100": open,
            }
          )}
        >
          {title.text}
        </h2>
      </div>

      <ShadcnSidebarTrigger
        className={cn("text-muted-foreground", "mr-1.5", "shrink-0", {
          "hidden opacity-0": !open && !isMobile,
          "opacity-100": open || isMobile,
          "pointer-events-auto": open || isMobile,
          "pointer-events-none": !open && !isMobile,
        })}
      />
    </ShadcnSidebarHeader>
  );
}

function getDisplayName(item: TreeMenuItem, translate: ReturnType<typeof useTranslate>) {
  const fallback = item.meta?.label ?? item.label ?? item.name;
  const translated = item.meta?.i18nKey
    ? translate(item.meta.i18nKey, fallback)
    : fallback;
  return String(translated);
}

type IconProps = {
  item: TreeMenuItem;
  icon: React.ReactNode;
  isSelected?: boolean;
};

function ItemIcon({ item, icon, isSelected }: IconProps) {
  const fallback = icon ?? <ListIcon />;
  const resolvedIcon = resolveMenuIcon({
    type: item.name === "dashboard" ? "dashboard" : item.children?.length ? "chapter" : "resource",
    name: item.name,
    label: item.meta?.label,
    parent: typeof item.meta?.parent === "string" ? item.meta.parent : undefined,
    fallback,
  });

  return (
    <div
      className={cn("mt-0.5", "flex", "w-4", "shrink-0", "justify-center", {
        "text-muted-foreground": !isSelected,
        "text-sidebar-primary-foreground": isSelected,
      })}
    >
      {resolvedIcon}
    </div>
  );
}

type SidebarButtonProps = React.ComponentProps<typeof Button> & {
  item: TreeMenuItem;
  isSelected?: boolean;
  rightIcon?: React.ReactNode;
  asLink?: boolean;
  onClick?: () => void;
};

function SidebarButton({
  item,
  isSelected = false,
  rightIcon,
  asLink = false,
  className,
  onClick,
  ...props
}: SidebarButtonProps) {
  const Link = useLink();
  const translate = useTranslate();
  const displayName = getDisplayName(item, translate);

  const buttonContent = (
    <>
      <ItemIcon item={item} icon={item.meta?.icon ?? item.icon} isSelected={isSelected} />
      <span
        className={cn(
          "line-clamp-2",
          "min-w-0",
          "flex-1",
          "break-words",
          "whitespace-normal",
          "text-left",
          "leading-snug",
          "tracking-normal",
          "group-data-[collapsible=icon]:hidden",
          {
            "font-normal": !isSelected,
            "font-semibold": isSelected,
            "text-sidebar-primary-foreground": isSelected,
            "text-foreground": !isSelected,
          }
        )}
      >
        {displayName}
      </span>
      {rightIcon}
    </>
  );

  return (
    <Button
      asChild={!!(asLink && item.route)}
      variant="ghost"
      size="lg"
      className={cn(
        "flex h-auto min-h-10 w-full items-start justify-start gap-2 whitespace-normal py-2 !px-3 text-sm",
        "group-data-[collapsible=icon]:h-10 group-data-[collapsible=icon]:min-h-10 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:!px-2",
        {
          "bg-sidebar-primary": isSelected,
          "hover:!bg-sidebar-primary/90": isSelected,
          "text-sidebar-primary-foreground": isSelected,
          "hover:text-sidebar-primary-foreground": isSelected,
        },
        className
      )}
      title={displayName}
      aria-label={displayName}
      data-sidebar-active={isSelected ? "true" : undefined}
      onClick={onClick}
      {...props}
    >
      {asLink && item.route ? (
        <Link
          to={item.route}
          className={cn(
            "flex w-full min-w-0 items-start gap-2",
            "group-data-[collapsible=icon]:justify-center"
          )}
        >
          {buttonContent}
        </Link>
      ) : (
        buttonContent
      )}
    </Button>
  );
}

Sidebar.displayName = "Sidebar";
