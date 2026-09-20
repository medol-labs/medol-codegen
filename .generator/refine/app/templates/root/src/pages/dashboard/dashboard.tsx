import { CanAccess, useTranslate } from "@refinedev/core";
import { ArrowRight, Boxes, Database } from "lucide-react";
import { Link } from "react-router";

import { useAppExtensions } from "@/domain/app-extensions";
import { backendModules, resources } from "@/providers/resources";

const resourceRoute = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const Dashboard = () => {
  const translate = useTranslate();
  const extensions = useAppExtensions();
  const visibleModules = extensions.filterBackendModules(backendModules);
  const visibleResources = extensions
    .filterResources(resources)
    .filter((resource) => resource.name !== "dashboard" && resourceRoute(resource.list));

  const parentLabels = new Map(
    resources.map((resource) => [
      resource.name,
      translate(
        String(resource.meta?.i18nKey ?? ""),
        String(resource.meta?.label ?? resource.name),
      ),
    ]),
  );

  const modules = visibleModules.map((module) => ({
    ...module,
    resources: visibleResources.filter(
      (resource) => resource.meta?.moduleName === module.name,
    ),
  }));

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-border px-4 py-6 lg:px-6">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {modules.length} {modules.length === 1 ? "service" : "services"} and{" "}
          {visibleResources.length} available resources
        </p>
      </header>

      <div className="grid border-b border-border sm:grid-cols-2">
        <div className="flex items-center gap-3 px-4 py-4 lg:px-6">
          <Boxes className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Services</p>
            <p className="text-2xl font-semibold tabular-nums">{modules.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-3 border-t border-border px-4 py-4 sm:border-l sm:border-t-0 lg:px-6">
          <Database className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm font-medium">Resources</p>
            <p className="text-2xl font-semibold tabular-nums">
              {visibleResources.length}
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col px-4 py-2 lg:px-6">
        {modules.map((module) => (
          <section key={module.name} className="border-b border-border py-5 last:border-b-0">
            <div className="mb-3 flex min-w-0 items-center justify-between gap-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold">{module.label}</h2>
                <p className="text-sm text-muted-foreground">
                  {module.resources.length}{" "}
                  {module.resources.length === 1 ? "resource" : "resources"}
                </p>
              </div>
              {module.homeRoute && (
                <Link
                  to={module.homeRoute}
                  className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  Open
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </div>

            {module.resources.length > 0 ? (
              <div className="grid gap-x-6 sm:grid-cols-2 xl:grid-cols-3">
                {module.resources.slice(0, 9).map((resource) => {
                  const route = resourceRoute(resource.list);
                  const label = translate(
                    String(resource.meta?.i18nKey ?? ""),
                    String(resource.meta?.label ?? resource.name),
                  );
                  const parent = resource.meta?.parent
                    ? parentLabels.get(String(resource.meta.parent))
                    : undefined;

                  return (
                    <CanAccess
                      key={resource.name}
                      resource={resource.name}
                      action="list"
                    >
                      <Link
                        to={route ?? "/dashboard"}
                        className="group flex min-w-0 items-center gap-3 border-t border-border py-3 first:border-t-0 sm:[&:nth-child(2)]:border-t-0 xl:[&:nth-child(3)]:border-t-0"
                      >
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center text-muted-foreground group-hover:text-foreground">
                          {resource.meta?.icon ?? <Database className="h-4 w-4" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">
                            {label}
                          </span>
                          {parent && (
                            <span className="block truncate text-xs text-muted-foreground">
                              {parent}
                            </span>
                          )}
                        </span>
                        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
                      </Link>
                    </CanAccess>
                  );
                })}
              </div>
            ) : (
              <p className="py-3 text-sm text-muted-foreground">
                No navigable resources are available for this service.
              </p>
            )}
          </section>
        ))}
      </div>
    </main>
  );
};
