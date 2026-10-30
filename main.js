"use strict";

/**
 * ClinePass — provider plugin with an upstream observer.
 *
 * `manifest.json` declares two providers over the same 15 ClinePass models:
 *
 *   clinepass           → https://api.cline.bot/api/v1   (direct, host-stored key)
 *   clinepass-upstream  → http://127.0.0.1:41892/v1      (this plugin, same models)
 *
 * The loopback one exists because Cline's gateway answers every response with
 * its own `routing` object (finalProvider, pinnedProvider, fallbacksAvailable,
 * promptCacheHitTokens, cost) and the host never parses it. The only way to see
 * which upstream served a request is to sit in the request path, so this plugin
 * forwards to api.cline.bot and tees the stream to read that block.
 *
 * Facts this file depends on (measured upstream, not assumed):
 *
 *   - The gateway ignores client-side routing fields. `provider.only` /
 *     `allow_fallbacks` change nothing: the landing upstream is a function of
 *     (api key, model id), so re-pinning means rewriting `model`.
 *   - `clientSessionId` is derived from the key — sending `sessionId` /
 *     `clientSessionId` in the body, or `x-session-id` / `x-cline-session-id`
 *     headers, does not move the request to another upstream.
 *   - A plugin-declared provider row is read-only in the host UI and its models
 *     are rebuilt from the manifest at startup only. The panel therefore
 *     rewrites this plugin's own *installed* manifest.json to publish the
 *     narrowed model list; the picker follows after a restart.
 *   - A plugin panel cannot reach loopback (panel egress is denied unless the
 *     manifest declares net.domains), so panel data travels through the
 *     documented settings channel as `routingSnapshot`.
 *   - The host signs requests for an `api_key` provider row as
 *     `Authorization: Bearer <host-stored key>`, loopback baseUrl included, so
 *     the observer path reuses the key the user already stored in Settings >
 *     Providers instead of asking for a second copy.
 */

const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

/* ------------------------------------------------------------- constants */

const HOST = "127.0.0.1";
/** Loopback port for the observer provider. Distinct from other plugins'. */
const PORT = 41892;
const UPSTREAM_HOST = "api.cline.bot";
const UPSTREAM_BASE = "/api/v1";

const PROVIDER_DIRECT = "clinepass";
const PROVIDER_UPSTREAM = "clinepass-upstream";
const SERVICE_ID = "clinepass-upstream-host";

const MAX_REQUEST_BYTES = 32 * 1024 * 1024;
const TEE_LIMIT = 8 * 1024 * 1024;
const LOG_LIMIT = 200;
const SNAPSHOT_LOG_LIMIT = 60;
const STATE_VERSION = 1;

const DEFAULTS = {
  enabled: true,
  apiKey: "",
  apiKeyEnc: "",
  enabledModels: "",
  preferredUpstream: "",
  injectRouting: false,
  hardPin: false,
  toastOnMismatch: true,
  modelThinking: "",
  modelIdOverride: "",
  upstreamProbe: "",
};

/* ----------------------------------------------------------- secret at rest */

/**
 * On Windows the optional plugin-held key is sealed with DPAPI (bound to the
 * logged-in user) before it reaches the settings file, so disk and snapshots
 * only ever carry ciphertext. Elsewhere there is no equivalent and the key
 * stays plaintext, which the log and the panel both say out loud.
 *
 * The key is optional: by default requests are forwarded with the Authorization
 * header the host already sends for the provider row.
 */
const CAN_SEAL = process.platform === "win32";
const SEAL_SCRIPT =
  "$s=[Console]::In.ReadToEnd(); $sec=ConvertTo-SecureString $s -AsPlainText -Force; ConvertFrom-SecureString $sec";
const UNSEAL_SCRIPT =
  "$b=[Console]::In.ReadToEnd(); $sec=ConvertTo-SecureString $b; $p=[System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec); [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($p)";

function powerShell(script, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 20000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(String(stderr || error.message || "powershell failed").trim()));
          return;
        }
        resolve(String(stdout).replace(/\r?\n$/, ""));
      },
    );
    child.stdin.end(String(input));
  });
}

async function sealKey(plain) {
  if (!CAN_SEAL) throw new Error("dpapi unavailable on " + process.platform);
  return powerShell(SEAL_SCRIPT, plain);
}

async function unsealKey(blob) {
  if (!CAN_SEAL) throw new Error("dpapi unavailable on " + process.platform);
  return powerShell(UNSEAL_SCRIPT, blob);
}

/* ------------------------------------------------------------------ state */

let settings = Object.assign({}, DEFAULTS);
let server = null;
let manifest = null;
let dataDir = "";
/** The key the host signed its last request with. Memory only, never persisted. */
let lastInboundKey = "";
let state = {
  version: STATE_VERSION,
  updatedAt: 0,
  models: {},
  log: [],
  lastError: null,
};

