import { UndoableNotification } from "@/components/refine-ui/notification/undoable-notification";
import { i18nProvider } from "@/providers/i18n";
import type { NotificationProvider } from "@refinedev/core";
import { toast } from "sonner";

const translate = (key: string, params: Record<string, unknown> | string, fallback?: string) =>
  i18nProvider.translate(key, params, fallback);

const statusCodeMessagePattern = /^Error \(status code: (undefined|null|\d+)\)$/i;
const networkErrorMessages = new Set([
  "Failed to fetch",
  "Load failed",
  "NetworkError when attempting to fetch resource.",
]);

const isNetworkErrorText = (value: unknown) =>
  typeof value === "string" && networkErrorMessages.has(value.trim());

const notificationText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : value === null || value === undefined ? fallback : String(value);

const notificationDescription = (value: unknown): string | undefined => {
  const text = notificationText(value).trim();
  return text ? text : undefined;
};

type LocalizedNotification = {
  message: string;
  description?: string;
};

const localizeErrorNotification = (message: unknown, description: unknown): LocalizedNotification => {
  const messageText = typeof message === "string" ? message.trim() : undefined;
  const statusMatch = messageText?.match(statusCodeMessagePattern);

  if ((statusMatch && !/^\d+$/.test(statusMatch[1])) || isNetworkErrorText(messageText) || isNetworkErrorText(description)) {
    return {
      message: notificationText(translate("notifications.errors.networkTitle", "Connection failed"), "Connection failed"),
      description: notificationDescription(translate(
        "notifications.errors.networkDescription",
        "Unable to connect to the service. Check that the backend is running and the gateway URL is reachable.",
      )),
    };
  }

  if (statusMatch) {
    const status = statusMatch[1];
    return {
      message: notificationText(translate("notifications.errors.httpTitle", { status }, "Request failed (HTTP {{status}})")),
      description: typeof description === "string" && description.trim()
        ? description
        : notificationDescription(translate("notifications.errors.httpDescription", { status }, "The server returned HTTP {{status}}.")),
    };
  }

  return {
    message: messageText || notificationText(translate("notifications.errors.genericTitle", "Operation failed"), "Operation failed"),
    description: notificationDescription(description),
  };
};

export function useNotificationProvider(): NotificationProvider {
  return {
    open: ({
      key,
      type,
      message,
      description,
      undoableTimeout,
      cancelMutation,
    }) => {
      const normalized = type === "error"
        ? localizeErrorNotification(message, description)
        : {
            message: notificationText(message, "Notification"),
            description: notificationDescription(description),
          };

      switch (type) {
        case "success":
          toast.success(normalized.message, {
            id: key,
            description: normalized.description,
            richColors: true,
          });
          return;

        case "error":
          toast.error(normalized.message, {
            id: key,
            description: normalized.description,
            richColors: true,
          });
          return;

        case "progress": {
          const toastId = key || Date.now();

          toast(
            () => (
              <UndoableNotification
                message={normalized.message}
                description={normalized.description}
                undoableTimeout={undoableTimeout}
                cancelMutation={cancelMutation}
                onClose={() => toast.dismiss(toastId)}
              />
            ),
            {
              id: toastId,
              duration: (undoableTimeout || 5) * 1000,
              unstyled: true,
            }
          );
          return;
        }

        default:
          return;
      }
    },
    close: (id) => {
      toast.dismiss(id);
    },
  };
}
