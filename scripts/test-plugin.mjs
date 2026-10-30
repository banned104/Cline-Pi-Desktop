/**
 * Plugin test harness — run with `node scripts/test-plugin.mjs`.
 *
 * Loads the real `main.js` with a fake `pi` host, starts the registered service
 * and exercises the loopback endpoint, the panel channels, the routing parser and
 * both renderer pages' render paths. It works on a *copy* of the plugin under the
 * temp directory, so the repo manifest is never rewritten.
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";

const require = createRequire(import.meta.url);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const HARNESS = join(tmpdir(), "clinepass-plugin-test");
// PI holds the plugin's own 41892 while it runs, so the copy listens elsewhere.
const HARNESS_PORT = Number(process.env.CLINEPASS_TEST_PORT || 41899);

rmSync(HARNESS, { recursive: true, force: true });
mkdirSync(HARNESS, { recursive: true });
for (const file of ["manifest.json", "main.js"]) {
  cpSync(join(REPO, file), join(HARNESS, file));
}
cpSync(join(REPO, "renderer"), join(HARNESS, "renderer"), { recursive: true });

// Patch the copy only: main.js listens on the harness port, and the manifest's
// loopback baseUrl must agree or the roles check would compare two different ports.
const mainCopy = readFileSync(join(HARNESS, "main.js"), "utf8");
if (!mainCopy.includes("const PORT = 41892;")) throw new Error("main.js PORT line moved");
writeFileSync(join(HARNESS, "main.js"), mainCopy.replace("const PORT = 41892;", `const PORT = ${HARNESS_PORT};`), "utf8");
const manifestCopy = readFileSync(join(HARNESS, "manifest.json"), "utf8");
writeFileSync(
  join(HARNESS, "manifest.json"),
  manifestCopy.replace(/http:\/\/127\.0\.0\.1:41892/g, `http://127.0.0.1:${HARNESS_PORT}`),
  "utf8",
);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

/* ------------------------------------------------------------------- host */

const manifestObj = JSON.parse(readFileSync(`${HARNESS}/manifest.json`, "utf8"));
let settingsStore = {
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
let settingsListener = null;
const commands = new Map();
const services = [];
const toasts = [];

globalThis.pi = {
  plugin: {
    getId: () => "pi.clinepass",
    getManifest: () => manifestObj,
    getSettings: async () => ({ ...settingsStore }),
    setSettings: async (partial) => {
      Object.assign(settingsStore, partial);
    },
    getDataPath: async () => `${HARNESS}/data`,
  },
  commands: {
    register: async (command) => {
      commands.set(command.id, command);
    },
    unregister: async (id) => {
      commands.delete(id);
    },
  },
  ui: {
    openPanel: async () => { openedPanels += 1; },
    revealView: async (input) => { revealedViews.push(input); },
    showToast: async (m) => toasts.push(m),
  },
  events: { on: (name, fn) => { settingsListener = fn; } },
  services: { register: (svc) => services.push(svc), unregister: async () => {} },
};

const mod = require(`${HARNESS}/main.js`);
await mod.onLoad();

check("onLoad registers every command", commands.size === 3, [...commands.keys()].join(", "));
check("onLoad registers one service", services.length === 1, services[0]?.id ?? "none");
await services[0].start();

const BASE = `http://127.0.0.1:${HARNESS_PORT}`;

/* --------------------------------------------------------------- endpoint */

const modelsRes = await fetch(`${BASE}/v1/models`);
const modelsBody = await modelsRes.json();
check(
  "GET /v1/models lists the declared models",
  modelsRes.status === 200 && modelsBody.data?.length === 15,
  `status ${modelsRes.status}, ${modelsBody.data?.length} models`,
);

const notFound = await fetch(`${BASE}/v1/does-not-exist`);
check("unknown route is 404", notFound.status === 404, `status ${notFound.status}`);

// Forwarding: a bogus key must come back as the gateway's own error, not a 502.
const forwardRes = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer not-a-real-key" },
  body: JSON.stringify({
    model: "cline-pass/glm-5.3",
    messages: [{ role: "user", content: "hi" }],
    max_tokens: 8,
    stream: false,
  }),
});
const forwardText = await forwardRes.text();
check(
  "POST /v1/chat/completions reaches api.cline.bot",
  forwardRes.status === 401,
  `status ${forwardRes.status} (401 = gateway rejected the bogus key, so forwarding worked) :: ${forwardText.slice(0, 120)}`,
);

