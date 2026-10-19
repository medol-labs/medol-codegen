import {useEffect, useState} from "react";
import {useTranslate} from "@refinedev/core";
import {Building2, Check, ChevronDown, Loader2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from "@/components/ui/dropdown-menu";
import {authBackendBaseUrl, authFetch} from "@/providers/api-auth";
import {selectedTenant, selectTenant} from "@/lib/tenant-session";

type Choice = {id: string; label: string};
type ChoicePage = {items: Choice[]; nextCursor?: string | null};

export function TenantSwitcher({compact = false}: {compact?: boolean}) {
  const t = useTranslate();
  const [items, setItems] = useState<Choice[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const current = selectedTenant();
  const label = current?.label ?? t("tenancy.select", "Select tenant");
  const load = async (after?: string) => {
    setLoading(true); setFailed(false);
    try {
      const query = new URLSearchParams({size: "50", ...(after ? {after} : {})});
      const response = await authFetch(`${authBackendBaseUrl()}/api/tenancy/tenants?${query}`);
      if (!response.ok) throw new Error("Tenant choices unavailable");
      const page = await response.json() as ChoicePage;
      setItems(previous => after ? [...previous, ...page.items.filter(item => !previous.some(old => old.id === item.id))] : page.items);
      setCursor(page.nextCursor ?? null);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);

  return <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" size="sm" title={label} aria-label={label} className={compact ? "h-8 w-8 p-0" : "h-9 max-w-64 gap-2"}>
        <Building2 className="size-4 shrink-0" />
        {!compact && <><span className="truncate">{label}</span><ChevronDown className="size-3 shrink-0" /></>}
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="max-h-80 w-64 overflow-y-auto">
      <DropdownMenuItem onSelect={() => selectTenant()}>{t("tenancy.controlPlane", "Platform management")}</DropdownMenuItem>
      {items.map(item => <DropdownMenuItem key={item.id} onSelect={() => selectTenant(item)}>
        <span className="min-w-0 flex-1 truncate">{item.label}</span>{item.id === current?.id && <Check className="size-4" />}
      </DropdownMenuItem>)}
      {!loading && !failed && !items.length && <DropdownMenuItem disabled>{t("tenancy.empty", "No available tenants")}</DropdownMenuItem>}
      {(failed || cursor) && <DropdownMenuItem disabled={loading} onSelect={event => { event.preventDefault(); void load(failed ? undefined : cursor ?? undefined); }}>
        {failed ? t("tenancy.retry", "Retry") : t("tenancy.more", "Load more")}
      </DropdownMenuItem>}
      {loading && <DropdownMenuItem disabled><Loader2 className="size-4 animate-spin" />{t("tenancy.loading", "Loading")}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}
