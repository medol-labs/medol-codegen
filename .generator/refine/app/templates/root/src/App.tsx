import { Refine, type DataProvider } from "@refinedev/core";
import { DevtoolsPanel, DevtoolsProvider } from "@refinedev/devtools";
import { RefineKbar, RefineKbarProvider } from "@refinedev/kbar";

import routerProvider, {
  DocumentTitleHandler,
  UnsavedChangesNotifier
} from "@refinedev/react-router";
import { liveProvider } from "@refinedev/supabase";
import { useEffect, useState } from "react";
import { BrowserRouter } from "react-router";
import { Toaster } from "./components/refine-ui/notification/toaster";
import { useNotificationProvider } from "./components/refine-ui/notification/use-notification-provider";
import { ThemeProvider } from "./components/refine-ui/theme/theme-provider";
import { AppRouter } from "./providers/app-router";
import authProvider from "./providers/mock-auth";
import { commandDataProvider, commandProvider } from "./providers/command-provider";
import { dataProvider } from "./providers/data";
import {
  getCurrentLocale,
  getPersistedLocale,
  i18nProvider,
  LOCALE_CHANGE_EVENT
} from "./providers/i18n";
import { backendModules, resources } from "./providers/resources";
import { supabaseClient } from "./providers/supabase-client";

import "./App.css";

const backendDataProviders: Record<string, Required<DataProvider>> = Object.fromEntries(
  backendModules.map((module) => [
    module.dataProviderName,
    commandDataProvider(supabaseClient, { baseUrl: module.apiUrl }),
  ]),
);

const defaultBackendProvider =
  backendDataProviders[backendModules[0]?.dataProviderName] ?? commandProvider;

function App() {
  const [localeVersion, setLocaleVersion] = useState(0);

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
    <BrowserRouter>
      <RefineKbarProvider>
        <ThemeProvider>
          <DevtoolsProvider>
            <Refine
              key={localeVersion}
              dataProvider={{
                default: defaultBackendProvider,
                command: defaultBackendProvider,
                query: dataProvider,
                ...backendDataProviders,
              }}
              liveProvider={liveProvider(supabaseClient)}
              authProvider={authProvider}
              routerProvider={routerProvider}
              notificationProvider={useNotificationProvider()}
              i18nProvider={i18nProvider}
              resources={resources}
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
            // accessControlProvider={accessControlProvider}
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
    </BrowserRouter>
  );
}

export default App;
