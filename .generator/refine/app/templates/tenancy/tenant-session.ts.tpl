type TenantSelection = { id: string; label: string; owner: string };
const key = "medol-selected-tenant:" + <%- tenantScopeKey %>;
const owner = (): string | undefined => {
  try { return JSON.parse(localStorage.getItem("medol-current-user") ?? "null")?.id; }
  catch { return undefined; }
};

export const selectedTenant = (): TenantSelection | undefined => {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as TenantSelection | null;
    const user = owner();
    return user && value?.id && value.owner === user ? value : undefined;
  } catch { return undefined; }
};

export const clearSelectedTenant = () => sessionStorage.removeItem(key);

export const selectTenant = (tenant?: { id: string; label: string }) => {
  const user = owner();
  if (tenant && !user) throw new Error("An authenticated account is required.");
  if (tenant) sessionStorage.setItem(key, JSON.stringify({...tenant, owner: user}));
  else clearSelectedTenant();
  // A full reload discards request caches, dictionary labels and unsaved forms.
  window.location.replace(import.meta.env.BASE_URL);
};
