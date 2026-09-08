import { Refine, type DataProvider } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import routerProvider, {
  DocumentTitleHandler,
  UnsavedChangesNotifier
} from "@refinedev/react-router";
import { liveProvider } from "@refinedev/supabase";
import { useEffect, useMemo, useState } from "react";
import { BrowserRouter } from "react-router";
import { Toaster } from "./components/refine-ui/notification/toaster";
import { useNotificationProvider } from "./components/refine-ui/notification/use-notification-provider";
import { ThemeProvider } from "./components/refine-ui/theme/theme-provider";
import { AppRouter } from "./providers/app-router";
import { accessControlProvider } from "./providers/permify-access-control-provider";
import authProvider from "./providers/auth";
import { commandDataProvider, commandProvider } from "./providers/command-provider";
import { dataProvider } from "./providers/data";
import {
  getCurrentLocale,
  getPersistedLocale,
  i18nProvider,
  LOCALE_CHANGE_EVENT
} from "./providers/i18n";
import { isSupabaseConfigured } from "./providers/constants";
import { backendModules, resources } from "./providers/resources";
import { supabaseClient } from "./providers/supabase-client";
import {
  AppExtensionProvider,
  useAppExtensions,
} from "./domain/app-extensions";

import "./App.css";

const configuredLiveProvider = isSupabaseConfigured()
  ? liveProvider(supabaseClient)
  : undefined;

function RefineApplication() {
  const [localeVersion, setLocaleVersion] = useState(0);
  const extensions = useAppExtensions();
  const visibleBackendModules = extensions.filterBackendModules(backendModules);
  const visibleResources = extensions.filterResources(resources);
  const backendDataProviders = useMemo(
    () => Object.fromEntries(
      visibleBackendModules.map((module) => [
        module.dataProviderName,
        commandDataProvider(supabaseClient, {
          baseUrl: extensions.resolveBackendBaseUrl(module),
        }),
      ]),
    ) as Record<string, Required<DataProvider>>,
    [extensions.dataProviderKey],
  );
  const defaultBackendProvider =
    backendDataProviders[visibleBackendModules[0]?.dataProviderName] ?? commandProvider;

  useEffect(() => {
    const handleLocaleChange = () => setLocaleVersion((version) => version + 1);

    window.addEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
    const persistedLocale = getPersistedLocale();
    if (persistedLocale && persistedLocale !== getCurrentLocale()) {
      void i18nProvider.changeLocale(persistedLocale);
    }

    return () => window.removeEventListener(LOCALE_CHANGE_EVENT, handleLocaleChange);
  }, []);

  return (
    <RefineKbarProvider>
        <ThemeProvider>
          <DevtoolsProvider>
            <Refine
              key={`${localeVersion}:${extensions.dataProviderKey}`}
              dataProvider={{
                default: defaultBackendProvider,
                command: defaultBackendProvider,
                query: dataProvider,
                ...backendDataProviders,
              }}
              liveProvider={configuredLiveProvider}
              authProvider={authProvider}
              routerProvider={routerProvider}
              notificationProvider={useNotificationProvider()}
              i18nProvider={i18nProvider}
              resources={visibleResources}
              accessControlProvider={accessControlProvider}
              options={{
                syncWithLocation: true,
                warnWhenUnsavedChanges: true,
                title: {
                  text: "<%= appTitle %>",
                  icon: (
                    <img
                      src={`${import.meta.env.BASE_URL}medol-logo.png`}
                      alt="<%= appTitle %> logo"
                      className="block h-full w-full shrink-0 object-contain"
                    />
                  ),
                },
                projectId: "yKo8Ul-25eSBl-weC1qb",
              }}
            >
              <AppRouter />
              <Toaster />
              <RefineKbar />
              <UnsavedChangesNotifier />
              <DocumentTitleHandler />
            </Refine>
            <DevtoolsPanel />
          </DevtoolsProvider>
        </ThemeProvider>
      </RefineKbarProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppExtensionProvider>
        <RefineApplication />
      </AppExtensionProvider>
    </BrowserRouter>
  );
}

export default App;