function log(level, message) {
  const line = `[clinepass] ${level}: ${message}`;
  if (level === "error") console.error(line);
  else console.log(line);
}

function messageOf(error) {
  if (!error) return "unknown error";
  return error.message || String(error);
}

function statePath() {
  return path.join(dataDir, "routing-state.json");
}

function loadState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    if (parsed && typeof parsed === "object" && parsed.models) {
      state = {
        version: STATE_VERSION,
        updatedAt: Number(parsed.updatedAt) || 0,
        models: parsed.models,
        log: Array.isArray(parsed.log) ? parsed.log : [],
        lastError: parsed.lastError || null,
        availableModels: Array.isArray(parsed.availableModels) ? parsed.availableModels : [],
        catalog: Array.isArray(parsed.catalog) ? parsed.catalog : [],
        upstreamCatalog: Array.isArray(parsed.upstreamCatalog) ? parsed.upstreamCatalog : [],
        catalogStatus: parsed.catalogStatus || null,
      };
    }
  } catch {
    /* first run: no state yet */
  }
}

function saveState() {
  if (!dataDir) return;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(statePath(), JSON.stringify(state), "utf8");
  } catch (error) {
    log("warn", "could not persist state: " + messageOf(error));
  }
  publishSnapshot();
}

/* ------------------------------------------------- snapshot through settings */

let snapshotTimer = null;

/**
 * A panel cannot reach loopback, so the snapshot travels through the settings
 * channel. Only clear the plaintext `apiKey` once a sealed blob actually
 * exists — otherwise a failed seal (no DPAPI, PowerShell blocked) would wipe
 * the key the host stores on the next snapshot.
 */
function settingsForHost() {
  const sealed = Boolean(String(settings.apiKeyEnc || "").trim());
  return Object.assign({}, settings, {
    apiKey: sealed ? "" : String(settings.apiKey || ""),
  });
}

function snapshotPayload() {
  return JSON.stringify({
    at: state.updatedAt,
    models: state.models,
    available: state.availableModels || [],
    official: officialModels().map((m) => m.id),
    declared: upstreamDeclared().map((m) => m.id),
    catalog: state.catalogStatus || null,
    log: (state.log || []).slice(0, SNAPSHOT_LOG_LIMIT),
    modelMeta: modelMetaMap(),
    probe: probeCache(),
    overrides: modelIdOverrides(),
    keySealed: Boolean(String(settings.apiKeyEnc || "").trim()),
    keySource: keySource(),
    endpoint: `http://${HOST}:${PORT}/v1`,
    listening: Boolean(server),
    lastError: state.lastError || null,
  });
}

function publishSnapshotNow() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = null;
  if (!pi || !pi.plugin || typeof pi.plugin.setSettings !== "function") return Promise.resolve();
  const payload = Object.assign(settingsForHost(), { routingSnapshot: snapshotPayload() });
  return Promise.resolve(pi.plugin.setSettings(payload)).catch((error) => {
    log("warn", "could not publish snapshot: " + messageOf(error));
  });
}

/** Debounced: a burst of turns publishes once. */
function publishSnapshot() {
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void publishSnapshotNow();
  }, 400);
}

/** "host" = the header the host signs with, "plugin" = the key typed in settings. */
function keySource() {
  if (String(settings.apiKey || "").trim()) return "plugin";
  if (lastInboundKey) return "host";
  return "none";
}

/** The key used outside a request (catalog fetch, upstream probe). */
function ambientKey() {
  return String(settings.apiKey || "").trim() || lastInboundKey;
}

/* ------------------------------------------------------------ model tables */

function providers() {
  const list = manifest && manifest.contributes && manifest.contributes.providers;
  return Array.isArray(list) ? list : [];
}

function modelsOf(id) {
  const provider = providers().find((p) => p && p.id === id);
  return provider && Array.isArray(provider.models) ? provider.models : [];
}

/**
 * The catalog the sync script owns: `clinepass` declares the official list from
 * Cline's own catalog, so it is the source of truth for ids and metadata.
 */
function officialModels() {
  return modelsOf(PROVIDER_DIRECT);
}

/** What the observer provider currently declares — the panel narrows this. */
function upstreamDeclared() {
  return modelsOf(PROVIDER_UPSTREAM);
}

/** Metadata lookup: official list wins, then whatever the observer declares. */
function modelMeta(id) {
  return (
    officialModels().find((m) => m.id === id) ||
    upstreamDeclared().find((m) => m.id === id) ||
    null
  );
}

/**
 * The picker's candidate set never shrinks on its own: Cline's `/models` used to
 * list cline-pass slugs and now returns OpenRouter-style ids, so the declared
 * list plus everything ever seen is what keeps a narrowed selection reversible.
 */
