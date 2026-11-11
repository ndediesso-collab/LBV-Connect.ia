/** ORIA Simulator V1 — moteur purement déclaratif. Aucune évaluation de code source. */
export type SimKind = "calculator" | "comparison" | "projection" | "sensitivity" | "allocation";
export type ControlKind = "slider" | "number" | "select";
export type Operator = "add" | "sub" | "mul" | "div" | "min" | "max" | "pow" | "abs" | "round";
export type Expr = number | string | { op: Operator; args: Expr[] };
export type InputSpec = {
  id: string; label: string; control: ControlKind;
  min: number; max: number; step: number; value: number; unit: string;
  options?: { label: string; value: number }[];
};
export type OutputSpec = { id: string; label: string; expr: Expr; unit: string; precision: number; chart: boolean };
export type Scenario = { name: string; values: Record<string, number> };
export type SimulatorSpec = {
  title: string; description: string; kind: SimKind; inputs: InputSpec[];
  outputs: OutputSpec[]; assumptions: string; scenarios: Scenario[];
  periods: number; periodUnit: string; sweepVariable: string; points: number;
};
export type Variables = Record<string, number>;

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const OPS = new Set<Operator>(["add", "sub", "mul", "div", "min", "max", "pow", "abs", "round"]);
const KINDS = new Set<SimKind>(["calculator", "comparison", "projection", "sensitivity", "allocation"]);
const CONTROLS = new Set<ControlKind>(["slider", "number", "select"]);
const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const text = (x: unknown, max = 120): string => typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "";
const finite = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && Math.abs(x) <= 1e12;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Valide les AST (taille, profondeur, opérateurs, références). */
function validExpr(value: unknown, known: Set<string>, depth = 0, quota = { nodes: 0 }): value is Expr {
  quota.nodes += 1;
  if (quota.nodes > 180 || depth > 12) return false;
  if (finite(value)) return true;
  if (typeof value === "string") return known.has(value) && IDENTIFIER.test(value);
  if (!isRecord(value) || !OPS.has(value.op as Operator) || !Array.isArray(value.args)) return false;
  const op = value.op as Operator;
  const args = value.args;
  if (args.length < 1 || args.length > 8) return false;
  if (["abs", "round"].includes(op) && args.length !== 1) return false;
  if (["sub", "div", "pow"].includes(op) && args.length !== 2) return false;
  return args.every(arg => validExpr(arg, known, depth + 1, quota));
}