/* --------------------------------------------------------- panel channels */

// readState was removed: it had no renderer caller and returned the plaintext
// apiKey. It must stay refused, not silently come back.
let readStateRefused = false;
try {
  await mod.onPanelInvoke("readState", null);
} catch {
  readStateRefused = true;
}
check("the removed readState channel is refused", readStateRefused);

let unknownThrew = false;
try {
  await mod.onPanelInvoke("nope", null);
} catch {
  unknownThrew = true;
}
check("unknown panel channel throws", unknownThrew);

const write = await mod.onPanelInvoke("writeSettings", {
  enabledModels: "cline-pass/glm-5.3,cline-pass/kimi-k3",
});
check(
  "writeSettings narrows the whitelist",
  write?.ok === true && settingsStore.enabledModels === "cline-pass/glm-5.3,cline-pass/kimi-k3",
  settingsStore.enabledModels,
);

const blocked = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer x" },
  body: JSON.stringify({ model: "cline-pass/qwen3.7-max", messages: [] }),
});
const blockedBody = await blocked.json();
check(
  "whitelist blocks an unselected model",
  blocked.status === 404 && blockedBody?.error?.code === "model_not_enabled",
  `${blocked.status} ${blockedBody?.error?.code}`,
);

const modelsAfter = await fetch(`${BASE}/v1/models`);
const modelsAfterBody = await modelsAfter.json();
check(
  "GET /v1/models follows the whitelist",
  modelsAfterBody.data?.length === 2,
  `${modelsAfterBody.data?.length} models`,
);

/* ------------------------------------------------- manifest republication */

const applied = await mod.onPanelInvoke("applyModels", null);
const publishedManifest = JSON.parse(readFileSync(`${HARNESS}/manifest.json`, "utf8"));
// The observed row is narrowed; the escape hatch must stay complete.
const observedModels = publishedManifest.contributes.providers.find((p) => p.id === "clinepass").models;
const directModels = publishedManifest.contributes.providers.find((p) => p.id === "clinepass-direct").models;
check(
  "applyModels narrows the observed row only",
  observedModels.length === 2 && directModels.length === 15,
  `applied ${applied?.applied}, observed ${observedModels.length}, direct ${directModels.length}`,
);
check(
  "republished entries keep the official numbers",
  observedModels.every((m) => m.contextWindow > 0 && m.maxTokens > 0 && m.defaultThinkingLevel),
  JSON.stringify(observedModels.map((m) => [m.id, m.defaultThinkingLevel])),
);

// The settings listener path (debounced 1500ms) must write once, not loop.
const beforeListener = readFileSync(`${HARNESS}/manifest.json`, "utf8");
settingsListener?.({ enabledModels: "cline-pass/glm-5.3" });
await new Promise((r) => setTimeout(r, 2000));
const afterListener = JSON.parse(readFileSync(`${HARNESS}/manifest.json`, "utf8"));
const afterModels = afterListener.contributes.providers.find((p) => p.id === "clinepass").models;
check(
  "settingsChanged republishes after the debounce",
  afterModels.length === 1 && afterModels[0].id === "cline-pass/glm-5.3",
  `${afterModels.length} model(s)`,
);

// Roles must stay as declared: the observed row is the loopback one (whose id
// carries the user's stored key) and the escape hatch is the direct URL.
const declaredProviders = manifestObj.contributes.providers;
const observedRow = declaredProviders.find((p) => p.id === "clinepass");
const directRow = declaredProviders.find((p) => p.id === "clinepass-direct");
check(
  "clinepass is the observed loopback row",
  observedRow?.baseUrl === `http://127.0.0.1:${HARNESS_PORT}/v1` && observedRow.authKind === "api_key",
  `${observedRow?.baseUrl} (${observedRow?.authKind})`,
);
check(
  "clinepass-direct is the escape hatch",
  directRow?.baseUrl === "https://api.cline.bot/api/v1",
  String(directRow?.baseUrl),
);

