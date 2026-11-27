"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3, Bot, CalendarDays,
  ChevronDown, CircleDollarSign, FileText, LoaderCircle, MessageSquare,
  RefreshCw, Save, Search, Sparkles, Target, Wallet, X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { OriaRichMessage } from "@/components/oria-chat/OriaRichMessage";

const API_URL = (process.env.NEXT_PUBLIC_API_URL || "https://lbv-connect-api.onrender.com").replace(/\/$/, "");
const ReactECharts = dynamic(() => import("echarts-for-react"), { ssr: false });

type AssistantOption = { id: string; name: string; timezone?: string };
type ModelOption = { id: string; label: string };
type ModelCatalog = {
  success: boolean;
  provider: string;
  pack_id: string;
  models: ModelOption[];
  unavailable_due_to_billing_config?: Array<{ id: string; label: string; reason: string }>;
};
type CurrencyBucket = {
  sales_won: number;
  sales_lost: number;
  opportunities_open: number;
  tracked_request_outcomes: number;
  quoted_total: string;
  collected_total: string;
  outstanding_total: string;
  average_won_quoted: string | null;
  average_won_collected: string | null;
};
type CommercialSummary = {
  period: { start: string; end: string; timezone: string };
  activity: {
    conversations_initiated: number;
    completed_ai_responses: number;
    messages_exchanged: number;
    visitor_messages: number;
    ai_messages: number;
    technical_confirmations: number;
  };
  leads: {
    confirmed_requests: number;
    conversations_with_confirmed_request: number;
    conversation_to_request_rate: number | null;
    pipeline: Record<string, number>;
    contact_quality: {
      with_name: number;
      with_phone: number;
      with_email: number;
      valid_phone_count: number;
      valid_phone_rate: number | null;
      with_at_least_one_contact_method: number;
      contact_method_rate: number | null;
      valid_email_count: number;
    };
    by_type: Array<{ request_type: string; count: number }>;
    themes: Array<{ theme: string; mentions: number }>;
    open_or_pending_requests: number;
  };
  sales: {
    tracked_requests: number;
    won_tracked_requests: number;
    untracked_confirmed_requests: number;
    financial_records_in_period: number;
    by_currency: Record<string, CurrencyBucket>;
    sales_conversion_rate_tracked_only: number | null;
    conversion_denominator: string;
  };
  usage: {
    consumed_credits: number;
    actual_api_cost_xaf: string | null;
    api_cost_available_runs: number;
    api_cost_missing_runs: number;
  };
  trends: Array<{ date: string; conversations: number; confirmed_requests: number }>;
  comparison?: {
    previous_period: { start: string; end: string };
    metrics: Record<string, { current: number; previous: number; absolute_change: number; percentage_change: number | null }>;
  } | null;
  scope?: string;
  assistants_included: number;
};
type RequestRow = {
  id: string;
  assistant_id: string | null;
  assistant_name: string;
  request_type: string;
  summary: string;
  customer_name: string;
  customer_phone: string;
  customer_email?: string | null;
  status: string;
  created_at: string;
};
type Sale = {
  id: string;
  request_id: string;
  outcome: "open" | "won" | "lost";
  product_or_service: string | null;
  quoted_amount: string | number | null;
  collected_amount: string | number;
  currency: string;
  sale_date: string | null;
  notes: string | null;
};
type SaleDraft = {
  outcome: "open" | "won" | "lost";
  product_or_service: string;
  quoted_amount: string;
  collected_amount: string;
  currency: string;
  sale_date: string;
  notes: string;
};
type CommercialReport = {
  id: string;
  assistant_id: string | null;
  period_start: string;
  period_end: string;
  generated_at?: string | null;
  analysis_content?: {
    status?: string;
    markdown?: string;
    provider?: string;
    model?: string;
    credits_consumed?: number;
    actual_api_cost_xaf?: string | null;
    total_cost_usd?: string | null;
    error?: string;
  } | null;
};
type PeriodPreset = "week" | "7d" | "30d" | "month" | "previous_month" | "custom";

const REQUEST_STATUS_LABELS: Record<string, string> = {
  new: "Nouvelle", in_progress: "En cours", treated: "Traitée", cancelled: "Annulée",
};
const SALE_OUTCOME_LABELS: Record<string, string> = {
  open: "En cours", won: "Gagnée", lost: "Perdue",
};

function gabonToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Libreville", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((item) => item.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rangeForPreset(preset: PeriodPreset): { start: string; end: string } {
  const today = gabonToday();
  if (preset === "custom") return { start: addDays(today, -29), end: today };
  if (preset === "7d") return { start: addDays(today, -6), end: today };
  if (preset === "30d") return { start: addDays(today, -29), end: today };
  const [year, month] = today.split("-").map(Number);
  if (preset === "previous_month") {
    const first = new Date(Date.UTC(year, month - 2, 1));
    const last = new Date(Date.UTC(year, month - 1, 0));
    return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) };
  }
  if (preset === "month") return { start: `${today.slice(0, 7)}-01`, end: today };
  const mondayOffset = (new Date(Date.UTC(year, month - 1, Number(today.slice(8, 10)))).getUTCDay() + 6) % 7;
  return { start: addDays(today, -mondayOffset), end: today };
}

function numberLabel(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value);
}

function amountLabel(value: string | number | null | undefined, currency: string): string {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(number)} ${currency}`;
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00+01:00` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeZone: "Africa/Libreville" }).format(parsed);
}

function emptySaleDraft(): SaleDraft {
  return {
    outcome: "open", product_or_service: "", quoted_amount: "", collected_amount: "0",
    currency: "XAF", sale_date: gabonToday(), notes: "",
  };
}

