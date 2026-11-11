"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import ReactECharts from "echarts-for-react";
import { Copy, RotateCcw, SlidersHorizontal } from "lucide-react";
import {
  calculateOutputs, initialValues, parseSimulator, sanitizeValue,
  type OutputSpec, type SimulatorSpec, type Variables,
} from "./simulator-engine";
import styles from "./OriaSimulator.module.css";

type Language = "fr" | "en";
const numberFormat = (value: number, precision: number, language: Language) =>
  new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US", {
    maximumFractionDigits: precision,
    minimumFractionDigits: precision,
  }).format(value);
const formatResult = (value: number | null | undefined, spec: OutputSpec, language: Language) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : `${numberFormat(value, spec.precision, language)}${spec.unit ? ` ${spec.unit}` : ""}`;

function computeView(spec: SimulatorSpec, inputValues: Variables, activeScenario: number) {
  const selected = spec.kind === "comparison" ? spec.scenarios[activeScenario] : undefined;
  const effectiveValues = { ...inputValues, ...(selected?.values ?? {}) };
  const current = calculateOutputs(spec, effectiveValues, spec.kind === "projection" ? spec.periods : 1);
  const first = spec.outputs[0];
  const chartOutputs = spec.outputs.filter(o => o.chart && o.unit === first.unit).slice(0, 3);
  let graph: { kind: "bar" | "line" | "pie"; labels: string[]; series: { name: string; values: (number | null)[] }[] } | null = null;
  if (spec.kind === "comparison") {
    graph = {
      kind: "bar", labels: spec.scenarios.map(s => s.name),
      series: chartOutputs.map(output => ({
        name: output.label,
        values: spec.scenarios.map(s => calculateOutputs(spec, { ...inputValues, ...s.values })[output.id]),
      })),
    };
  } else if (spec.kind === "projection") {
    const periods = Array.from({ length: spec.periods }, (_, index) => index + 1);
    graph = {
      kind: "line", labels: periods.map(String),
      series: chartOutputs.map(output => ({
        name: output.label,
        values: periods.map(period => calculateOutputs(spec, inputValues, period)[output.id]),
      })),
    };
  } else if (spec.kind === "sensitivity") {
    const sweep = spec.inputs.find(input => input.id === spec.sweepVariable);
    if (sweep) {
      const xs = Array.from({ length: spec.points }, (_, i) => sweep.min + (i * (sweep.max - sweep.min)) / (spec.points - 1));
      graph = {
        kind: "line", labels: xs.map(x => numberFormat(x, 2, "fr")),
        series: chartOutputs.map(output => ({
          name: output.label,
          values: xs.map(x => calculateOutputs(spec, { ...inputValues, [sweep.id]: x })[output.id]),
        })),
      };
    }
  } else if (spec.kind === "allocation") {
    const parts = spec.outputs.filter(output => output.chart);
    graph = parts.length > 0 ? {
      kind: "pie", labels: parts.map(x => x.label),
      series: [{ name: first.unit || "Répartition", values: parts.map(o => current[o.id]) }],
    } : null;
  } else if (spec.outputs.length >= 2) {
    graph = {
      kind: "bar", labels: chartOutputs.map(output => output.label),
      series: [{ name: first.unit || "Valeur", values: chartOutputs.map(output => current[output.id]) }],
    };
  }
  return { effectiveValues, current, graph };
}