function knownCatalog() {
  const seen = [];
  const push = (id) => {
    if (id && seen.indexOf(id) === -1) seen.push(id);
  };
  for (const m of officialModels()) push(m.id);
  for (const m of upstreamDeclared()) push(m.id);
  for (const id of state.catalog || []) push(id);
  for (const id of state.availableModels || []) push(id);
  return seen;
}

function enabledModelSet() {
  const raw = String(settings.enabledModels || "");
  if (!raw.trim()) return null;
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return ids.length ? new Set(ids) : null;
}

function modelAllowed(model) {
  const set = enabledModelSet();
  if (!set) return true;
  return set.has(model);
}

function filterIds(ids) {
  const set = enabledModelSet();
  return set ? ids.filter((id) => set.has(id)) : ids;
}

function thinkingOverrides() {
  try {
    const parsed = JSON.parse(String(settings.modelThinking || "") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function levelsFor(id) {
  const meta = modelMeta(id);
  const levels = meta && Array.isArray(meta.thinkingLevels) ? meta.thinkingLevels : [];
  return levels.filter((level) => level !== "none");
}

/** Panel data: every model's level menu and the level it opens on. */
function modelMetaMap() {
  const overrides = thinkingOverrides();
  const map = {};
  for (const m of [...officialModels(), ...upstreamDeclared()]) {
    const levels = levelsFor(m.id);
    const want = overrides[m.id];
    map[m.id] = {
      name: m.name || m.id,
      contextWindow: m.contextWindow,
      maxTokens: m.maxTokens,
      levels,
      default:
        want && levels.indexOf(want) !== -1 ? want : m.defaultThinkingLevel || levels[levels.length - 1] || "",
    };
  }
  return map;
}

/**
 * Publish a narrowed model list by rewriting the *installed* manifest.json.
 *
 * The host rebuilds a plugin provider row from the manifest at startup only, so
 * this is what makes the selection take effect in the picker. It targets the
 * observer provider by id (never by index) and only writes when the list really
 * changed, so the write cannot bounce off the plugin hot reload into a loop.
 */
function publishModels(ids) {
  const target = path.join(__dirname, "manifest.json");
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    log("warn", "manifest read failed: " + messageOf(error));
    return false;
  }
  const list = doc?.contributes?.providers;
  if (!Array.isArray(list)) return false;
  const provider = list.find((p) => p && p.id === PROVIDER_UPSTREAM);
  if (!provider) {
    log("warn", `manifest has no ${PROVIDER_UPSTREAM} provider to publish into`);
    return false;
  }
  if (!ids.length) {
    log("warn", "declaration not written: empty model selection");
    return false;
  }
  const overrides = thinkingOverrides();
  const next = ids.map((id) => {
    const meta = modelMeta(id) || {};
    const levels = levelsFor(id).length ? levelsFor(id) : ["off", "low", "high", "max"];
    const want = overrides[id];
    return {
      id,
      name: meta.name || id,
      contextWindow: meta.contextWindow || 200000,
      maxTokens: meta.maxTokens || 32000,
      supportsImages: meta.supportsImages !== false,
      thinkingLevels: levels,
      defaultThinkingLevel:
        want && levels.indexOf(want) !== -1
          ? want
          : meta.defaultThinkingLevel && levels.indexOf(meta.defaultThinkingLevel) !== -1
            ? meta.defaultThinkingLevel
            : levels[levels.length - 1],
    };
  });
  // Compare the default level too: changing only the level leaves ids identical.
  const fingerprint = (models) =>
    JSON.stringify((models || []).map((m) => [m.id, m.defaultThinkingLevel || "", (m.thinkingLevels || []).join("/")]));
  if (fingerprint(provider.models) === fingerprint(next)) return false;

  provider.models = next;
  const tmp = target + ".tmp";
  try {
    fs.writeFileSync(tmp, JSON.stringify(doc, null, 2) + "\n", "utf8");
    fs.renameSync(tmp, target);
    log("info", `declaration updated: ${next.length} model(s) on ${PROVIDER_UPSTREAM}`);
    return true;
  } catch (error) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* nothing to clean */
    }
    log("warn", "manifest write failed: " + messageOf(error));
    return false;
  }
}

/* ----------------------------------------------------------------- catalog */

/**
 * Refresh the candidate list. Only `cline-pass/*` ids are usable models; the
 * full listing is kept because the upstream probe needs the OpenRouter-style
 * ids to find same-family candidates to anchor to.
 */
