"use client";

import { useCallback, useState, type ChangeEvent } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

type ExcelMetadata = {
  drugs: string[];
  min_date: string | null;
  max_date: string | null;
  total_cases: number;
  total_rows: number;
};

type SignalRow = {
  suspected_product: string;
  adverse_event_pt: string;
  a: number;
  b: number;
  c: number;
  d: number;
  prr: number | null;
  ror: number | null;
  chi_square: number | null;
  chi_square_p_value: number | null;
  ebgm: number | null;
  expected_count: number | null;
  n_cases: number;
  initial_report_date_earliest: string | null;
};

type AnalyzeResponse = {
  total_cases: number;
  total_rows: number;
  pairs_analyzed: number;
  signals: SignalRow[];
  filters: {
    evaluation_mode: "cumulative" | "interval";
    drug_name: string | null;
    review_period_start: string | null;
    review_period_end: string | null;
  };
};

function isoToDateInput(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

function formatNum(v: number | null | undefined, digits = 4): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) {
      return data.detail.map((e: { msg?: string }) => e.msg ?? JSON.stringify(e)).join("; ");
    }
    return JSON.stringify(data);
  } catch {
    return res.statusText || "Request failed";
  }
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<ExcelMetadata | null>(null);
  const [drugName, setDrugName] = useState("");
  const [evaluationMode, setEvaluationMode] = useState<"cumulative" | "interval">("interval");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [result, setResult] = useState<AnalyzeResponse | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingRun, setLoadingRun] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMetadata = useCallback(async (f: File) => {
    setLoadingMeta(true);
    setError(null);
    setMetadata(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch(`${API_BASE}/excel-metadata`, {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data: ExcelMetadata = await res.json();
      setMetadata(data);
      setDrugName("");
      setEvaluationMode("interval");
      setPeriodStart(isoToDateInput(data.min_date));
      setPeriodEnd(isoToDateInput(data.max_date));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to read file");
    } finally {
      setLoadingMeta(false);
    }
  }, []);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    setFile(f ?? null);
    if (f) void loadMetadata(f);
  };

  const runAnalysis = async () => {
    if (!file) {
      setError("Choose an Excel file first.");
      return;
    }
    setLoadingRun(true);
    setError(null);
    setResult(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("drug_name", drugName);
      body.append("evaluation_mode", evaluationMode);
      body.append(
        "review_period_start",
        evaluationMode === "cumulative" ? "" : periodStart,
      );
      body.append("review_period_end", periodEnd);
      const res = await fetch(`${API_BASE}/analyze-signals`, {
        method: "POST",
        body,
      });
      if (!res.ok) throw new Error(await readErrorDetail(res));
      const data: AnalyzeResponse = await res.json();
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed");
    } finally {
      setLoadingRun(false);
    }
  };

  return (
    <div className="min-h-full flex flex-col bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      <header className="border-b border-zinc-200 bg-white px-6 py-5 dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="text-xl font-semibold tracking-tight">Disproportionality analysis</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
          Upload a line listing (Excel), choose a suspected product and review period (initial
          report dates), then run PRR, ROR, χ², and EBGM for each adverse event.
        </p>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-8">
        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">1. Data</h2>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label htmlFor="file" className="block text-sm font-medium">
                Excel file (.xlsx)
              </label>
              <input
                id="file"
                type="file"
                accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onFileChange}
                className="mt-1 block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-900 file:px-4 file:py-2 file:text-sm file:font-medium file:text-white hover:file:bg-zinc-800 dark:file:bg-zinc-100 dark:file:text-zinc-900"
              />
            </div>
            {loadingMeta && (
              <p className="text-sm text-zinc-500">Reading file…</p>
            )}
          </div>
          {metadata && (
            <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{metadata.total_cases}</span>{" "}
              cases,{" "}
              <span className="font-medium text-zinc-800 dark:text-zinc-200">{metadata.total_rows}</span>{" "}
              rows — {metadata.drugs.length} distinct suspected products.
            </p>
          )}
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">2. Scope</h2>
          <fieldset className="mt-4">
            <legend className="text-sm font-medium">Statistical evaluation</legend>
            <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:gap-6">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="eval-mode"
                  checked={evaluationMode === "cumulative"}
                  onChange={() => {
                    setEvaluationMode("cumulative");
                    setPeriodStart("");
                  }}
                  disabled={!metadata}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-medium">Cumulative</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    All cases with earliest report on or before the end date (start not used).
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="eval-mode"
                  checked={evaluationMode === "interval"}
                  onChange={() => {
                    setEvaluationMode("interval");
                    if (metadata) {
                      setPeriodStart(isoToDateInput(metadata.min_date));
                      setPeriodEnd(isoToDateInput(metadata.max_date));
                    }
                  }}
                  disabled={!metadata}
                  className="h-4 w-4"
                />
                <span>
                  <span className="font-medium">Interval</span>
                  <span className="block text-xs text-zinc-500 dark:text-zinc-400">
                    Only cases whose earliest report falls between start and end (inclusive).
                  </span>
                </span>
              </label>
            </div>
          </fieldset>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label htmlFor="drug" className="block text-sm font-medium">
                Suspected product
              </label>
              <select
                id="drug"
                value={drugName}
                onChange={(e) => setDrugName(e.target.value)}
                disabled={!metadata}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 disabled:opacity-50"
              >
                <option value="">All drugs (every drug–event pair)</option>
                {metadata?.drugs.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="start" className="block text-sm font-medium">
                Review period start
                {evaluationMode === "cumulative" && (
                  <span className="ml-1 font-normal text-zinc-400">(not applicable)</span>
                )}
              </label>
              <input
                id="start"
                type="date"
                value={evaluationMode === "cumulative" ? "" : periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                disabled={!metadata || evaluationMode === "cumulative"}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div>
              <label htmlFor="end" className="block text-sm font-medium">
                Review period end
                {evaluationMode === "cumulative" && (
                  <span className="ml-1 font-normal text-zinc-500">(required)</span>
                )}
              </label>
              <input
                id="end"
                type="date"
                value={periodEnd}
                onChange={(e) => setPeriodEnd(e.target.value)}
                disabled={!metadata}
                className="mt-1 w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-950 disabled:opacity-50"
              />
            </div>
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
            Each case uses its <strong className="font-medium text-zinc-600 dark:text-zinc-300">earliest</strong> initial report date in the file. Cumulative: include all cases with that date on or before the end date. Interval: include only when that date is between start and end (inclusive).
          </p>
          <button
            type="button"
            onClick={() => void runAnalysis()}
            disabled={!file || !metadata || loadingRun}
            className="mt-6 rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
          >
            {loadingRun ? "Running…" : "Run analysis"}
          </button>
        </section>

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
          >
            {error}
          </div>
        )}

        {result && (
          <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-sm font-medium text-zinc-500 dark:text-zinc-400">3. Results</h2>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {result.pairs_analyzed} pair(s) · {result.total_cases} cases in scope ·{" "}
              <span className="font-medium capitalize">{result.filters.evaluation_mode}</span>
              {" · "}
              {result.filters.drug_name ?? "all drugs"}
              {result.filters.evaluation_mode === "cumulative" && result.filters.review_period_end
                ? ` · up to ${result.filters.review_period_end.slice(0, 10)}`
                : ""}
              {result.filters.evaluation_mode === "interval" &&
              (result.filters.review_period_start || result.filters.review_period_end)
                ? ` · ${result.filters.review_period_start?.slice(0, 10) ?? "…"} → ${result.filters.review_period_end?.slice(0, 10) ?? "…"}`
                : ""}
            </p>
            <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-medium uppercase text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Adverse event (PT)</th>
                    <th className="px-3 py-2">a</th>
                    <th className="px-3 py-2">b</th>
                    <th className="px-3 py-2">c</th>
                    <th className="px-3 py-2">d</th>
                    <th className="px-3 py-2">PRR</th>
                    <th className="px-3 py-2">ROR</th>
                    <th className="px-3 py-2">χ²</th>
                    <th className="px-3 py-2">p</th>
                    <th className="px-3 py-2">EBGM</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {result.signals.map((row) => (
                    <tr key={`${row.suspected_product}-${row.adverse_event_pt}`} className="hover:bg-zinc-50/80 dark:hover:bg-zinc-800/50">
                      <td className="max-w-[140px] truncate px-3 py-2 font-medium" title={row.suspected_product}>
                        {row.suspected_product}
                      </td>
                      <td className="max-w-[200px] truncate px-3 py-2" title={row.adverse_event_pt}>
                        {row.adverse_event_pt}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{row.a}</td>
                      <td className="px-3 py-2 tabular-nums">{row.b}</td>
                      <td className="px-3 py-2 tabular-nums">{row.c}</td>
                      <td className="px-3 py-2 tabular-nums">{row.d}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(row.prr)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(row.ror)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(row.chi_square)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(row.chi_square_p_value, 6)}</td>
                      <td className="px-3 py-2 tabular-nums">{formatNum(row.ebgm)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
