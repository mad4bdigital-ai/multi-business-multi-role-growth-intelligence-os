import {
  createGovernedExecutionBaselineTrace,
  emitGovernedExecutionBaselineSnapshot,
} from "./governedExecutionBaselineTelemetry.js";

const HTTP_ENTRY_POINTS = new Map([
  ["POST /gpt/tools/call", "gpt_tool"],
  ["POST /system/tools/call", "system_tool"],
  ["POST /admin/system/tools/call", "system_tool"],
]);

function safeHeader(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] || null;
  return typeof value === "string" ? value : null;
}

function responseBytes(res) {
  const value = typeof res?.getHeader === "function" ? res.getHeader("content-length") : null;
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : undefined;
}

function httpOutcome(statusCode) {
  const status = Number(statusCode || 0);
  if (status >= 200 && status < 400) return "success";
  if (status >= 400) return "failure";
  return "unknown";
}

function httpResultClassification(statusCode) {
  const status = Number(statusCode || 0);
  if (!Number.isFinite(status) || status <= 0) return "http_unknown";
  return `http_${Math.floor(status / 100)}xx`;
}

export function createGovernedExecutionBaselineHttpMiddleware(options = {}) {
  const emitter = options.emitter;
  const dependencies = options.dependencies || {};

  return function governedExecutionBaselineHttpMiddleware(req, res, next) {
    if (typeof emitter !== "function") return next();

    const method = String(req?.method || "").toUpperCase();
    const routePath = String(req?.path || req?.url || "").split("?", 1)[0];
    const entryPoint = HTTP_ENTRY_POINTS.get(`${method} ${routePath}`);
    if (!entryPoint) return next();

    const requestId = safeHeader(req, "x-request-id");
    const correlationId = safeHeader(req, "x-correlation-id") || requestId;
    const trace = createGovernedExecutionBaselineTrace({
      entry_point: entryPoint,
      request_id: requestId,
      correlation_id: correlationId,
    }, dependencies);

    // One bounded HTTP tool-call request entered the legacy shell. This does not
    // claim anything about provider calls or internal stage coverage.
    trace.increment("tool_round_trips", 1);
    const toolName = typeof req?.body?.name === "string" ? req.body.name : null;
    if (toolName === "response_chunk_read") trace.increment("continuation_calls", 1);

    let finalized = false;
    const finish = () => {
      if (finalized) return;
      finalized = true;
      const bytes = responseBytes(res);
      const snapshot = trace.finalize({
        outcome: httpOutcome(res?.statusCode),
        result_classification: httpResultClassification(res?.statusCode),
        ...(bytes === undefined ? {} : { response_bytes: bytes }),
      });
      void emitGovernedExecutionBaselineSnapshot(snapshot, emitter);
    };

    if (typeof res?.once === "function") {
      res.once("finish", finish);
      res.once("close", finish);
    }
    return next();
  };
}

export function createOptionalGovernedExecutionBaselineTrace(input = {}, options = {}) {
  if (typeof options.emitter !== "function") return null;
  return Object.freeze({
    trace: createGovernedExecutionBaselineTrace(input, options.dependencies || {}),
    emitter: options.emitter,
  });
}

export async function finalizeOptionalGovernedExecutionBaselineTrace(handle, output = {}) {
  if (!handle?.trace) return Object.freeze({ ok: true, emitted: false, code: "baseline_trace_not_configured", secrets_included: false });
  const snapshot = handle.trace.finalize(output);
  return emitGovernedExecutionBaselineSnapshot(snapshot, handle.emitter);
}

function wrapCallable(fn, onCall) {
  if (typeof fn !== "function") return fn;
  return async function governedExecutionBaselineWrappedCallable(...args) {
    onCall();
    return Reflect.apply(fn, this, args);
  };
}

export function instrumentAgentLoopDependencies(deps = {}, trace = null) {
  if (!trace) return deps;

  const wrapped = { ...deps };
  if (typeof deps.callModel === "function") {
    wrapped.callModel = wrapCallable(deps.callModel, () => trace.increment("model_round_trips", 1));
  }
  if (typeof deps.getCallModelForClass === "function") {
    wrapped.getCallModelForClass = function governedExecutionBaselineGetCallModelForClass(...args) {
      const selected = Reflect.apply(deps.getCallModelForClass, this, args);
      return wrapCallable(selected, () => trace.increment("model_round_trips", 1));
    };
  }
  if (deps.engineExecutorRegistry && typeof deps.engineExecutorRegistry.dispatch === "function") {
    const registry = deps.engineExecutorRegistry;
    wrapped.engineExecutorRegistry = {
      ...registry,
      dispatch: wrapCallable(registry.dispatch, () => trace.increment("tool_round_trips", 1)),
    };
  }
  return wrapped;
}

export function observeMcpProviderDispatch(trace) {
  if (!trace) return;
  trace.increment("provider_calls", 1);
}