function saleDraftFromRow(row: Sale): SaleDraft {
  return {
    outcome: row.outcome,
    product_or_service: row.product_or_service || "",
    quoted_amount: row.quoted_amount === null ? "" : String(row.quoted_amount),
    collected_amount: String(row.collected_amount ?? "0"),
    currency: String(row.currency || "XAF").toUpperCase(),
    sale_date: row.sale_date || gabonToday(),
    notes: row.notes || "",
  };
}

function metricChange(summary: CommercialSummary | null, key: string): { text: string; positive: boolean | null } | null {
  const item = summary?.comparison?.metrics?.[key];
  if (!item) return null;
  if (item.percentage_change === null) {
    return { text: `${numberLabel(item.absolute_change)} vs période précédente`, positive: item.absolute_change > 0 ? true : item.absolute_change < 0 ? false : null };
  }
  const sign = item.percentage_change > 0 ? "+" : "";
  return { text: `${sign}${numberLabel(item.percentage_change)} % vs période précédente`, positive: item.percentage_change > 0 ? true : item.percentage_change < 0 ? false : null };
}

function MetricCard({ label, value, detail, icon: Icon, change }: {
  label: string; value: string; detail?: string; icon: typeof Activity;
  change?: { text: string; positive: boolean | null } | null;
}) {
  return (
    <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-muted">{label}</p>
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-secondary text-muted-strong"><Icon size={17} /></span>
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight tabular-nums sm:text-3xl">{value}</p>
      {detail && <p className="mt-1.5 text-[11px] leading-5 text-muted">{detail}</p>}
      {change && <p className={`mt-2 inline-flex items-center gap-1 text-[11px] font-medium ${change.positive === true ? "text-emerald-700 dark:text-emerald-400" : change.positive === false ? "text-rose-700 dark:text-rose-400" : "text-muted"}`}>
        {change.positive === true ? <ArrowUpRight size={13} /> : change.positive === false ? <ArrowDownRight size={13} /> : null}{change.text}
      </p>}
    </section>
  );
}

