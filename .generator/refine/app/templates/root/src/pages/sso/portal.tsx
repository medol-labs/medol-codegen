"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslate } from "@refinedev/core";
import { Loader2 } from "lucide-react";
import { useSearchParams } from "react-router";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { problemDetailDescription } from "@/lib/problem-detail";
import {
  clearLocalAuth,
  exchangePortalJwtForSystemSession,
  storeLocalAuth,
  type PortalSsoExchangeResponse,
} from "@/providers/api-auth";

const readPortalJwt = (searchParams: URLSearchParams): string =>
  searchParams.get("token") ??
  searchParams.get("jwt") ??
  searchParams.get("portalJwt") ??
  "";

const readRequestedPath = (searchParams: URLSearchParams): string | null => {
  const value = searchParams.get("redirect") ?? searchParams.get("requestedPath");
  if (!value?.startsWith("/") || value.startsWith("//")) return null;
  return value;
};

const readSystemSource = (searchParams: URLSearchParams): string | null => {
  const value = searchParams.get("systemSource") ?? searchParams.get("userSource");
  return value?.trim() || null;
};

export const PortalSso = () => {
  const t = useTranslate();
  const tRef = useRef(t);
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState<PortalSsoExchangeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    const portalJwt = readPortalJwt(searchParams);
    const requestedPath = readRequestedPath(searchParams);
    const systemSource = readSystemSource(searchParams);

    if (!portalJwt) {
      setError(tRef.current("errors.portalTokenMissing", "Portal token is missing."));
      return;
    }

    let active = true;

    exchangePortalJwtForSystemSession({ portalJwt, requestedPath, systemSource })
      .then((payload) => {
        if (!active) return;
        storeLocalAuth(payload.accessToken, payload.user);
        if (payload.permissionAssignmentRequired) {
          setResult(payload);
          return;
        }
        window.location.assign(payload.redirectPath || "/");
      })
      .catch((reason) => {
        if (!active) return;
        const translate = tRef.current;
        setError(problemDetailDescription(reason, translate, translate("errors.portalSignInFailed", "Portal sign-in failed.")));
      });

    return () => {
      active = false;
    };
  }, [searchParams]);

  return (
    <div className={cn("bg-background", "flex", "min-h-svh", "items-center", "justify-center", "px-6", "py-10")}>
      <Card className={cn("w-full", "max-w-[420px]", "p-8")}>
        <CardHeader className={cn("px-0")}>
          <CardTitle className={cn("text-2xl", "font-semibold")}>{t("sso.portal.title", "Portal sign in")}</CardTitle>
          <CardDescription className={cn("text-muted-foreground", "font-medium")}>
            {t("sso.portal.description", "Verifying your portal session.")}
          </CardDescription>
        </CardHeader>
        <CardContent className={cn("px-0")}>
          {!result && !error && (
            <div className={cn("flex", "items-center", "gap-3", "text-sm", "text-muted-foreground")}>
              <Loader2 className={cn("size-4", "animate-spin")} />
              {t("sso.portal.signingIn", "Signing you in...")}
            </div>
          )}
          {result && (
            <Alert>
              <AlertTitle>{t("sso.portal.awaitingPermissionsTitle", "Account awaiting permissions")}</AlertTitle>
              <AlertDescription>
                {result.notice || t("sso.portal.awaitingPermissionsDescription", "Please contact an administrator to assign permissions before using the system.")}
              </AlertDescription>
            </Alert>
          )}
          {error && (
            <Alert variant="destructive">
              <AlertTitle>{t("sso.portal.failedTitle", "Portal sign-in failed")}</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </CardContent>
        <CardFooter className={cn("px-0", "pt-2")}>
          <Button
            type="button"
            variant="outline"
            className={cn("w-full")}
            onClick={() => {
              clearLocalAuth();
              window.location.assign("/login");
            }}
          >
            {t("sso.portal.backToSignIn", "Back to sign in")}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
};