export function parseSimulator(raw: string): SimulatorSpec | null {
  if (raw.length > 64_000) return null;
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return null; }
  if (!isRecord(json) || !KINDS.has(json.kind as SimKind)) return null;
  const kind = json.kind as SimKind;
  const inputValues = Array.isArray(json.inputs) ? json.inputs : [];
  const outputValues = Array.isArray(json.outputs) ? json.outputs : [];
  if (!inputValues.length || inputValues.length > 8 || !outputValues.length || outputValues.length > 8) return null;
  const inputs: InputSpec[] = [];
  const known = new Set<string>();
  for (const value of inputValues) {
    if (!isRecord(value)) return null;
    const id = text(value.id, 32), label = text(value.label, 100);
    const control = value.control as ControlKind;
    if (!IDENTIFIER.test(id) || known.has(id) || id === "period" || !label || !CONTROLS.has(control)) return null;
    if (![value.min, value.max, value.step, value.value].every(finite)) return null;
    const [min, max, step, initial] = [value.min, value.max, value.step, value.value] as number[];
    if (min >= max || step <= 0 || max - min > 1e12 || initial < min || initial > max) return null;
    let options: InputSpec["options"];
    if (control === "select") {
      const candidate = Array.isArray(value.options) ? value.options : [];
      if (!candidate.length || candidate.length > 15) return null;
      options = [];
      for (const option of candidate) {
        if (!isRecord(option) || !text(option.label, 80) || !finite(option.value)) return null;
        if (option.value < min || option.value > max) return null;
        options.push({ label: text(option.label, 80), value: option.value });
      }
      if (!options.some(option => option.value === initial)) return null;
    }
    inputs.push({ id, label, control, min, max, step, value: initial, unit: text(value.unit, 35), options });
    known.add(id);
  }
  if (kind === "projection") known.add("period");
  const outputs: OutputSpec[] = [];
  for (const value of outputValues) {
    if (!isRecord(value)) return null;
    const id = text(value.id, 32), label = text(value.label, 100);
    if (!IDENTIFIER.test(id) || known.has(id) || !label || !validExpr(value.expr, known)) return null;
    const precision = Number.isInteger(value.precision) ? clamp(value.precision as number, 0, 4) : 0;
    outputs.push({ id, label, expr: value.expr, unit: text(value.unit, 35), precision, chart: value.chart !== false });
    known.add(id);
  }
  const scenarios: Scenario[] = [];
  const rawScenarios = Array.isArray(json.scenarios) ? json.scenarios : [];
  if (rawScenarios.length > 6) return null;
  if (kind === "comparison" && rawScenarios.length < 2) return null;
  for (const rawScenario of rawScenarios) {
    if (!isRecord(rawScenario) || !isRecord(rawScenario.values)) return null;
    const name = text(rawScenario.name, 60);
    if (!name) return null;
    const values: Variables = {};
    for (const [key, val] of Object.entries(rawScenario.values)) {
      const input = inputs.find(item => item.id === key);
      if (!input || !finite(val) || val < input.min || val > input.max) return null;
      values[key] = val;
    }
    scenarios.push({ name, values });
  }
  const sweepVariable = text(json.sweepVariable, 32);
  if (kind === "sensitivity" && !inputs.some(item => item.id === sweepVariable)) return null;
  const periods = finite(json.periods) ? Math.floor(clamp(json.periods, 2, 120)) : 12;
  const points = finite(json.points) ? Math.floor(clamp(json.points, 5, 61)) : 25;
  return {
    title: text(json.title, 120) || "Simulation interactive",
    description: text(json.description, 500), kind, inputs, outputs,
    assumptions: text(json.assumptions, 500), scenarios, periods,
    periodUnit: text(json.periodUnit, 30) || "périodes",
    sweepVariable, points,
  };
}

/** Les seules opérations autorisées — aucun eval, Function, import ni accès DOM. */
export function evaluateExpr(expression: Expr, variables: Variables, depth = 0): number | null {
  if (depth > 12) return null;
  if (typeof expression === "number") return finite(expression) ? expression : null;
  if (typeof expression === "string") {
    const value = Object.prototype.hasOwnProperty.call(variables, expression) ? variables[expression] : undefined;
    return finite(value) ? value : null;
  }
  const args = expression.args.map(arg => evaluateExpr(arg, variables, depth + 1));
  if (args.some(v => v === null)) return null;
  const nums = args as number[];
  let value: number;
  switch (expression.op) {
    case "add": value = nums.reduce((a, b) => a + b, 0); break;
    case "sub": value = nums[0] - nums[1]; break;
    case "mul": value = nums.reduce((a, b) => a * b, 1); break;
    case "div": if (nums[1] === 0) return null; value = nums[0] / nums[1]; break;
    case "min": value = Math.min(...nums); break;
    case "max": value = Math.max(...nums); break;
    case "pow": if (Math.abs(nums[1]) > 8) return null; value = Math.pow(nums[0], nums[1]); break;
    case "abs": value = Math.abs(nums[0]); break;
    case "round": value = Math.round(nums[0]); break;
    default: return null;
  }
  return finite(value) ? value : null;
}

export function calculateOutputs(spec: SimulatorSpec, values: Variables, period = 1): Record<string, number | null> {
  const variables: Variables = Object.assign(Object.create(null), values, { period });
  const result: Record<string, number | null> = Object.create(null);
  for (const output of spec.outputs) {
    const v = evaluateExpr(output.expr, variables);
    result[output.id] = v;
    if (v !== null) variables[output.id] = v;
  }
  return result;
}

export function initialValues(spec: SimulatorSpec): Variables {
  return Object.fromEntries(spec.inputs.map(input => [input.id, input.value]));
}

export function sanitizeValue(input: InputSpec, value: number): number {
  if (!Number.isFinite(value)) return input.value;
  const clamped = clamp(value, input.min, input.max);
  const stepped = input.control === "slider" ? input.min + Math.round((clamped - input.min) / input.step) * input.step : clamped;
  return Number(clamp(stepped, input.min, input.max).toPrecision(12));
}