function fetchCatalog(done) {
  const known = knownCatalog();
  const finish = (ids, ok, note) => {
    state.availableModels = ids;
    state.catalogStatus = { ok, at: Date.now(), count: ids.length, note: note || null };
    saveState();
    if (done) done(ids);
  };
  const key = ambientKey();
  if (!key) {
    finish(known, false, "no-api-key");
    return;
  }
  const req = https.request(
    {
      host: UPSTREAM_HOST,
      port: 443,
      method: "GET",
      path: UPSTREAM_BASE + "/models",
      headers: { authorization: "Bearer " + key, accept: "application/json" },
    },
    (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        let ids = [];
        let allIds = [];
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          const list = Array.isArray(parsed?.data) ? parsed.data : [];
          allIds = list.filter((m) => m && typeof m.id === "string").map((m) => m.id);
          ids = allIds.filter((id) => id.startsWith("cline-pass/"));
        } catch (error) {
          log("warn", "catalog parse failed: " + messageOf(error));
        }
        if (allIds.length) state.upstreamCatalog = allIds;
        if (!ids.length) {
          log("warn", `catalog empty (status ${res.statusCode}), keeping ${known.length} known models`);
          finish(known, false, "empty:" + res.statusCode);
          return;
        }
        const merged = known.slice();
        for (const id of ids) if (merged.indexOf(id) === -1) merged.push(id);
        state.catalog = merged;
        finish(merged, true);
      });
    },
  );
  req.on("error", (error) => {
    log("warn", "catalog fetch failed: " + messageOf(error));
    finish(known, false, "network");
  });
  req.end();
}

/* ----------------------------------------------------------------- routing */

function numberAfter(text, key) {
  const m = new RegExp('"' + key + '"\\s*:\\s*(\\d+)').exec(text);
  return m ? Number(m[1]) : null;
}

function stringAfter(text, key) {
  const m = new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"').exec(text);
  return m ? m[1] : null;
}

/**
 * The billing field depends on the lane: a private lane reports `cost` as 0
 * while `inferenceCost` / `marketCost` carry the real number, so take the first
 * non-zero of market → inference → cost instead of showing a permanent $0.
 */
function readCost(body) {
  const pick = (key) => {
    const s = stringAfter(body, key);
    if (s !== null) return s;
    const n = numberAfter(body, key);
    return n === null ? null : String(n);
  };
  const isZero = (v) => v === null || Number(v) === 0;
  const market = pick("marketCost");
  if (!isZero(market)) return market;
  const inference = pick("inferenceCost");
  if (!isZero(inference)) return inference;
  return pick("cost");
}

/** Pull the gateway's routing block out of a (possibly SSE) response body. */
function parseRouting(body) {
  if (!body) return null;
  const at = body.lastIndexOf('"routing"');
  if (at < 0) return null;
  const window = body.slice(at, at + 8000);

  let fallbackNames = [];
  const list = /"fallbacksAvailable"\s*:\s*\[([^\]]*)\]/.exec(window);
  if (list) {
    fallbackNames = list[1]
      .split(",")
      .map((s) => s.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .slice(0, 40);
  }

  return {
    finalProvider: stringAfter(window, "finalProvider"),
    resolvedProvider: stringAfter(window, "resolvedProvider"),
    pinnedProvider: stringAfter(window, "pinnedProvider"),
    affinityOutcome: stringAfter(window, "affinity"),
    canonicalSlug: stringAfter(window, "canonicalSlug"),
    originalModelId: stringAfter(window, "originalModelId"),
    fallbackCount: list ? fallbackNames.length : null,
    fallbacks: fallbackNames,
    modelAttemptCount: numberAfter(window, "modelAttemptCount"),
    providerAttemptCount: numberAfter(window, "providerAttemptCount"),
    cacheHitTokens: numberAfter(body, "promptCacheHitTokens"),
    cacheMissTokens: numberAfter(body, "promptCacheMissTokens"),
    cost: readCost(body),
  };
}

function recordResult(model, routing, injected, statusCode, sent) {
  if (!model) return;
  const preferred = selectedUpstreams().join(" / ");
  const entry = {
    at: Date.now(),
    statusCode,
    finalProvider: routing ? routing.finalProvider : null,
    resolvedProvider: routing ? routing.resolvedProvider : null,
    pinnedProvider: routing ? routing.pinnedProvider : null,
    canonicalSlug: routing ? routing.canonicalSlug : null,
    fallbackCount: routing ? routing.fallbackCount : null,
    fallbacks: routing && Array.isArray(routing.fallbacks) ? routing.fallbacks : [],
    modelAttemptCount: routing ? routing.modelAttemptCount : null,
    providerAttemptCount: routing ? routing.providerAttemptCount : null,
    cacheHitTokens: routing ? routing.cacheHitTokens : null,
    cacheMissTokens: routing ? routing.cacheMissTokens : null,
    cost: routing ? routing.cost : null,
    injected: injected ? preferred : null,
    matched:
      injected && routing && routing.finalProvider
        ? selectedUpstreams().indexOf(routing.finalProvider) !== -1
        : null,
    requests: ((state.models[model] && state.models[model].requests) || 0) + 1,
    sentModel: sent && sent !== model ? sent : null,
  };

  state.models[model] = entry;

  const item = {
    at: entry.at,
    model,
    sentModel: entry.sentModel,
    statusCode: entry.statusCode,
    finalProvider: entry.finalProvider,
    pinnedProvider: entry.pinnedProvider,
    fallbackCount: entry.fallbackCount,
    cacheHitTokens: entry.cacheHitTokens,
    cost: entry.cost,
    injected: entry.injected,
    matched: entry.matched,
  };
  if (!Array.isArray(state.log)) state.log = [];
  state.log.unshift(item);
  if (state.log.length > LOG_LIMIT) state.log.length = LOG_LIMIT;
  state.updatedAt = entry.at;
  state.lastError = null;
  saveState();

  if (injected && entry.matched === false && settings.toastOnMismatch) {
    void toast(`目标上游 ${preferred}，实际落在 ${entry.finalProvider || "未知"}`);
  }
  if (injected && !routing) {
    log("warn", "response carried no routing metadata; pin cannot be verified");
  }
}