/* ------------------------------------------------------------------ off */

await mod.onPanelInvoke("writeSettings", { enabled: false });
const offRes = await fetch(`${BASE}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: "Bearer x" },
  body: JSON.stringify({ model: "cline-pass/glm-5.3", messages: [] }),
});
const offBody = await offRes.json();
check(
  "disabling the observer refuses to forward",
  offRes.status === 503 && offBody?.error?.code === "observer_disabled",
  `${offRes.status} ${offBody?.error?.code}`,
);

/* --------------------------------------------------------- routing parser */

// Evaluate the real parser text from main.js, not a copy.
const source = readFileSync(join(REPO, "main.js"), "utf8");
const start = source.indexOf("function numberAfter");
const end = source.indexOf("function recordResult");
const parserSource = source.slice(start, end);
const parseRouting = new Function(`${parserSource}; return parseRouting;`)();

const sse = [
  'data: {"id":"x","choices":[{"delta":{"content":"hi"}}],"routing":{"finalProvider":"fireworks","pinnedProvider":"deepseek","fallbacksAvailable":["alibaba","baseten"],"canonicalSlug":"deepseek/deepseek-v4.1-flash","originalModelId":"cline-pass/deepseek-v4.1-flash","modelAttemptCount":1,"providerAttemptCount":2},"promptCacheHitTokens":1280,"promptCacheMissTokens":64,"marketCost":"0.00031"}',
  "data: [DONE]",
  "",
].join("\n");
const parsed = parseRouting(sse);
check(
  "parseRouting reads an SSE routing block",
  parsed?.finalProvider === "fireworks" &&
    parsed?.pinnedProvider === "deepseek" &&
    parsed?.fallbackCount === 2 &&
    parsed?.cacheHitTokens === 1280 &&
    parsed?.cost === "0.00031",
  JSON.stringify(parsed),
);
check("parseRouting returns null without metadata", parseRouting('data: {"choices":[]}') === null);
check(
  "cost falls back to inferenceCost when cost is 0",
  parseRouting('{"routing":{"finalProvider":"alibaba"},"cost":0,"inferenceCost":"0.0002"}').cost === "0.0002",
);
check(
  "cost prefers marketCost over the private-lane zero",
  parseRouting('{"routing":{"finalProvider":"alibaba"},"cost":0,"marketCost":"0.0004"}').cost === "0.0004",
);

/* --------------------------------------------------- status view + channels */

let openedPanels = 0;

// Every getElementById in a renderer script must exist in its HTML, or the page
// dies on the first render() call.
for (const [html, script] of [
  ["renderer/index.html", "renderer/panel.js"],
  ["renderer/view.html", "renderer/view.js"],
]) {
  const source = readFileSync(`${REPO}/${script}`, "utf8");
  let parses = true;
  try {
    new Function(source); // parse only: a syntax error kills the page at load
  } catch {
    parses = false;
  }
  check(`${script} parses`, parses);
  const ids = new Set([...readFileSync(`${REPO}/${html}`, "utf8").matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  const wanted = [...source.matchAll(/getElementById\("([^"]+)"\)/g)].map((m) => m[1]);
  const missing = wanted.filter((id) => !ids.has(id));
  check(`${script} element ids exist in ${html}`, missing.length === 0, missing.length ? `missing ${missing.join(", ")}` : `${wanted.length} ids`);
}

// Both pages are classic scripts, so each must load shared.js before its own
// script or the destructure at the top of the page throws.
for (const [html, page] of [
  ["renderer/index.html", "panel.js"],
  ["renderer/view.html", "view.js"],
]) {
  const text = readFileSync(`${REPO}/${html}`, "utf8");
  const sharedAt = text.indexOf('src="shared.js"');
  const pageAt = text.indexOf(`src="${page}"`);
  check(
    `${html} loads shared.js before ${page}`,
    sharedAt > 0 && pageAt > sharedAt,
    `shared@${sharedAt} page@${pageAt}`,
  );
}

// The manifest must declare the docked view, its entry must exist, and the
// permission it needs must be granted.
const viewContrib = (manifestObj.contributes.views ?? []).find((v) => v.id === "status");
check(
  "manifest declares the status view with an existing entry",
  Boolean(viewContrib) && readFileSync(`${REPO}/${viewContrib.entry}`, "utf8").length > 0,
  viewContrib ? viewContrib.entry : "not declared",
);
check(
  "manifest grants ui.view",
  (manifestObj.permissions ?? []).includes("ui.view"),
  (manifestObj.permissions ?? []).join(", "),
);

// The snapshot the view reads must carry the fields it renders.
await new Promise((r) => setTimeout(r, 700)); // saveState publishes on a 400ms debounce
const published = JSON.parse(settingsStore.routingSnapshot);
check(
  "snapshot carries listening / lastError / endpoint",
  published.listening === true && published.lastError === null && typeof published.endpoint === "string",
  JSON.stringify({ listening: published.listening, lastError: published.lastError, endpoint: published.endpoint }),
);

const opened = await mod.onPanelInvoke("openFullPanel", null);
check("openFullPanel opens the window panel", opened?.ok === true && openedPanels === 1, `openedPanels ${openedPanels}`);

// clearLog must empty the recorded results and republish that.
const cleared = await mod.onPanelInvoke("clearLog", null);
await new Promise((r) => setTimeout(r, 700)); // wait for the debounced republish
const afterClear = JSON.parse(settingsStore.routingSnapshot);
check(
  "clearLog empties the log and the per-model results",
  cleared?.ok === true && afterClear.log.length === 0 && Object.keys(afterClear.models).length === 0,
  `log ${afterClear.log.length}, models ${Object.keys(afterClear.models).length}`,
);

// The declared commands and the registered handlers must agree, and the status
// command must actually reveal the docked view.
const declaredCommands = (manifestObj.contributes.commands ?? []).map((c) => c.id).sort();
const registeredCommands = [...commands.keys()].sort();
check(
  "every declared command has a registered handler",
  JSON.stringify(declaredCommands) === JSON.stringify(registeredCommands),
  `declared ${declaredCommands.join(", ")} | registered ${registeredCommands.join(", ")}`,
);

let revealedViews = [];
await commands.get("clinepass.status.reveal").run();
check(
  "the status command reveals the docked view",
  revealedViews.length === 1 && revealedViews[0]?.viewId === "status",
  JSON.stringify(revealedViews),
);

/* ------------------------------------------------------- renderer render smoke tests (DOM shim) */

/**
 * A render path that throws leaves the page showing "读取失败" plus a raw error
 * line — exactly how the 2.1.0 status view shipped broken. So run each renderer
 * script's real render() against a realistic snapshot, not just parse it.
 */
function makeDom() {
  const makeEl = (tag = "div") => ({
    tagName: tag,
    className: "",
    textContent: "",
    title: "",
    value: "",
    type: "",
    checked: false,
    disabled: false,
    colSpan: 0,
    children: [],
    classList: { add() {}, remove() {}, contains: () => false },
    appendChild(child) { this.children.push(child); return child; },
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = nodes; },
    setAttribute() {},
    addEventListener() {},
  });
  const cache = new Map();
  const document = {
    createElement: (tag) => makeEl(tag),
    createDocumentFragment: () => makeEl("#fragment"),
    createTextNode: (text) => ({ textContent: String(text) }),
    getElementById: (id) => {
      if (!cache.has(id)) cache.set(id, makeEl());
      return cache.get(id);
    },
  };
  return { document, byId: (id) => document.getElementById(id) };
}

const now = Date.now();
const smokeSnapshot = {
  at: now,
  models: {
    "cline-pass/glm-5.3": {
      at: now,
      // deliberately no `model` field: the view must fall back to the map key,
      // which is what the producer guarantees.
      sentModel: null,
      statusCode: 200,
      finalProvider: "fireworks",
      pinnedProvider: "deepseek",
      fallbackCount: 2,
      fallbacks: ["alibaba", "baseten"],
      cacheHitTokens: 1280,
      cost: "0.00031",
      injected: null,
      matched: null,
      requests: 3,
    },
  },
  available: ["cline-pass/glm-5.3", "cline-pass/kimi-k3"],
  official: ["cline-pass/glm-5.3", "cline-pass/kimi-k3"],
  declared: ["cline-pass/glm-5.3", "cline-pass/kimi-k3"],
  catalog: { ok: true, at: now, count: 2, note: null },
  log: [
    {
      at: now,
      model: "cline-pass/glm-5.3",
      finalProvider: "fireworks",
      pinnedProvider: "deepseek",
      fallbackCount: 2,
      cacheHitTokens: 1280,
      cost: "0.00031",
      injected: null,
      matched: null,
    },
  ],
  modelMeta: {
    "cline-pass/glm-5.3": { name: "GLM-5.3", levels: ["low", "high", "max"], default: "high" },
    "cline-pass/kimi-k3": { name: "Kimi K3", levels: ["low", "high", "max"], default: "high" },
  },
  probe: { "cline-pass/glm-5.3": [{ id: "deepseek/deepseek-v4.1-flash", status: 200, upstream: "alibaba", fallbacks: [] }] },
  overrides: { "cline-pass/glm-5.3": "deepseek/deepseek-v4.1-flash" },
  keySealed: false,
  keySource: "none",
  endpoint: "http://127.0.0.1:41892/v1",
  listening: true,
  lastError: null,
};

const smokeSettings = {
  enabled: true,
  enabledModels: "",
  preferredUpstream: "fireworks",
  injectRouting: true,
  hardPin: false,
  toastOnMismatch: true,
  modelThinking: "",
  modelIdOverride: "",
  upstreamProbe: "",
  apiKey: "",
  apiKeyEnc: "",
  routingSnapshot: JSON.stringify(smokeSnapshot),
};

const smokeScenarios = [
  { name: "a real snapshot", settings: smokeSettings },
  {
    name: "no snapshot yet, observer disabled",
    settings: { ...smokeSettings, enabled: false, routingSnapshot: "" },
  },
  {
    name: "a snapshot with an error and no rows",
    settings: {
      ...smokeSettings,
      routingSnapshot: JSON.stringify({
        ...smokeSnapshot,
        models: {},
        log: [],
        listening: false,
        lastError: "upstream request failed: ECONNRESET",
      }),
    },
  },
];

for (const script of ["renderer/view.js", "renderer/panel.js"]) {
  for (const scenario of smokeScenarios) {
    const dom = makeDom();
    const source = readFileSync(`${REPO}/${script}`, "utf8");
    const fakeWindow = {
      pluginBridge: {
        invoke: async (channel) => (channel === "plugin.getSettings" ? scenario.settings : { ok: true }),
      },
    };
    let failure = null;
    try {
      // The pages are classic scripts: shared.js must run first, exactly as the
      // HTML loads them.
      const shared = new Function("window", "document", "console", readFileSync(`${REPO}/renderer/shared.js`, "utf8"));
      shared(fakeWindow, dom.document, { log() {}, error() {}, warn() {} });
      const run = new Function(
        "window",
        "document",
        "console",
        "setInterval",
        "clearInterval",
        `${source}\n; return { render, refresh };`,
      );
      const api = run(fakeWindow, dom.document, { log() {}, error() {}, warn() {} }, () => 0, () => {});
      await new Promise((resolve) => setTimeout(resolve, 60));
      await api.refresh(false);
      api.render();
    } catch (error) {
      failure = error && error.message ? error.message : String(error);
    }
    const hint = String(dom.byId("hint").textContent || "");
    check(
      `${script} renders ${scenario.name} without throwing`,
      failure === null && !hint.includes("读取失败"),
      failure || (hint ? `hint: ${hint.slice(0, 60)}` : "rendered"),
    );
    // The 2.2.0 bug: the view's "last request" card rendered a blank model name
    // because it read a field the producer never wrote, and the fixture hid it by
    // supplying that field. The fixture no longer does.
    if (script === "renderer/view.js" && scenario.name === "a real snapshot") {
      const walk = (root, out = []) => {
        for (const child of root.children || []) {
          out.push(child);
          walk(child, out);
        }
        return out;
      };
      const modelNode = walk(dom.byId("last")).find((n) => n.className === "last-model");
      check(
        "the view prints the last request's model name",
        Boolean(modelNode && String(modelNode.textContent).trim()),
        modelNode ? JSON.stringify(modelNode.textContent) : "no .last-model node",
      );
    }
  }
}

/* -------------------------------------------------------- glossary coverage */

{
  const sharedWindow = {};
  new Function("window", readFileSync(`${REPO}/renderer/shared.js`, "utf8"))(sharedWindow);
  const terms = sharedWindow.ClinePassPanel.TERMS;
  const expected = ["upstream", "landed", "pinned", "fallbacks", "cache", "cost", "verdict", "count", "anchor", "names"];
  const missing = expected.filter((key) => !terms.some((t) => t.key === key && t.label && t.text));
  check(
    "the glossary defines every word the panel shows",
    missing.length === 0,
    missing.length ? `missing ${missing.join(", ")}` : `${terms.length} terms`,
  );

  const zh = readFileSync(`${REPO}/README.md`, "utf8");
  const en = readFileSync(`${REPO}/README.en.md`, "utf8");
  check(
    "both READMEs explain 上游 / 钉住 / openai-compatible-private",
    ["上游", "钉住", "openai-compatible-private"].every((word) => zh.includes(word)) &&
      ["upstream", "pinned", "openai-compatible-private"].every((word) => en.includes(word)),
  );
  check(
    "the panel renders the glossary",
    readFileSync(`${REPO}/renderer/index.html`, "utf8").includes('id="glossary-list"') &&
      readFileSync(`${REPO}/renderer/panel.js`, "utf8").includes("renderGlossary()"),
  );
}

/* ------------------------------------------------------- sync script targeting */

// The sync script rewrites both providers by id. Exercise its real functions so a
// manifest edit cannot silently point them at the wrong block.
{
  const syncSource = readFileSync(`${REPO}/scripts/sync-clinepass.mjs`, "utf8");
  const from = syncSource.indexOf("function closingDelimiter");
  const to = syncSource.indexOf("async function main");
  const { providerOf, replaceModelsSection } = new Function(
    `${syncSource.slice(from, to)}; return { providerOf, replaceModelsSection };`,
  )();
  const manifestText = readFileSync(`${REPO}/manifest.json`, "utf8");
  const observed = providerOf(manifestText, "clinepass");
  const escapeHatch = providerOf(manifestText, "clinepass-direct");
  check(
    "sync targets both providers by id",
    observed?.models.length === 15 && escapeHatch?.models.length === 15,
    `observed ${observed?.models.length}, direct ${escapeHatch?.models.length}`,
  );

  const narrowed = JSON.parse(replaceModelsSection(manifestText, "clinepass", observed.models.slice(0, 2)));
  const afterObserved = narrowed.contributes.providers.find((p) => p.id === "clinepass");
  const afterDirect = narrowed.contributes.providers.find((p) => p.id === "clinepass-direct");
  check(
    "sync rewrites only the named provider and keeps the rest",
    afterObserved.models.length === 2 &&
      afterDirect.models.length === 15 &&
      narrowed.contributes.views.length === 1 &&
      narrowed.permissions.length === 4,
    `observed ${afterObserved.models.length}, direct ${afterDirect.models.length}`,
  );
}

/* ----------------------------------------------------------------- teardown */

await mod.onUnload();
const closed = await fetch(`${BASE}/v1/models`).then(() => false).catch(() => true);
check("onUnload stops the loopback server", closed);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
  process.exitCode = 1;
}