function Chart({ view, spec, dark, language }: {
  view: ReturnType<typeof computeView>["graph"];
  spec: SimulatorSpec; dark: boolean; language: Language;
}) {
  if (!view) return null;
  const palette = dark ? ["#f5f5f5", "#a3a3a3", "#707070"] : ["#141414", "#686868", "#bcbcbc"];
  const foreground = dark ? "#f5f5f5" : "#171717";
  const subtle = dark ? "#888888" : "#a3a3a3";
  const tooltip = { trigger: view.kind === "pie" ? "item" : "axis", confine: true, backgroundColor: dark ? "#222" : "#fff", borderColor: subtle, textStyle: { color: foreground } };
  const general = { color: palette, backgroundColor: "transparent", tooltip, animationDuration: 280, textStyle: { color: foreground } };
  const option = view.kind === "pie"
    ? {
        ...general,
        tooltip: { ...tooltip, trigger: "item", formatter: "{b}: {c} ({d}%)" },
        legend: { bottom: 0, type: "scroll", textStyle: { color: foreground } },
        series: [{
          type: "pie", radius: ["48%", "75%"], center: ["50%", "43%"],
          avoidLabelOverlap: true,
          label: { color: foreground, formatter: "{d}%" },
          data: view.labels.map((name, index) => ({
            name, value: Math.max(0, view.series[0].values[index] ?? 0),
          })),
        }],
      }
    : {
        ...general,
        grid: { left: 14, top: view.series.length > 1 ? 48 : 22, right: 16, bottom: 55, containLabel: true },
        legend: view.series.length > 1 ? { top: 0, textStyle: { color: foreground }, type: "scroll" } : undefined,
        xAxis: { type: "category", data: view.labels, axisLabel: { color: foreground, hideOverlap: true, rotate: view.labels.some(label => label.length > 11) ? 30 : 0 }, axisLine: { lineStyle: { color: subtle } }, axisTick: { show: false } },
        yAxis: { type: "value", axisLabel: { color: foreground }, splitLine: { lineStyle: { color: dark ? "#292929" : "#ebebeb" } } },
        dataZoom: view.labels.length > 24 ? [{ type: "inside" }, { type: "slider", height: 12, bottom: 4 }] : undefined,
        series: view.series.map((series, index) => ({
          type: view.kind, name: series.name, data: series.values,
          smooth: view.kind === "line", showSymbol: view.labels.length <= 20,
          barMaxWidth: 64,
          lineStyle: { width: 2.8 },
          areaStyle: view.kind === "line" ? { opacity: 0.07 } : undefined,
          itemStyle: { color: palette[index % palette.length], borderRadius: view.kind === "bar" ? [5, 5, 0, 0] : 0 },
        })),
      };
  if (view.kind === "pie" && view.series[0].values.every(value => value === null || value <= 0)) return null;
  return (
    <section className={styles.chartPanel} aria-label={language === "fr" ? "Graphique de simulation" : "Simulation chart"}>
      <p className={styles.smallHeading}>{spec.kind === "sensitivity" ? (language === "fr" ? "Sensibilité des résultats" : "Sensitivity analysis") : spec.kind === "comparison" ? (language === "fr" ? "Comparaison des scénarios" : "Scenario comparison") : spec.kind === "projection" ? (language === "fr" ? `Évolution sur ${spec.periods} ${spec.periodUnit}` : "Projection") : language === "fr" ? "Visualisation des résultats" : "Results visualisation"}</p>
      <ReactECharts option={option} notMerge={true} lazyUpdate={true} style={{ width: "100%", height: view.kind === "pie" ? 320 : 285 }} opts={{ renderer: "canvas" }} />
    </section>
  );
}

