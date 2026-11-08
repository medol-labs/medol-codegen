import { useEffect, useState } from "react";
import { useTranslate } from "@refinedev/core";
import { useFileDownload } from "@/components/download/file-download";
import { Button } from "@/components/ui/button";
import { authFetch } from "@/providers/api-auth";

type Field = { name: string; label: string; type: string; required: boolean };
type Contract = { parameters: Field[]; columns: Field[] };
type Page = { rows: Record<string, unknown>[]; hasMore: boolean; source: {sourceVersion: string; consistency: string} };
type Job = {executionId: string; state: string; revision: number; attempt: number; rowCount: number; errorCode?: string; source?: Page["source"]};

export function ReportPanel({reportVersionId, backendModuleName}: {reportVersionId: string; backendModuleName: string}) {
  const t = useTranslate();
  const {baseUrl, download, downloading} = useFileDownload({backendModuleName});
  const [contract, setContract] = useState<Contract>();
  const [values, setValues] = useState<Record<string, string>>({});
  const [page, setPage] = useState<Page>();
  const [offset, setOffset] = useState(0);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = `${baseUrl.replace(/\/$/, "")}/api/reports`;
  async function request(path: string, body?: string) {
    const response = await authFetch(root + path, body === undefined ? undefined : {method: "POST", headers: {"Content-Type": "application/json"}, body});
    if (!response.ok) {
      const problem = await response.json().catch(() => ({}));
      throw new Error(problem.detail ?? `HTTP ${response.status}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : undefined;
  }
  useEffect(() => {
    let active = true;
    setContract(undefined); setPage(undefined); setJobs([]); setValues({}); setError("");
    request(`/${encodeURIComponent(reportVersionId)}/contract`).then(value => {if (active) setContract(value);}).catch(e => {if (active) setError(String(e.message));});
    return () => {active = false;};
  }, [root, reportVersionId]);
  function parameters() {
    return "{" + (contract?.parameters ?? []).flatMap(field => {
      const value = values[field.name] ?? "";
      if (value === "") {if (field.required) throw new Error(`${field.label}: ${t("reporting.required", "Required")}`); return [];}
      let encoded = JSON.stringify(value);
      if (field.type === "INTEGER" || field.type === "DECIMAL") {
        const valid = field.type === "INTEGER" ? /^-?(0|[1-9]\d*)$/ : /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;
        if (!valid.test(value)) throw new Error(`${field.label}: ${t("reporting.invalidNumber", "Invalid number")}`);
        encoded = value; // Preserve decimal/64-bit integer text; do not round through a JS Number.
      } else if (field.type === "BOOLEAN") encoded = value === "true" ? "true" : "false";
      return [`${JSON.stringify(field.name)}:${encoded}`];
    }).join(",") + "}";
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try {await action();} catch (e) {setError(e instanceof Error ? e.message : String(e));} finally {setBusy(false);}
  }
  async function refreshJobs() {setJobs(await request(`/${encodeURIComponent(reportVersionId)}/executions`));}
  async function query(next: number) {
    const result = await request(`/${encodeURIComponent(reportVersionId)}/query`, `{"parameters":${parameters()},"offset":${next},"limit":50}`);
    setPage(result); setOffset(next);
  }
  return <section className="space-y-4 rounded border p-4">
    <h2 className="font-semibold">{t("reporting.workspace", "Report query and export")}</h2>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <div className="grid gap-3 md:grid-cols-2">
      {contract?.parameters.map(field => <label key={field.name} className="flex flex-col gap-1">
        <span>{field.label}{field.required ? " *" : ""}</span>
        {field.type === "BOOLEAN" ? <select className="rounded border p-2" value={values[field.name] ?? ""} disabled={busy} onChange={e => {setValues({...values, [field.name]: e.target.value}); setPage(undefined);}}>
          <option value="">—</option><option value="true">{t("values.boolean.true", "True")}</option><option value="false">{t("values.boolean.false", "False")}</option>
        </select> : <input className="rounded border p-2" type={field.type === "DATE" ? "date" : "text"} placeholder={field.type === "INSTANT" ? "2026-01-01T00:00:00Z" : undefined} value={values[field.name] ?? ""} disabled={busy} onChange={e => {setValues({...values, [field.name]: e.target.value}); setPage(undefined);}} />}
      </label>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button disabled={busy || !contract} onClick={() => void run(() => query(0))}>{t("reporting.query", "Query")}</Button>
      <Button disabled={busy || !contract} onClick={() => void run(async () => {
        await request(`/${encodeURIComponent(reportVersionId)}/exports`, `{"executionId":${JSON.stringify(crypto.randomUUID())},"parameters":${parameters()}}`); await refreshJobs();
      })}>{t("reporting.export", "Export CSV")}</Button>
      <Button variant="outline" disabled={busy} onClick={() => void run(refreshJobs)}>{t("reporting.refresh", "Refresh my recent exports")}</Button>
    </div>
    {page && <>
      <p className="text-sm">{t("reporting.source", "Data source")}: {page.source.sourceVersion} · {t(`reporting.consistency.${page.source.consistency}`, page.source.consistency)}</p>
      <div className="overflow-auto"><table className="w-full text-sm"><thead><tr>{contract?.columns.map(c => <th className="p-2 text-left" key={c.name}>{c.label}</th>)}</tr></thead>
      <tbody>{page.rows.map((row, index) => <tr key={index}>{contract?.columns.map(c => <td className="border-t p-2" key={c.name}>{String(row[c.name] ?? "")}</td>)}</tr>)}</tbody></table></div>
      <div className="flex gap-2"><Button variant="outline" disabled={busy || offset === 0} onClick={() => void run(() => query(offset - 50))}>{t("reporting.previous", "Previous")}</Button>
      <Button variant="outline" disabled={busy || !page.hasMore || offset >= 10000} onClick={() => void run(() => query(offset + 50))}>{t("reporting.next", "Next")}</Button></div>
    </>}
    <p className="text-sm text-muted-foreground">{t("reporting.retryNotice", "Retrying an export reads the source again and may produce newer results. The list shows your latest 50 exports.")}</p>
    {jobs.map(job => <div className="flex flex-wrap items-center gap-3 border-t py-2" key={job.executionId}>
      <code>{job.executionId}</code><span>{t(`reporting.states.${job.state}`, job.state)} · {job.rowCount}</span>{job.source && <span>{job.source.sourceVersion} · {t(`reporting.consistency.${job.source.consistency}`, job.source.consistency)}</span>}
      {job.errorCode && <span>{job.errorCode}</span>}
      {job.state === "Completed" && <Button disabled={downloading} onClick={() => void download({uri: `/api/reports/executions/${encodeURIComponent(job.executionId)}/file`, filename: `${job.executionId}.csv`}).catch(() => {})}>{t("download.tooltip", "Download")}</Button>}
      {(job.state === "Failed" || job.state === "Processing") && <Button disabled={busy} onClick={() => void run(async () => {await request(`/executions/${encodeURIComponent(job.executionId)}/retry`, JSON.stringify({expectedRevision: job.revision})); await refreshJobs();})}>{t("reporting.retry", "Retry failed or expired export")}</Button>}
    </div>)}
  </section>;
}
