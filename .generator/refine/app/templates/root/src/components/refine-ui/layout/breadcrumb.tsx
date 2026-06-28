"use client";

import {
  Breadcrumb as ShadcnBreadcrumb,
  BreadcrumbItem as ShadcnBreadcrumbItem,
  BreadcrumbList as ShadcnBreadcrumbList,
  BreadcrumbPage as ShadcnBreadcrumbPage,
  BreadcrumbSeparator as ShadcnBreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  matchResourceFromRoute,
  useBreadcrumb,
  useLink,
  useResourceParams,
  useTranslate,
  type IResourceItem,
} from "@refinedev/core";
import { Home } from "lucide-react";
import { Fragment, useMemo } from "react";

export function Breadcrumb() {
  const Link = useLink();
  const translate = useTranslate();
  const { breadcrumbs } = useBreadcrumb();
  const { resources } = useResourceParams();
  const rootRouteResource = matchResourceFromRoute("/", resources);

  const breadCrumbItems = useMemo(() => {
    const list: {
      key: string;
      href: string;
      Component: React.ReactNode;
    }[] = [];

    list.push({
      key: "breadcrumb-item-home",
      href: rootRouteResource.matchedRoute ?? "/",
      Component: (
        <Link to={rootRouteResource.matchedRoute ?? "/"}>
          {rootRouteResource?.resource?.meta?.icon ?? (
            <Home className="h-4 w-4" />
          )}
        </Link>
      ),
    });

    for (const { label, href } of breadcrumbs) {
      const translatedLabel = translateBreadcrumbLabel(label, resources, translate);
      list.push({
        key: `breadcrumb-item-${label}`,
        href: href ?? "",
        Component: href ? <Link to={href}>{translatedLabel}</Link> : <span>{translatedLabel}</span>,
      });
    }

    return list;
  }, [breadcrumbs, Link, resources, rootRouteResource, translate]);

  return (
    <ShadcnBreadcrumb>
      <ShadcnBreadcrumbList>
        {breadCrumbItems.map((item, index) => {
          if (index === breadCrumbItems.length - 1) {
            return (
              <ShadcnBreadcrumbPage key={item.key}>
                {item.Component}
              </ShadcnBreadcrumbPage>
            );
          }

          return (
            <Fragment key={item.key}>
              <ShadcnBreadcrumbItem key={item.key}>
                {item.Component}
              </ShadcnBreadcrumbItem>
              <ShadcnBreadcrumbSeparator />
            </Fragment>
          );
        })}
      </ShadcnBreadcrumbList>
    </ShadcnBreadcrumb>
  );
}

function translateBreadcrumbLabel(
  label: string,
  resources: IResourceItem[],
  translate: ReturnType<typeof useTranslate>
) {
  const resource = resources.find((item) => {
    const candidates = [
      item.name,
      item.identifier,
      item.meta?.label,
      item.meta?.i18nKey ? translate(item.meta.i18nKey, item.meta?.label ?? item.identifier ?? item.name) : undefined,
    ].filter(Boolean);
    return candidates.some((candidate) => candidate === label);
  });

  if (resource?.meta?.i18nKey) {
    return translate(resource.meta.i18nKey, resource.meta?.label ?? resource.identifier ?? resource.name);
  }

  const actionKey = breadcrumbActionKey(label);
  return actionKey ? translate(actionKey, label) : label;
}

function breadcrumbActionKey(label: string) {
  const normalized = label.trim().toLowerCase();
  if (normalized === "create") return "breadcrumb.actions.create";
  if (normalized === "edit") return "breadcrumb.actions.edit";
  if (normalized === "show" || normalized === "detail") return "breadcrumb.actions.show";
  if (normalized === "list") return "breadcrumb.actions.list";
  return undefined;
}

Breadcrumb.displayName = "Breadcrumb";