function InputControl({ input, value, onChange, language }: {
  input: SimulatorSpec["inputs"][number]; value: number; onChange: (value: number) => void; language: Language;
}) {
  const update = (next: number) => onChange(sanitizeValue(input, next));
  return (
    <label className={styles.control}>
      <span className={styles.controlHead}>
        <span className={styles.controlLabel}>{input.label}</span>
        {input.control !== "number" && <strong className={styles.controlValue}>{numberFormat(value, 2, language)}{input.unit ? ` ${input.unit}` : ""}</strong>}
      </span>
      {input.control === "slider" ? (
        <>
          <input className={styles.range} type="range" min={input.min} max={input.max} step={input.step} value={value} onChange={event => update(Number(event.target.value))} />
          <span className={styles.scale}><span>{numberFormat(input.min, 0, language)}</span><span>{numberFormat(input.max, 0, language)}</span></span>
        </>
      ) : input.control === "select" ? (
        <select className={styles.entry} value={value} onChange={event => update(Number(event.target.value))}>
          {input.options?.map(opt => <option key={opt.label + opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : (
        <div className={styles.numberRow}>
          <input className={styles.entry} type="number" min={input.min} max={input.max} step={input.step} value={value} onChange={event => update(Number(event.target.value))} />
          {input.unit && <span className={styles.numberUnit}>{input.unit}</span>}
        </div>
      )}
    </label>
  );
}

export default function OriaSimulator({ raw, language = "fr", fallback = null }: {
  kind?: string; raw: string; language?: Language; fallback?: ReactNode;
}) {
  const spec = useMemo(() => parseSimulator(raw), [raw]);
  const [values, setValues] = useState<Variables>(() => spec ? initialValues(spec) : {});
  const [activeScenario, setActiveScenario] = useState(0);
  const [dark, setDark] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    setValues(spec ? initialValues(spec) : {});
    setActiveScenario(0);
  }, [spec]);
  useEffect(() => {
    const root = document.documentElement;
    const refresh = () => setDark(root.classList.contains("dark"));
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  const view = useMemo(() => spec ? computeView(spec, values, activeScenario) : null, [spec, values, activeScenario]);
  if (!spec || !view) return <>{fallback}</>;
  const isFr = language === "fr";
  const tag = {
    calculator: isFr ? "Calculateur" : "Calculator",
    comparison: isFr ? "Scénarios" : "Scenarios",
    projection: isFr ? "Projection" : "Projection",
    sensitivity: isFr ? "Sensibilité" : "Sensitivity",
    allocation: isFr ? "Répartition" : "Allocation",
  }[spec.kind];
  const copy = async () => {
    const rows = spec.outputs.map(output => `${output.label}: ${formatResult(view.current[output.id], output, language)}`);
    try {
      await navigator.clipboard.writeText([spec.title, ...rows, spec.assumptions].filter(Boolean).join("\n"));
      setCopied(true);
    } catch { setCopied(false); }
  };
  const reset = () => { setValues(initialValues(spec)); setActiveScenario(0); setCopied(false); };
  return (
    <section className={styles.shell} aria-label={spec.title}>
      <header className={styles.header}>
        <div>
          <span className={styles.eyebrow}><SlidersHorizontal size={13} aria-hidden="true" /> ORIA · {tag}</span>
          <h3 className={styles.title}>{spec.title}</h3>
          {spec.description && <p className={styles.description}>{spec.description}</p>}
        </div>
        <div className={styles.actions}>
          <button type="button" onClick={reset} className={styles.action} title={isFr ? "Réinitialiser" : "Reset"}><RotateCcw size={15} aria-hidden="true" /><span>{isFr ? "Réinitialiser" : "Reset"}</span></button>
          <button type="button" onClick={() => { void copy(); }} className={styles.action} title={isFr ? "Copier les résultats" : "Copy results"}><Copy size={15} aria-hidden="true" /><span>{copied ? (isFr ? "Copié" : "Copied") : (isFr ? "Copier" : "Copy")}</span></button>
        </div>
      </header>
      <div className={styles.body}>
        <div className={styles.controlsPanel}>
          <div className={styles.panelTitle}><span className={styles.dot} />{isFr ? "Paramètres modifiables" : "Editable parameters"}</div>
          <div className={styles.controlsGrid}>
            {spec.inputs.map(input => <InputControl key={input.id} input={input} value={values[input.id] ?? input.value} language={language}
              onChange={next => { setValues(previous => ({ ...previous, [input.id]: next })); setCopied(false); }} />)}
          </div>
          {spec.kind === "comparison" && <div className={styles.scenarios} role="group" aria-label={isFr ? "Choisir un scénario" : "Choose a scenario"}>
            {spec.scenarios.map((scenario, index) => <button key={index} type="button" aria-pressed={index === activeScenario}
              onClick={() => setActiveScenario(index)} className={`${styles.scenario} ${index === activeScenario ? styles.scenarioActive : ""}`}>{scenario.name}</button>)}
            <p className={styles.hint}>{isFr ? "Le scénario remplace certaines valeurs de référence ; les autres restent réglables." : "Scenarios override selected baseline inputs."}</p>
          </div>}
        </div>
        <div className={styles.resultsPanel} aria-live="polite" aria-atomic="false">
          <div className={styles.panelTitle}><span className={styles.dot} />{isFr ? "Résultats en direct" : "Live results"}</div>
          <div className={styles.resultsGrid}>
            {spec.outputs.map(output => <div className={styles.metric} key={output.id}>
              <span className={styles.metricLabel}>{output.label}</span>
              <strong className={styles.metricValue}>{formatResult(view.current[output.id], output, language)}</strong>
            </div>)}
          </div>
          {view.graph && <Chart view={view.graph} spec={spec} dark={dark} language={language} />}
        </div>
      </div>
      {spec.assumptions && <footer className={styles.footer}><strong>{isFr ? "Hypothèses : " : "Assumptions: "}</strong>{spec.assumptions}</footer>}
    </section>
  );
}