export default function AssistantCommercialDashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const initialRange = useMemo(() => rangeForPreset("30d"), []);
  const [assistants, setAssistants] = useState<AssistantOption[]>([]);
  const [selectedAssistant, setSelectedAssistant] = useState("all");
  const [preset, setPreset] = useState<PeriodPreset>("30d");
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [summary, setSummary] = useState<CommercialSummary | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [packId, setPackId] = useState("");
  const [unavailableModels, setUnavailableModels] = useState<NonNullable<ModelCatalog["unavailable_due_to_billing_config"]>>([]);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [requestSearch, setRequestSearch] = useState("");
  const [selectedRequest, setSelectedRequest] = useState<RequestRow | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [saleDraft, setSaleDraft] = useState<SaleDraft>(emptySaleDraft);
  const [saleLoading, setSaleLoading] = useState(false);
  const [savingSale, setSavingSale] = useState(false);
  const [saleNotice, setSaleNotice] = useState("");
  const [reports, setReports] = useState<CommercialReport[]>([]);
  const [activeReport, setActiveReport] = useState<CommercialReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [reportNotice, setReportNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [modelError, setModelError] = useState("");

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id || !session.access_token) throw new Error("Session ORIA expirée. Reconnecte-toi.");
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    headers.set("user-id", session.user.id);
    headers.set("authorization", `Bearer ${session.access_token}`);
    let response: Response;
    try {
      response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: "no-store" });
    } catch {
      throw new Error(`Backend ORIA inaccessible (${API_URL}). Vérifie le déploiement Render et NEXT_PUBLIC_API_URL.`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(typeof payload.detail === "string" ? payload.detail : "Une erreur est survenue.");
    return payload as Record<string, any>;
  }, [supabase]);

  const queryParams = useMemo(() => {
    const params = new URLSearchParams({ start_date: startDate, end_date: endDate, compare: "true" });
    if (selectedAssistant !== "all") params.set("assistant_id", selectedAssistant);
    return params.toString();
  }, [startDate, endDate, selectedAssistant]);

  const loadSummary = useCallback(async () => {
    if (!startDate || !endDate || endDate < startDate) return;
    const payload = await api(`/assistant/commercial/summary?${queryParams}`);
    setSummary(payload.summary as CommercialSummary);
  }, [api, queryParams, startDate, endDate]);

  const loadReports = useCallback(async () => {
    const params = new URLSearchParams({ limit: "20", offset: "0" });
    if (selectedAssistant !== "all") params.set("assistant_id", selectedAssistant);
    const payload = await api(`/assistant/commercial/reports?${params.toString()}`);
    setReports(Array.isArray(payload.reports) ? payload.reports as CommercialReport[] : []);
  }, [api, selectedAssistant]);

  const loadBase = useCallback(async () => {
    setError("");
    setModelError("");
    const [assistantResult, modelResult, requestResult] = await Promise.allSettled([
      api("/assistant/assistants"),
      api("/assistant/commercial/models"),
      api("/assistant/requests"),
    ]);
    if (assistantResult.status === "fulfilled") {
      setAssistants(Array.isArray(assistantResult.value.assistants) ? assistantResult.value.assistants as AssistantOption[] : []);
    } else {
      setError(assistantResult.reason instanceof Error ? assistantResult.reason.message : "Impossible de charger les assistants.");
    }
    if (modelResult.status === "fulfilled") {
      const catalog = modelResult.value as unknown as ModelCatalog;
      const items = Array.isArray(catalog.models) ? catalog.models : [];
      setModels(items);
      setProvider(catalog.provider || "");
      setPackId(catalog.pack_id || "");
      setUnavailableModels(catalog.unavailable_due_to_billing_config || []);
      setModel((current) => current && items.some((item) => item.id === current) ? current : (items[0]?.id || ""));
    } else {
      setModelError(modelResult.reason instanceof Error ? modelResult.reason.message : "Catalogue de modèles indisponible.");
      setModels([]);
      setModel("");
    }
    if (requestResult.status === "fulfilled") {
      setRequests(Array.isArray(requestResult.value.requests) ? requestResult.value.requests as RequestRow[] : []);
    }
  }, [api]);

  const refreshAll = useCallback(async (showSpinner = true) => {
    if (showSpinner) setRefreshing(true);
    setError("");
    try {
      await Promise.all([loadSummary(), loadReports()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les indicateurs commerciaux.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadSummary, loadReports]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void loadBase().finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [loadBase]);

  useEffect(() => {
    if (loading) return;
    let active = true;
    void Promise.all([loadSummary(), loadReports()])
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Impossible de charger les indicateurs commerciaux.");
      });
    return () => { active = false; };
  }, [loading, loadSummary, loadReports]);

  const applyPreset = (next: PeriodPreset) => {
    setPreset(next);
    if (next !== "custom") {
      const range = rangeForPreset(next);
      setStartDate(range.start);
      setEndDate(range.end);
    }
  };

  const openSaleEditor = async (request: RequestRow) => {
    setSelectedRequest(request);
    setSale(null);
    setSaleDraft(emptySaleDraft());
    setSaleNotice("");
    setSaleLoading(true);
    try {
      const payload = await api(`/assistant/commercial/sales?request_id=${encodeURIComponent(request.id)}`);
      const nextSale = (payload.sale || null) as Sale | null;
      setSale(nextSale);
      setSaleDraft(nextSale ? saleDraftFromRow(nextSale) : emptySaleDraft());
    } catch (err) {
      setSaleNotice(err instanceof Error ? err.message : "Impossible de charger la fiche commerciale.");
    } finally {
      setSaleLoading(false);
    }
  };

  const saveSale = async () => {
    if (!selectedRequest || savingSale) return;
    if (saleDraft.outcome === "won" && !saleDraft.sale_date) {
      setSaleNotice("Une date de réalisation est obligatoire pour une vente gagnée.");
      return;
    }
    const quoted = saleDraft.quoted_amount.trim();
    const collected = saleDraft.collected_amount.trim();
    if ((quoted && (!Number.isFinite(Number(quoted)) || Number(quoted) < 0))
      || !Number.isFinite(Number(collected)) || Number(collected) < 0) {
      setSaleNotice("Les montants doivent être numériques et positifs ou nuls.");
      return;
    }
    setSavingSale(true);
    setSaleNotice("");
    const body = {
      outcome: saleDraft.outcome,
      product_or_service: saleDraft.product_or_service.trim() || null,
      quoted_amount: quoted ? Number(quoted) : null,
      collected_amount: Number(collected || "0"),
      currency: saleDraft.currency.trim().toUpperCase(),
      sale_date: saleDraft.sale_date || null,
      notes: saleDraft.notes.trim() || null,
    };
    try {
      const payload = sale
        ? await api(`/assistant/commercial/sales/${encodeURIComponent(sale.id)}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api("/assistant/commercial/sales", { method: "POST", body: JSON.stringify({ request_id: selectedRequest.id, ...body }) });
      const saved = payload.sale as Sale;
      setSale(saved);
      setSaleDraft(saleDraftFromRow(saved));
      setSaleNotice("Résultat commercial enregistré.");
      await loadSummary();
    } catch (err) {
      setSaleNotice(err instanceof Error ? err.message : "Enregistrement commercial impossible.");
    } finally {
      setSavingSale(false);
    }
  };

  const generateReport = async () => {
    if (!model || reportBusy || !startDate || !endDate || endDate < startDate) return;
    setReportBusy(true);
    setReportNotice("");
    setActiveReport(null);
    try {
      const body: Record<string, string> = { start_date: startDate, end_date: endDate, model };
      if (selectedAssistant !== "all") body.assistant_id = selectedAssistant;
      const payload = await api("/assistant/commercial/reports", { method: "POST", body: JSON.stringify(body) });
      const report = payload.report as CommercialReport;
      setActiveReport(report);
      setReportNotice(report?.analysis_content?.status === "completed"
        ? "Bilan généré et enregistré dans l'historique."
        : "Le serveur a retourné un état non final. Consulte le statut avant de relancer la génération.");
      await loadReports();
    } catch (err) {
      setReportNotice(err instanceof Error ? err.message : "La génération du bilan a échoué.");
    } finally {
      setReportBusy(false);
    }
  };

  const openReport = async (item: CommercialReport) => {
    setReportNotice("");
    try {
      const payload = await api(`/assistant/commercial/reports/${encodeURIComponent(item.id)}`);
      setActiveReport(payload.report as CommercialReport);
    } catch (err) {
      setReportNotice(err instanceof Error ? err.message : "Impossible de charger ce bilan.");
    }
  };

  const visibleRequests = useMemo(() => {
    const value = requestSearch.trim().toLocaleLowerCase("fr-FR");
    const scoped = requests.filter((item) => selectedAssistant === "all" || item.assistant_id === selectedAssistant);
    if (!value) return scoped;
    return scoped.filter((item) => [item.customer_name, item.request_type, item.summary, item.assistant_name]
      .some((field) => String(field || "").toLocaleLowerCase("fr-FR").includes(value)));
  }, [requests, requestSearch, selectedAssistant]);

  const trendOptions = useMemo(() => ({
    tooltip: { trigger: "axis" },
    legend: { bottom: 0, textStyle: { color: "#737373", fontSize: 11 } },
    grid: { left: 12, right: 18, top: 18, bottom: 52, containLabel: true },
    xAxis: { type: "category", boundaryGap: false, data: (summary?.trends || []).map((item) => item.date.slice(5)), axisLabel: { color: "#737373", fontSize: 10 }, axisLine: { lineStyle: { color: "#e5e5e5" } }, axisTick: { show: false } },
    yAxis: { type: "value", minInterval: 1, axisLabel: { color: "#737373", fontSize: 10 }, splitLine: { lineStyle: { color: "#eeeeee" } } },
    series: [
      { name: "Conversations", type: "line", smooth: true, symbol: "circle", symbolSize: 5, data: (summary?.trends || []).map((item) => item.conversations), lineStyle: { width: 2, color: "#475569" }, itemStyle: { color: "#475569" }, areaStyle: { color: "rgba(71,85,105,0.07)" } },
      { name: "Demandes confirmées", type: "line", smooth: true, symbol: "circle", symbolSize: 5, data: (summary?.trends || []).map((item) => item.confirmed_requests), lineStyle: { width: 2, color: "#16805d" }, itemStyle: { color: "#16805d" } },
    ],
  }), [summary?.trends]);

  const requestTypeOptions = useMemo(() => ({
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
    grid: { left: 10, right: 22, top: 10, bottom: 8, containLabel: true },
    xAxis: { type: "value", minInterval: 1, axisLabel: { color: "#737373", fontSize: 10 }, splitLine: { lineStyle: { color: "#eeeeee" } } },
    yAxis: { type: "category", inverse: true, data: (summary?.leads.by_type || []).slice(0, 8).map((item) => item.request_type), axisLabel: { color: "#737373", fontSize: 10, width: 130, overflow: "truncate" }, axisLine: { show: false }, axisTick: { show: false } },
    series: [{ type: "bar", data: (summary?.leads.by_type || []).slice(0, 8).map((item) => item.count), barMaxWidth: 20, itemStyle: { color: "#64748b", borderRadius: [0, 5, 5, 0] } }],
  }), [summary?.leads.by_type]);

  const hasPeriodError = Boolean(startDate && endDate && endDate < startDate);
  const currencyEntries = Object.entries(summary?.sales.by_currency || {});
  const reportMarkdown = activeReport?.analysis_content?.markdown || "";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link href="/assistant" className="flex min-w-0 items-center gap-3 font-semibold tracking-tight">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-foreground text-background"><Bot size={19} /></span>
            <span className="truncate">ORIA <span className="font-normal text-muted">/ Bilan commercial</span></span>
          </Link>
          <div className="flex shrink-0 items-center gap-2">
            <Link href="#commercial-requests" aria-label="Accéder à la saisie des résultats commerciaux" className="hidden rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-secondary sm:inline-flex">Saisir les résultats</Link>
            <Link href="/assistant/demandes" className="hidden rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-secondary sm:inline-flex">Demandes reçues</Link>
            <Link href="/chat" className="rounded-full border border-border px-3 py-2 text-xs font-semibold hover:bg-surface-secondary">Retour au Chat</Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-6 lg:py-9">
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Pilotage de l'activité</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Bilan commercial</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Suivez les conversations, les demandes confirmées, les résultats commerciaux et les encaissements réellement déclarés.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link data-oria-fix="ORIA_COMMERCIAL_MOBILE_ENTRY_V2" href="#commercial-requests" className="inline-flex items-center justify-center rounded-xl bg-foreground px-4 py-2.5 text-xs font-semibold text-background hover:opacity-85">Saisir les résultats</Link>
            <button type="button" onClick={() => void refreshAll()} disabled={refreshing || loading} className="inline-flex items-center gap-2 rounded-xl border border-border bg-surface px-4 py-2.5 text-xs font-semibold hover:bg-surface-secondary disabled:opacity-50">
            {refreshing ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />} Actualiser les données
          </button>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="grid gap-4 lg:grid-cols-[1.1fr_1.2fr_1fr]">
            <label className="grid gap-1.5 text-xs font-medium text-muted">Périmètre des assistants
              <select value={selectedAssistant} onChange={(event) => setSelectedAssistant(event.target.value)} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground outline-none focus:border-border-strong">
                <option value="all">Tous les assistants · consolidé</option>
                {assistants.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
            <div className="grid gap-1.5 text-xs font-medium text-muted">
              <span>Période d'analyse</span>
              <div className="flex flex-wrap gap-1.5">
                {([ ["week", "Cette semaine"], ["7d", "7 jours"], ["30d", "30 jours"], ["month", "Ce mois"], ["previous_month", "Mois précédent"], ["custom", "Personnalisée" ] ] as Array<[PeriodPreset, string]>).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => applyPreset(value)} className={`rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition ${preset === value ? "border-foreground bg-foreground text-background" : "border-border bg-background text-muted-strong hover:bg-surface-secondary"}`}>{label}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1.5 text-xs font-medium text-muted">Du
                <input type="date" value={startDate} max={endDate || undefined} onChange={(event) => { setPreset("custom"); setStartDate(event.target.value); }} className="min-w-0 rounded-xl border border-border bg-background px-3 py-3 text-xs text-foreground" />
              </label>
              <label className="grid gap-1.5 text-xs font-medium text-muted">Au
                <input type="date" value={endDate} min={startDate || undefined} onChange={(event) => { setPreset("custom"); setEndDate(event.target.value); }} className="min-w-0 rounded-xl border border-border bg-background px-3 py-3 text-xs text-foreground" />
              </label>
            </div>
          </div>
          {hasPeriodError && <p role="alert" className="mt-3 text-xs text-rose-700">La date de fin doit être égale ou postérieure à la date de début.</p>}
          <p className="mt-3 text-[11px] text-muted">Fuseau de référence : {summary?.period.timezone || "Africa/Libreville"}. La comparaison porte sur la période précédente de même durée.</p>
        </section>

        {error && <p role="alert" className="rounded-xl border border-border-strong bg-surface-secondary px-4 py-3 text-sm">{error}</p>}
        {modelError && <p role="alert" className="rounded-xl border border-border-strong bg-surface-secondary px-4 py-3 text-sm">Catalogue IA : {modelError}</p>}

        {loading && !summary ? <div className="flex min-h-64 items-center justify-center gap-3 rounded-2xl border border-border bg-surface text-sm text-muted"><LoaderCircle size={18} className="animate-spin" /> Chargement du bilan commercial…</div> : summary ? (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard label="Conversations initiées" value={numberLabel(summary.activity.conversations_initiated)} detail={`${numberLabel(summary.activity.completed_ai_responses)} réponses IA terminées`} icon={MessageSquare} change={metricChange(summary, "conversations_initiated")} />
              <MetricCard label="Demandes confirmées" value={numberLabel(summary.leads.confirmed_requests)} detail={`${numberLabel(summary.leads.open_or_pending_requests)} nouvelles ou en cours`} icon={Target} change={metricChange(summary, "confirmed_requests")} />
              <MetricCard label="Conversion conversation → demande" value={summary.leads.conversation_to_request_rate === null ? "—" : `${numberLabel(summary.leads.conversation_to_request_rate)} %`} detail={`${numberLabel(summary.leads.conversations_with_confirmed_request)} conversations avec demande confirmée`} icon={Activity} change={metricChange(summary, "conversations_with_confirmed_request")} />
              <MetricCard label="Résultats commerciaux suivis" value={numberLabel(summary.sales.tracked_requests)} detail={`${numberLabel(summary.sales.won_tracked_requests)} gagnés · ${numberLabel(summary.sales.untracked_confirmed_requests)} sans résultat renseigné`} icon={BarChart3} />
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(280px,0.8fr)]">
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Évolution de l'activité</h2><p className="mt-1 text-xs text-muted">Conversations et demandes confirmées par jour</p></div><CalendarDays size={17} className="text-muted" /></div>
                {summary.trends.length ? <ReactECharts option={trendOptions} style={{ height: 300, width: "100%" }} notMerge lazyUpdate /> : <div className="grid h-[300px] place-items-center text-sm text-muted">Aucune activité enregistrée sur cette période.</div>}
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Pipeline des demandes</h2><p className="mt-1 text-xs text-muted">Statut de traitement, indépendant du résultat commercial</p></div><ChevronDown size={17} className="text-muted" /></div>
                <div className="mt-5 space-y-4">
                  {([ ["new", "Nouvelles"], ["in_progress", "En cours"], ["treated", "Traitées"], ["cancelled", "Annulées"] ] as Array<[string, string]>).map(([key, label]) => {
                    const value = Number(summary.leads.pipeline[key] || 0);
                    const total = Math.max(1, summary.leads.confirmed_requests);
                    return <div key={key}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-muted-strong">{label}</span><span className="font-semibold tabular-nums">{numberLabel(value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-surface-secondary"><div className="h-full rounded-full bg-slate-500" style={{ width: `${Math.min(100, value / total * 100)}%` }} /></div></div>;
                  })}
                </div>
                <div className="mt-6 border-t border-border pt-4"><p className="text-xs font-medium text-muted">Qualité des coordonnées</p><div className="mt-3 grid grid-cols-2 gap-3"><div><p className="text-lg font-semibold tabular-nums">{numberLabel(summary.leads.contact_quality.valid_phone_rate)}{summary.leads.contact_quality.valid_phone_rate === null ? "" : " %"}</p><p className="text-[11px] text-muted">Téléphones valides</p></div><div><p className="text-lg font-semibold tabular-nums">{numberLabel(summary.leads.contact_quality.contact_method_rate)}{summary.leads.contact_quality.contact_method_rate === null ? "" : " %"}</p><p className="text-[11px] text-muted">Au moins un moyen de contact</p></div></div></div>
              </div>
            </section>

            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Résultats financiers déclarés</h2><p className="mt-1 text-xs text-muted">Les devises restent séparées. Le chiffre d'affaires correspond aux montants encaissés saisis.</p></div><CircleDollarSign size={18} className="text-muted" /></div>
                <div className="mt-4 rounded-xl bg-surface-secondary p-3">
                  <p className="text-[10px] text-muted">Taux de ventes gagnées parmi les dossiers avec un résultat commercial renseigné</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">{summary.sales.sales_conversion_rate_tracked_only === null ? "—" : `${numberLabel(summary.sales.sales_conversion_rate_tracked_only)} %`}</p>
                  <p className="mt-1 text-[10px] leading-4 text-muted">{summary.sales.conversion_denominator}</p>
                </div>
                {currencyEntries.length ? <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  {currencyEntries.map(([currency, bucket]) => <div key={currency} className="rounded-xl border border-border p-4">
                    <div className="flex items-center justify-between"><span className="text-xs font-semibold">{currency}</span><span className="rounded-full bg-surface-secondary px-2 py-1 text-[10px] text-muted">{numberLabel(bucket.tracked_request_outcomes)} dossiers suivis</span></div>
                    <p className="mt-3 text-[11px] text-muted">Total encaissé</p><p className="mt-1 text-2xl font-semibold tracking-tight tabular-nums">{amountLabel(bucket.collected_total, currency)}</p>
                    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3"><div><p className="text-[10px] text-muted">Devis saisis</p><p className="mt-1 text-sm font-semibold tabular-nums">{amountLabel(bucket.quoted_total, currency)}</p></div><div><p className="text-[10px] text-muted">Solde estimé à encaisser</p><p className="mt-1 text-sm font-semibold tabular-nums">{amountLabel(bucket.outstanding_total, currency)}</p></div></div>
                    <div className="mt-3 border-t border-border pt-3"><p className="text-[10px] text-muted">Panier moyen encaissé sur ventes gagnées</p><p className="mt-1 text-sm font-semibold tabular-nums">{amountLabel(bucket.average_won_collected, currency)}</p></div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-muted"><span>{numberLabel(bucket.sales_won)} gagnées</span><span>{numberLabel(bucket.opportunities_open)} ouvertes</span><span>{numberLabel(bucket.sales_lost)} perdues</span></div>
                  </div>)}
                </div> : <div className="mt-5 rounded-xl bg-surface-secondary p-6 text-center text-sm text-muted">Aucune donnée financière déclarée sur cette période.</div>}
                <div className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs leading-5 text-muted">Aucun bénéfice net n'est calculé : les charges complètes ne sont pas gérées dans cette version. Les montants de devises différentes ne sont jamais additionnés.</div>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">Origine des demandes</h2><p className="mt-1 text-xs text-muted">Répartition par type déclaré</p></div><BarChart3 size={18} className="text-muted" /></div>
                {summary.leads.by_type.length ? <ReactECharts option={requestTypeOptions} style={{ height: 280, width: "100%" }} notMerge lazyUpdate /> : <div className="grid h-[280px] place-items-center text-sm text-muted">Pas encore de type de demande exploitable.</div>}
                <div className="border-t border-border pt-3"><p className="text-xs font-medium text-muted">Thèmes récurrents observés</p><div className="mt-2 flex flex-wrap gap-2">{summary.leads.themes.slice(0, 10).map((item) => <span key={item.theme} className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-strong">{item.theme} <strong className="ml-1 tabular-nums">{item.mentions}</strong></span>)}{summary.leads.themes.length === 0 && <span className="text-xs text-muted">Aucun thème récurrent.</span>}</div></div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl bg-surface-secondary"><Wallet size={17} /></span><div><h2 className="text-sm font-semibold">Consommation IA</h2><p className="mt-1 text-xs text-muted">Exécution réelle des réponses Assistant terminées</p></div></div>
                <div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-surface-secondary p-3"><p className="text-[10px] text-muted">Crédits consommés</p><p className="mt-1 text-xl font-semibold tabular-nums">{numberLabel(summary.usage.consumed_credits)}</p></div><div className="rounded-xl bg-surface-secondary p-3"><p className="text-[10px] text-muted">Coût API réel</p><p className="mt-1 text-xl font-semibold tabular-nums">{summary.usage.actual_api_cost_xaf === null ? "Indisponible" : amountLabel(summary.usage.actual_api_cost_xaf, "XAF")}</p></div></div>
                <p className="mt-3 text-[11px] leading-5 text-muted">Coût API renseigné pour {numberLabel(summary.usage.api_cost_available_runs)} exécutions ; coût manquant pour {numberLabel(summary.usage.api_cost_missing_runs)}. Les crédits ORIA et le coût fournisseur sont deux mesures distinctes.</p>
              </div>
              <div className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
                <div className="flex items-start gap-3"><span className="grid size-9 place-items-center rounded-xl bg-surface-secondary"><Activity size={17} /></span><div><h2 className="text-sm font-semibold">Messages échangés</h2><p className="mt-1 text-xs text-muted">Répartition du volume conversationnel</p></div></div>
                <div className="mt-4 grid grid-cols-3 gap-2"><div className="rounded-xl bg-surface-secondary p-3"><p className="text-[10px] text-muted">Messages visiteurs</p><p className="mt-1 text-lg font-semibold tabular-nums">{numberLabel(summary.activity.visitor_messages)}</p></div><div className="rounded-xl bg-surface-secondary p-3"><p className="text-[10px] text-muted">Messages IA</p><p className="mt-1 text-lg font-semibold tabular-nums">{numberLabel(summary.activity.ai_messages)}</p></div><div className="rounded-xl bg-surface-secondary p-3"><p className="text-[10px] text-muted">Messages techniques</p><p className="mt-1 text-lg font-semibold tabular-nums">{numberLabel(summary.activity.technical_confirmations)}</p></div></div>
                <p className="mt-3 text-[11px] leading-5 text-muted">Chaque message est compté séparément : ce bloc mesure des messages, pas des personnes distinctes. Les confirmations techniques sont séparées des réponses générées par le modèle.</p>
              </div>
            </section>
          </>
        ) : <div className="rounded-2xl border border-dashed border-border p-10 text-center text-sm text-muted">Aucun agrégat disponible.</div>}

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5 scroll-mt-24" id="commercial-requests">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-sm font-semibold">Saisir les résultats commerciaux</h2><p className="mt-1 text-xs leading-5 text-muted">Choisis une demande confirmée pour renseigner son résultat commercial, son devis et les montants réellement encaissés. Une seule fiche commerciale est autorisée par demande.</p></div>
            <Link href="/assistant/demandes" className="text-xs font-semibold underline underline-offset-4">Ouvrir toutes les demandes</Link>
          </div>
          <div data-oria-fix="ORIA_COMMERCIAL_ENTRY_GUIDANCE_V2" className="mt-4 rounded-xl bg-surface-secondary p-3 text-xs leading-5 text-muted"><strong className="font-semibold text-foreground">Comment déclarer une vente ?</strong> Sélectionne une demande ci-dessous, indique si elle est en cours, gagnée ou perdue, puis renseigne le produit ou service, le montant du devis et le cumul réellement encaissé. Termine par « Enregistrer le résultat ». Les chiffres seront repris dans les indicateurs et les prochains bilans.</div>
          <label className="mt-4 flex items-center gap-2 rounded-xl border border-border px-3 py-2.5"><Search size={15} className="shrink-0 text-muted" /><input value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Rechercher une demande récente…" className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted" /></label>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {visibleRequests.slice(0, 12).map((item) => <button type="button" key={item.id} onClick={() => void openSaleEditor(item)} className={`rounded-xl border p-3 text-left transition hover:bg-surface-secondary ${selectedRequest?.id === item.id ? "border-foreground bg-surface-secondary" : "border-border"}`}>
              <div className="flex items-start justify-between gap-2"><span className="min-w-0 truncate text-xs font-semibold">{item.customer_name || "Client non renseigné"}</span><span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[9px] text-muted">{REQUEST_STATUS_LABELS[item.status] || item.status}</span></div>
              <p className="mt-1 truncate text-[11px] text-muted">{item.request_type} · {item.assistant_name}</p>
              <p className="mt-2 line-clamp-2 text-[11px] leading-5 text-muted">{item.summary}</p>
              <p className="mt-2 text-[10px] text-muted">{dateLabel(item.created_at)} · Cliquer pour qualifier</p>
            </button>)}
            {visibleRequests.length === 0 && <p className="rounded-xl bg-surface-secondary p-4 text-xs leading-5 text-muted md:col-span-2">Aucune demande confirmée à qualifier. La saisie commerciale est rattachée à une demande reçue par votre assistant. Demandez au visiteur de confirmer sa demande, puis revenez ici pour enregistrer le résultat. <Link href="/assistant/demandes" className="font-semibold underline underline-offset-2">Voir les demandes reçues</Link>.</p>}
          </div>
          {visibleRequests.length > 12 && <p className="mt-3 text-[10px] text-muted">12 demandes affichées sur {visibleRequests.length} demandes renvoyées par la liste Assistant. Les indicateurs en haut de page sont calculés par le moteur commercial complet.</p>}
          {selectedRequest && <div className="mt-5 rounded-2xl border border-border bg-surface-secondary/50 p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-muted">Fiche commerciale · {selectedRequest.assistant_name}</p><h3 className="mt-1 text-sm font-semibold">{selectedRequest.customer_name} — {selectedRequest.request_type}</h3><p className="mt-1 text-[11px] text-muted">{selectedRequest.customer_phone || "Téléphone non renseigné"} · demande du {dateLabel(selectedRequest.created_at)}</p></div><button type="button" onClick={() => { setSelectedRequest(null); setSale(null); setSaleNotice(""); }} className="rounded-lg border border-border p-2 text-muted hover:bg-surface"><X size={15} /></button></div>
            {saleLoading ? <div className="flex items-center gap-2 py-8 text-xs text-muted"><LoaderCircle size={15} className="animate-spin" /> Chargement de la fiche…</div> : <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="grid gap-1.5 text-[11px] font-medium text-muted">Résultat commercial
                  <select value={saleDraft.outcome} onChange={(event) => setSaleDraft((current) => ({ ...current, outcome: event.target.value as SaleDraft["outcome"] }))} className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="open">En cours</option><option value="won">Gagnée</option><option value="lost">Perdue</option></select>
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted">Produit ou service
                  <input value={saleDraft.product_or_service} onChange={(event) => setSaleDraft((current) => ({ ...current, product_or_service: event.target.value }))} maxLength={180} placeholder="Ex. Abonnement annuel" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted">Devise
                  <select value={saleDraft.currency} onChange={(event) => setSaleDraft((current) => ({ ...current, currency: event.target.value }))} className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground"><option value="XAF">XAF</option><option value="EUR">EUR</option><option value="USD">USD</option><option value="XOF">XOF</option><option value="NGN">NGN</option><option value="GHS">GHS</option></select>
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted">Montant du devis
                  <input type="number" min="0" step="0.01" value={saleDraft.quoted_amount} onChange={(event) => setSaleDraft((current) => ({ ...current, quoted_amount: event.target.value }))} placeholder="0" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted">Total encaissé à ce jour
                  <input type="number" min="0" step="0.01" required value={saleDraft.collected_amount} onChange={(event) => setSaleDraft((current) => ({ ...current, collected_amount: event.target.value }))} placeholder="0" className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted">Date de réalisation {saleDraft.outcome === "won" ? "(obligatoire)" : ""}
                  <input type="date" required={saleDraft.outcome === "won"} value={saleDraft.sale_date} onChange={(event) => setSaleDraft((current) => ({ ...current, sale_date: event.target.value }))} className="rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-medium text-muted sm:col-span-2 lg:col-span-3">Commentaire interne
                  <textarea rows={2} maxLength={3000} value={saleDraft.notes} onChange={(event) => setSaleDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Précisions utiles pour le suivi…" className="resize-y rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-foreground" />
                </label>
              </div>
              <p className="mt-3 text-[10px] leading-5 text-muted">Pour un paiement partiel, remplace le total encaissé par le cumul réellement reçu. Le devis n'est pas considéré comme du chiffre d'affaires. Le statut de la demande reste indépendant du résultat commercial.</p>
              {saleNotice && <p role="status" className="mt-3 rounded-xl border border-border bg-surface px-3 py-2.5 text-xs leading-5">{saleNotice}</p>}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-muted">{sale ? `Fiche existante · ${SALE_OUTCOME_LABELS[sale.outcome]}` : "Nouvelle fiche commerciale"}</span><button type="button" onClick={() => void saveSale()} disabled={savingSale || saleLoading} className="inline-flex items-center gap-2 rounded-xl bg-foreground px-4 py-2.5 text-xs font-semibold text-background disabled:opacity-50">{savingSale ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />}{sale ? "Mettre à jour" : "Enregistrer le résultat"}</button></div>
            </>}
          </div>}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><h2 className="text-base font-semibold">Générer un bilan avec ORIA</h2><p className="mt-1 max-w-2xl text-xs leading-5 text-muted">Le moteur Python calcule les indicateurs. Le modèle IA sélectionné interprète uniquement ces agrégats et rédige un diagnostic.</p></div>
            <span className="rounded-full border border-border px-3 py-1.5 text-[10px] font-medium text-muted">{provider || "Fournisseur Chat"} · {packId || "Pack actif"}</span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <label className="grid gap-1.5 text-xs font-medium text-muted">Modèle IA autorisé par votre fournisseur et votre pack
              <select value={model} onChange={(event) => setModel(event.target.value)} disabled={models.length === 0 || reportBusy} className="w-full rounded-xl border border-border bg-background px-3 py-3 text-sm text-foreground disabled:opacity-50">
                {models.length === 0 ? <option value="">Aucun modèle disponible</option> : models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => void generateReport()} disabled={!model || reportBusy || hasPeriodError} className="inline-flex items-center justify-center gap-2 self-end rounded-xl bg-foreground px-5 py-3 text-sm font-semibold text-background disabled:cursor-not-allowed disabled:opacity-50">
              {reportBusy ? <LoaderCircle size={16} className="animate-spin" /> : <Sparkles size={16} />} {reportBusy ? "Génération en cours…" : "Générer le bilan"}
            </button>
          </div>
          {unavailableModels.length > 0 && <p className="mt-3 text-[11px] text-muted">{unavailableModels.length} modèle(s) masqué(s), car leur action de facturation Chat n'est pas configurée pour ce pack.</p>}
          {reportNotice && <p role="status" className="mt-4 rounded-xl border border-border bg-surface-secondary px-4 py-3 text-xs leading-5">{reportNotice}</p>}
          {activeReport && <div className="mt-5 rounded-2xl border border-border p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3"><div><p className="text-xs font-semibold">Bilan du {dateLabel(activeReport.period_start)} au {dateLabel(activeReport.period_end)}</p><p className="mt-1 text-[10px] text-muted">{activeReport.analysis_content?.provider || "Fournisseur inconnu"} · {activeReport.analysis_content?.model || "Modèle inconnu"} · {activeReport.analysis_content?.status || "État inconnu"}</p></div><span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted">{activeReport.analysis_content?.status === "completed" ? "Enregistré" : "À vérifier"}</span></div>
            {reportMarkdown ? <div className="pt-4"><OriaRichMessage content={reportMarkdown} language="fr" /></div> : <p className="pt-4 text-xs leading-5 text-muted">Aucun texte d'analyse n'est disponible pour ce rapport. Consulte son historique ou son statut avant de relancer une génération.</p>}
            {activeReport.analysis_content?.error && <p role="alert" className="mt-3 rounded-xl bg-surface-secondary p-3 text-xs">{activeReport.analysis_content.error}</p>}
            <p className="mt-4 border-t border-border pt-3 text-[10px] text-muted">Consommation : {numberLabel(activeReport.analysis_content?.credits_consumed || 0)} crédits · Coût API : {activeReport.analysis_content?.actual_api_cost_xaf ? amountLabel(activeReport.analysis_content.actual_api_cost_xaf, "XAF") : "non disponible"}</p>
          </div>}
        </section>

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold">Historique des bilans</h2><p className="mt-1 text-xs text-muted">Les rapports précédents conservent leur instantané de données.</p></div><FileText size={18} className="text-muted" /></div>
          {reports.length === 0 ? <p className="mt-4 rounded-xl bg-surface-secondary p-4 text-xs text-muted">Aucun bilan enregistré pour ce périmètre.</p> : <div className="mt-4 divide-y divide-border rounded-xl border border-border">{reports.map((item) => <button type="button" key={item.id} onClick={() => void openReport(item)} className={`flex w-full flex-wrap items-center justify-between gap-3 p-3 text-left transition hover:bg-surface-secondary ${activeReport?.id === item.id ? "bg-surface-secondary" : ""}`}><span><span className="block text-xs font-semibold">{dateLabel(item.period_start)} — {dateLabel(item.period_end)}</span><span className="mt-1 block text-[10px] text-muted">Généré le {dateLabel(item.generated_at || null)} · {item.analysis_content?.model || "Modèle indisponible"}</span></span><span className="rounded-full border border-border px-2.5 py-1 text-[10px] text-muted">{item.analysis_content?.status || "Enregistré"}</span></button>)}</div>}
        </section>



        <footer className="pb-4 text-center text-[10px] leading-5 text-muted">Les indicateurs sont calculés à partir des données ORIA enregistrées. Les recommandations IA ne modifient jamais les valeurs chiffrées.</footer>
      </div>
    </main>
  );
}
