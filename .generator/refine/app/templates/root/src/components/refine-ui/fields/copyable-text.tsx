import * as React from "react";
import { Check, Copy } from "lucide-react";
import { useTranslate } from "@refinedev/core";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CopyableTextProps = {
  value: unknown;
  compact?: boolean;
  className?: string;
};

export function CopyableText({ value, compact = false, className }: CopyableTextProps) {
  const t = useTranslate();
  const [copied, setCopied] = React.useState(false);
  const text = value === null || value === undefined ? "" : String(value);
  const preview = text.replace(/\s+/g, " ").trim();
  const copyLabel = copied
    ? t("actions.copied", "Copied")
    : t("actions.copy", "Copy");

  const copy = React.useCallback(async () => {
    if (!text) return;
    await copyText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [text]);

  if (!text) {
    return <span className="text-sm text-muted-foreground">-</span>;
  }

  if (compact) {
    return (
      <div className={cn("flex max-w-md items-center gap-1", className)}>
        <code className="min-w-0 flex-1 truncate font-mono text-xs" title={text}>
          {preview}
        </code>
        <CopyButton copied={copied} label={copyLabel} onClick={copy} />
      </div>
    );
  }

  return (
    <div className={cn("relative", className)}>
      <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-4 pr-12 font-mono text-xs leading-5 whitespace-pre text-foreground">
        {text}
      </pre>
      <div className="absolute right-2 top-2">
        <CopyButton copied={copied} label={copyLabel} onClick={copy} />
      </div>
    </div>
  );
}

type CopyButtonProps = {
  copied: boolean;
  label: string;
  onClick: () => void;
};

function CopyButton({ copied, label, onClick }: CopyButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          onClick={(event) => {
            event.stopPropagation();
            void onClick();
          }}
        >
          {copied ? <Check /> : <Copy />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

async function copyText(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}