async function toast(message) {
  try {
    if (pi && pi.ui && typeof pi.ui.showToast === "function") await pi.ui.showToast(message);
  } catch (error) {
    log("warn", "toast failed: " + messageOf(error));
  }
}

/* ------------------------------------------------------------------- proxy */

function writeJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_REQUEST_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function forwardHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "content-length" || lower === "connection") continue;
    // Ask for identity so the routing block stays readable.
    if (lower === "accept-encoding") continue;
    out[key] = value;
  }
  return out;
}

/** A target list: `provider.only` is itself a whitelist array. */
function selectedUpstreams() {
  return String(settings.preferredUpstream || "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Id rewrite table: { logical model: id to send instead }. */
function modelIdOverrides() {
  try {
    const parsed = JSON.parse(String(settings.modelIdOverride || "") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function modelIdFor(model) {
  if (typeof model !== "string") return null;
  const mapped = modelIdOverrides()[model];
  return typeof mapped === "string" && mapped.trim() ? mapped.trim() : null;
}

/** Probe results: { logical model: [{ id, status, upstream, fallbacks }] }. */
function probeCache() {
  try {
    const parsed = JSON.parse(String(settings.upstreamProbe || "") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Candidate ids: same-family slugs from the full upstream catalog, at most 4. */
function probeCandidates(logical) {
  const slug = String(logical).split("/").slice(1).join("/") || String(logical);
  const out = [logical];
  const catalog =
    Array.isArray(state.upstreamCatalog) && state.upstreamCatalog.length
      ? state.upstreamCatalog
      : Array.isArray(state.catalog)
        ? state.catalog
        : [];
  for (const id of catalog) {
    if (typeof id !== "string" || id === logical) continue;
    if (id.includes(slug) && out.length < 5) out.push(id);
  }
  return out;
}

/**
 * Ask the upstream once, with a minimal request, which provider serves this id
 * and which others the model can fall back to.
 */
function probeUpstream(id) {
  return new Promise((resolve) => {
    const key = ambientKey();
    if (!key) {
      resolve({ id, status: 0, upstream: null, fallbacks: [], error: "no-api-key" });
      return;
    }
    const body = JSON.stringify({
      model: id,
      messages: [{ role: "user", content: "Answer with the single word ok." }],
      max_tokens: 96,
      stream: false,
    });
    const req = https.request(
      {
        host: UPSTREAM_HOST,
        port: 443,
        method: "POST",
        path: UPSTREAM_BASE + "/chat/completions",
        headers: {
          authorization: "Bearer " + key,
          "content-type": "application/json",
          accept: "application/json",
          "content-length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const routing = parseRouting(Buffer.concat(chunks).toString("utf8"));
          resolve({
            id,
            status: res.statusCode,
            upstream: routing ? routing.finalProvider : null,
            fallbacks: routing && Array.isArray(routing.fallbacks) ? routing.fallbacks : [],
          });
        });
      },
    );
    req.on("error", (error) => resolve({ id, status: 0, upstream: null, fallbacks: [], error: messageOf(error) }));
    req.write(body);
    req.end();
  });
}

/** The gateway ignores this today; it is kept so the panel can prove that. */
function injectRouting(model, payload) {
  if (!settings.injectRouting) return false;
  const list = selectedUpstreams();
  if (list.length === 0) return false;
  if (typeof model !== "string" || !model.startsWith("cline-pass/")) return false;

  const provider = { only: list };
  if (settings.hardPin) provider.allow_fallbacks = false;
  payload.provider = provider;
  return true;
}

function proxyChat(req, res) {
  readBody(req)
    .then((buffer) => {
      let payload = null;
      let model = null;
      let injected = false;
      let modelChanged = false;

      try {
        payload = JSON.parse(buffer.toString("utf8"));
        model = payload.model;
        // Anchoring: swap the logical id for the one that lands on the target.
        const mapped = modelIdFor(model);
        if (mapped && mapped !== model) {
          payload.model = mapped;
          modelChanged = true;
        }
        injected = injectRouting(model, payload);
      } catch (error) {
        log("warn", "could not parse request body, forwarding verbatim: " + messageOf(error));
      }

      if (!settings.enabled) {
        writeJson(res, 503, {
          error: {
            message: "ClinePass upstream observer is disabled in plugin settings; enable it or switch to the direct ClinePass provider.",
            type: "invalid_request_error",
            code: "observer_disabled",
          },
        });
        return;
      }

      if (model && !modelAllowed(model)) {
        // The host owns the provider row, so unchecking a model cannot remove
        // it from the picker; the forward layer refuses it instead.
        writeJson(res, 404, {
          error: {
            message: "model not enabled in the ClinePass observer: " + model,
            type: "invalid_request_error",
            code: "model_not_enabled",
          },
        });
        return;
      }

      const outgoing = injected || modelChanged ? Buffer.from(JSON.stringify(payload), "utf8") : buffer;
      const headers = forwardHeaders(req.headers);
      const inboundAuth = headers.authorization || headers.Authorization;
      if (inboundAuth) {
        // The host signs this row's requests with the key from Settings >
        // Providers; remember it for catalog/probe calls made outside a request.
        const token = String(inboundAuth).replace(/^Bearer\s+/i, "").trim();
        if (token) lastInboundKey = token;
      } else if (String(settings.apiKey || "").trim()) {
        headers.authorization = "Bearer " + String(settings.apiKey).trim();
      }
      headers["content-length"] = outgoing.length;

      const upstream = https.request(
        {
          host: UPSTREAM_HOST,
          port: 443,
          method: req.method,
          path: UPSTREAM_BASE + "/chat/completions",
          headers,
        },
        (upstreamRes) => {
          const responseHeaders = {};
          for (const [key, value] of Object.entries(upstreamRes.headers || {})) {
            const lower = key.toLowerCase();
            if (lower === "connection" || lower === "transfer-encoding" || lower === "content-length") continue;
            responseHeaders[key] = value;
          }
          res.writeHead(upstreamRes.statusCode || 502, responseHeaders);

          const tee = [];
          let teeSize = 0;

          upstreamRes.on("data", (chunk) => {
            res.write(chunk);
            if (teeSize < TEE_LIMIT) {
              tee.push(chunk);
              teeSize += chunk.length;
            }
          });

          upstreamRes.on("end", () => {
            res.end();
            let routing = null;
            try {
              routing = parseRouting(Buffer.concat(tee).toString("utf8"));
            } catch (error) {
              log("warn", "routing parse failed: " + messageOf(error));
            }
            recordResult(model, routing, injected, upstreamRes.statusCode || 0, payload && payload.model);
          });

          upstreamRes.on("error", (error) => {
            log("warn", "upstream stream error: " + messageOf(error));
            try {
              res.end();
            } catch {
              /* already closed */
            }
          });
        },
      );

      upstream.on("error", (error) => {
        log("error", "upstream request failed: " + messageOf(error));
        state.lastError = messageOf(error);
        saveState();
        if (!res.headersSent) writeJson(res, 502, { error: { message: messageOf(error), type: "upstream_unreachable" } });
        else res.end();
      });

      req.on("close", () => {
        if (!res.writableEnded) upstream.destroy();
      });

      upstream.end(outgoing);
    })
    .catch((error) => {
      if (!res.headersSent) writeJson(res, 400, { error: { message: messageOf(error), type: "bad_request" } });
    });
}

/* ------------------------------------------------------------------ server */

function handle(req, res) {
  const url = (req.url || "").split("?")[0];

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end();
    return;
  }

  if (req.method === "GET" && url === "/v1/models") {
    // Expose only what the observer declares, narrowed by the whitelist: a full
    // catalog here would let the host copy the whole list back into its row.
    const exposed = filterIds(upstreamDeclared().map((m) => m.id));
    writeJson(res, 200, {
      object: "list",
      data: exposed.map((id) => ({ id, object: "model", owned_by: "cline-pass" })),
    });
    return;
  }

  if (req.method === "POST" && url === "/v1/chat/completions") {
    proxyChat(req, res);
    return;
  }

  writeJson(res, 404, { error: { message: "not found: " + url, type: "invalid_request_error" } });
}

async function startServer() {
  if (server) return;
  await new Promise((resolve, reject) => {
    const created = http.createServer((req, res) => {
      try {
        handle(req, res);
      } catch (error) {
        log("error", "handler threw: " + messageOf(error));
        if (!res.headersSent) writeJson(res, 500, { error: { message: messageOf(error) } });
      }
    });
    created.once("error", reject);
    created.listen(PORT, HOST, () => {
      created.removeListener("error", reject);
      server = created;
      log("info", `loopback listening on http://${HOST}:${PORT}/v1`);
      resolve();
    });
  });
}

async function stopServer() {
  if (!server) return;
  const closing = server;
  server = null;
  await new Promise((resolve) => closing.close(() => resolve()));
  log("info", "loopback stopped");
}

/* ---------------------------------------------------------------- settings */

function applySettings(next) {
  if (!next || typeof next !== "object") return;
  for (const key of Object.keys(DEFAULTS)) {
    if (key in next) settings[key] = next[key];
  }
  settings.apiKey = String(settings.apiKey || "").trim();
  settings.apiKeyEnc = String(settings.apiKeyEnc || "").trim();
  settings.enabledModels = String(settings.enabledModels || "").trim();
  settings.preferredUpstream = String(settings.preferredUpstream || "").trim();
  settings.modelThinking = String(settings.modelThinking || "").trim();
  settings.modelIdOverride = String(settings.modelIdOverride || "").trim();
  settings.upstreamProbe = String(settings.upstreamProbe || "").trim();
  settings.injectRouting = Boolean(settings.injectRouting);
  settings.hardPin = Boolean(settings.hardPin);
  settings.toastOnMismatch = settings.toastOnMismatch !== false;
  settings.enabled = next.enabled === undefined ? settings.enabled : Boolean(next.enabled);
}

/* -------------------------------------------------------------- key at rest */

/** Encrypt the in-memory key back into host settings; disk keeps only the blob. */
async function persistSealedKey() {
  const plain = String(settings.apiKey || "").trim();
  if (!plain) return false;
  if (!CAN_SEAL) {
    log("warn", `no dpapi on ${process.platform}; the plugin-held api key stays plaintext`);
    return false;
  }
  try {
    const blob = await sealKey(plain);
    settings.apiKeyEnc = blob;
    if (pi && pi.plugin && typeof pi.plugin.setSettings === "function") {
      await pi.plugin.setSettings(Object.assign({}, settings, { apiKey: "" }));
    }
    log("info", "api key sealed with dpapi, blob chars " + blob.length);
    return true;
  } catch (error) {
    log("warn", "api key seal failed: " + messageOf(error));
    return false;
  }
}

/** Unseal at startup; a plaintext key left by an older install gets sealed too. */
async function hydrateKey() {
  if (String(settings.apiKey || "").trim()) {
    await persistSealedKey();
    return;
  }
  const blob = String(settings.apiKeyEnc || "").trim();
  if (!blob) return;
  try {
    settings.apiKey = String(await unsealKey(blob)).trim();
    log("info", "api key unsealed from dpapi blob");
  } catch (error) {
    log("warn", "api key unseal failed: " + messageOf(error));
  }
}

/* ----------------------------------------------------------------- manifest */

async function readManifest() {
  try {
    if (pi && pi.plugin && typeof pi.plugin.getManifest === "function") {
      manifest = await pi.plugin.getManifest();
    }
  } catch (error) {
    log("warn", "getManifest failed: " + messageOf(error));
  }
  if (!manifest) {
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8"));
    } catch (error) {
      log("warn", "manifest fallback failed: " + messageOf(error));
      manifest = {};
    }
  }
}

/* --------------------------------------------------------------- lifecycle */

let declarationTimer = null;

async function onLoad() {
  await readManifest();

  try {
    if (pi && pi.plugin && typeof pi.plugin.getDataPath === "function") dataDir = await pi.plugin.getDataPath();
  } catch (error) {
    log("warn", "getDataPath failed: " + messageOf(error));
  }
  if (!dataDir) dataDir = path.join(os.tmpdir(), "clinepass");
  loadState();

  // Older state only kept one row per model; seed the log so the panel is not
  // empty right after an upgrade.
  if (!Array.isArray(state.log) || state.log.length === 0) {
    state.log = Object.keys(state.models || {})
      .map((model) => {
        const e = state.models[model] || {};
        return {
          at: e.at || null,
          model,
          statusCode: e.statusCode,
          finalProvider: e.finalProvider,
          pinnedProvider: e.pinnedProvider,
          fallbackCount: e.fallbackCount,
          cacheHitTokens: e.cacheHitTokens,
          cost: e.cost,
          injected: e.injected,
          matched: e.matched,
          seeded: true,
        };
      })
      .sort((a, b) => (b.at || 0) - (a.at || 0));
  }

  try {
    if (pi && pi.plugin && typeof pi.plugin.getSettings === "function") {
      applySettings(await pi.plugin.getSettings());
      await hydrateKey();
    }
  } catch (error) {
    log("warn", "getSettings failed: " + messageOf(error));
  }

  try {
    if (pi && pi.events && typeof pi.events.on === "function") {
      pi.events.on("plugin:settingsChanged", (next) => {
        const incoming = next && typeof next === "object" ? Object.assign({}, next) : {};
        const typedKey = typeof incoming.apiKey === "string" ? incoming.apiKey.trim() : "";
        // The plaintext key is handled separately: an empty string in a partial
        // update must not wipe the key already held in memory.
        delete incoming.apiKey;
        const before = settings.enabledModels + "|" + settings.modelThinking;
        applySettings(incoming);
        if (typedKey && typedKey !== settings.apiKey) {
          settings.apiKey = typedKey;
          void persistSealedKey();
        }
        log("info", "settings updated from host");
        if (settings.enabledModels + "|" + settings.modelThinking !== before) {
          if (declarationTimer) clearTimeout(declarationTimer);
          declarationTimer = setTimeout(() => {
            declarationTimer = null;
            const candidates = state.availableModels && state.availableModels.length ? state.availableModels : knownCatalog();
            publishModels(filterIds(candidates));
          }, 1500);
        }
      });
    }
  } catch (error) {
    log("warn", "settings subscription failed: " + messageOf(error));
  }

  try {
    if (pi && pi.commands && typeof pi.commands.register === "function") {
      await pi.commands.register({
        id: "clinepass.upstream.open",
        title: "ClinePass: 打开上游面板",
        run: async () => {
          await pi.ui.openPanel();
        },
      });
      await pi.commands.register({
        id: "clinepass.status.reveal",
        title: "ClinePass: 在右侧显示状态",
        run: async () => {
          // Dock into the session's work panel; fall back to the window panel on
          // a host that does not offer views.
          if (pi.ui && typeof pi.ui.revealView === "function") {
            await pi.ui.revealView({ viewId: "status" });
          } else {
            await pi.ui.openPanel();
          }
        },
      });
      await pi.commands.register({
        id: "clinepass.upstream.clear",
        title: "ClinePass: 清空上游检测记录",
        run: async () => {
          clearRecords();
          await toast("已清空上游检测记录");
        },
      });
    }
  } catch (error) {
    log("warn", "command registration failed: " + messageOf(error));
  }

  try {
    if (pi && pi.services && typeof pi.services.register === "function") {
      pi.services.register({ id: SERVICE_ID, start: startServer, stop: stopServer });
    } else {
      await startServer();
    }
  } catch (error) {
    log("error", "service registration failed: " + messageOf(error));
  }

  // Pull the catalog on load so the panel's model list does not wait for a click.
  setTimeout(() => {
    fetchCatalog((ids) => log("info", "catalog ready: " + ids.length + " models"));
  }, 1200);
}

async function onUnload() {
  try {
    if (pi && pi.commands && typeof pi.commands.unregister === "function") {
      await pi.commands.unregister("clinepass.upstream.open");
      await pi.commands.unregister("clinepass.upstream.clear");
      await pi.commands.unregister("clinepass.status.reveal");
    }
  } catch {
    /* best effort */
  }
  await stopServer();
}

/** Drop the recorded routing results and the per-request log. */
function clearRecords() {
  state.models = {};
  state.log = [];
  state.lastError = null;
  state.updatedAt = Date.now();
  saveState();
}

/**
 * Panel writes come back here: the host routes every channel that is not one of
 * its fixed bridge channels to `onPanelInvoke`.
 */
async function onPanelInvoke(channel, payload) {
  const name = String(channel || "");
  if (name === "writeSettings") {
    applySettings(payload || {});
    if (String(settings.apiKey || "").trim()) await persistSealedKey();
    const safe = settingsForHost();
    if (pi && pi.plugin && typeof pi.plugin.setSettings === "function") {
      await pi.plugin.setSettings(safe);
    }
    return { ok: true, settings: safe };
  }
  if (name === "probeUpstream") {
    const model = String((payload && payload.model) || "");
    if (!model) throw new Error("probeUpstream requires a model");
    const rows = [];
    for (const id of probeCandidates(model)) {
      rows.push(await probeUpstream(id));
    }
    const cache = probeCache();
    cache[model] = rows;
    settings.upstreamProbe = JSON.stringify(cache);
    if (pi && pi.plugin && typeof pi.plugin.setSettings === "function") {
      await pi.plugin.setSettings(settingsForHost());
    }
    await publishSnapshotNow();
    return { ok: true, model, rows };
  }
  if (name === "applyModels") {
    return new Promise((resolve) => {
      fetchCatalog((ids) => {
        const exposed = filterIds(ids);
        const written = publishModels(exposed);
        resolve({ ok: true, applied: exposed.length, available: ids.length, written });
      });
    });
  }
  if (name === "readState") {
    return { ok: true, settings, available: state.availableModels || [] };
  }
  if (name === "openFullPanel") {
    if (pi && pi.ui && typeof pi.ui.openPanel === "function") await pi.ui.openPanel();
    return { ok: true };
  }
  if (name === "clearLog") {
    clearRecords();
    return { ok: true };
  }
  throw new Error("unknown panel channel: " + name);
}

module.exports = { onLoad, onUnload, onPanelInvoke };
