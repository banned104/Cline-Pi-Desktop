"use strict";

/**
 * ClinePass status view — the same snapshot the full panel reads, laid out as a
 * narrow column for the host's work panel.
 *
 * Read path: `pluginBridge.invoke("plugin.getSettings")` → the plugin's
 * `routingSnapshot` string (a view, like a panel, cannot reach loopback).
 * Buttons go back through the plugin's `onPanelInvoke`: `openFullPanel`,
 * `clearLog`.
 */

const el = {
  status: document.getElementById("status"),
  pulse: document.getElementById("pulse"),
  refresh: document.getElementById("refresh"),
  facts: document.getElementById("facts"),
  last: document.getElementById("last"),
  log: document.getElementById("log"),
  logCount: document.getElementById("log-count"),
  hint: document.getElementById("hint"),
  open: document.getElementById("open"),
  clear: document.getElementById("clear"),
  footNote: document.getElementById("foot-note"),
};

let current = {};
let busy = false;

const POLL_MS = 3000;
const LOG_ROWS = 20;

const {
  invoke,
  readSettings,
  snapshotOf,
  splitList,
  fmtClock,
  fmtStamp,
  fmtCount,
  fmtCost,
  verdictClass,
  verdictTone,
  glossaryText,
} = window.ClinePassPanel;

/** One-shot message from a button action; renderHints re-applies it each render. */
let flash = null;

function shortModel(id) {
  return String(id || "—").replace(/^cline-pass\//, "");
}

function setStatus(text, mode) {
  el.status.textContent = text;
  el.pulse.className = "pulse" + (mode === "live" ? " live" : mode === "down" ? " down" : "");
}

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined && text !== null) n.textContent = String(text);
  return n;
}

/** Append one `<dt>/<dd>` pair to a facts fragment. */
function pushFact(frag, term, value) {
  const dt = node("dt", null, term);
  const dd = node("dd");
  if (typeof value === "string") dd.textContent = value;
  else dd.appendChild(value);
  frag.append(dt, dd);
}

function statusDot(ok, label) {
  const wrap = node("span");
  wrap.appendChild(node("span", "dot " + (ok ? "ok" : "bad")));
  wrap.appendChild(document.createTextNode(label));
  return wrap;
}

/* ----------------------------------------------------------------- render */

function renderFacts(settings, snap) {
  const enabled = settings.enabled !== false;
  const available = (snap && snap.available) || [];
  const official = (snap && snap.official) || [];
  const chosen = splitList(settings.enabledModels);
  const keySource = (snap && snap.keySource) || (settings.apiKey || settings.apiKeyEnc ? "plugin" : "none");
  const targets = splitList(settings.preferredUpstream);
  const cat = (snap && snap.catalog) || null;

  const frag = document.createDocumentFragment();

  pushFact(
    frag,
    "观察端点",
    statusDot(Boolean(snap && snap.listening), (snap && snap.endpoint) || "http://127.0.0.1:41892/v1"),
  );
  if (!enabled) pushFact(frag, "开关", "已停用（转发会返回 503）");

  const keyText =
    keySource === "host"
      ? "宿主为该服务商行签名的 Authorization 头"
      : keySource === "plugin"
        ? `插件设置（${snap && snap.keySealed ? "DPAPI 加密" : "明文"}）`
        : "未配置";
  pushFact(frag, "Key 来源", keyText);

  const modelText =
    available.length === 0
      ? "还没有目录"
      : chosen.length === 0
        ? `全部启用（${available.length} 个，官方 ${official.length} 个）`
        : `已选 ${chosen.length} / 可选 ${available.length}（官方 ${official.length}）`;
  pushFact(frag, "模型", modelText);

  const catText = cat
    ? cat.ok
      ? `${cat.count} 个 · ${fmtClock(cat.at)}`
      : `${cat.note || "未刷新"} · ${fmtClock(cat.at)}`
    : "尚未拉取";
  pushFact(frag, "目录", catText);

  const targetText = targets.length
    ? `${targets.join(" / ")}${settings.injectRouting ? " · 写入 routing 已开" : " · 只观察"}`
    : "未指定（只观察）";
  pushFact(frag, "目标上游", targetText);

  if (snap && snap.lastError) pushFact(frag, "最近错误", node("span", null, String(snap.lastError)));

  el.facts.replaceChildren(frag);
}

function verdictBadge(entry) {
  const badge = node("span", "badge ");
  if (entry.injected) {
    badge.classList.add(verdictTone(entry));
    badge.textContent =
      entry.matched === true ? "落点一致" : entry.matched === false ? "网关忽略" : "无元数据";
  } else {
    badge.classList.add("idle");
    badge.textContent = "仅观察";
  }
  return badge;
}

/** A metric tile; `term` names a TERMS entry so the label explains itself on hover. */
function metric(label, value, className, term) {
  const box = node("div", "metric");
  const b = node("b", className || null, value);
  box.append(b, node("span", null, label));
  if (term) box.title = glossaryText(term);
  return box;
}

function renderLast(snap) {
  // Keep the map key: it is the model id, and an entry that somehow lacks one
  // must still render a name instead of a blank line.
  const models = Object.entries((snap && snap.models) || {}).map(([id, entry]) => ({ id, entry }));
  if (models.length === 0) {
    el.last.replaceChildren(
      node(
        "div",
        "empty",
        "还没有请求记录：用 ClinePass 的任意模型发一条消息。",
      ),
    );
    return;
  }
  const latest = models.reduce((a, b) => ((a.entry.at || 0) >= (b.entry.at || 0) ? a : b));
  const entry = latest.entry;

  const frag = document.createDocumentFragment();
  const top = node("div", "last-top");
  const left = node("div");
  const modelLine = node("div", "last-model", entry.model || latest.id);
  if (entry.sentModel) modelLine.appendChild(node("span", "sent", `→ ${entry.sentModel}`));
  left.append(modelLine, verdictBadge(entry));
  top.append(left, node("div", "last-time", fmtStamp(entry.at)));
  frag.appendChild(top);

  const grid = node("div", "grid2");
  const landed = node("div", "metric");
  landed.title = glossaryText("landed");
  const landedValue = node("b");
  const provider = node("span", "provider " + verdictClass(entry));
  provider.textContent = entry.finalProvider || "—";
  landedValue.appendChild(provider);
  landed.append(landedValue, node("span", null, "实际落点"));
  grid.append(
    landed,
    metric("钉住", entry.pinnedProvider || "—", null, "pinned"),
    metric("备选", fmtCount(entry.fallbackCount), null, "fallbacks"),
    metric("缓存命中", fmtCount(entry.cacheHitTokens), null, "cache"),
    metric("成本", fmtCost(entry.cost), null, "cost"),
    metric("次数", fmtCount(entry.requests), null, "count"),
  );
  frag.appendChild(grid);
  el.last.replaceChildren(frag);
}

function renderLog(snap) {
  const items = ((snap && snap.log) || []).slice(0, LOG_ROWS);
  el.logCount.textContent = items.length ? `最近 ${items.length} 条` : "";
  if (items.length === 0) {
    el.log.replaceChildren();
    return;
  }
  const frag = document.createDocumentFragment();
  for (const e of items) {
    const row = node("div", "row");
    row.appendChild(node("span", "t", fmtClock(e.at)));
    const middle = node("span", "m");
    middle.appendChild(document.createTextNode(shortModel(e.model)));
    const provider = node("span", "p");
    const chip = node("span", "provider " + verdictClass(e));
    chip.textContent = e.finalProvider || "—";
    provider.appendChild(chip);
    middle.appendChild(provider);
    row.appendChild(middle);
    const right = node("span", "r");
    const parts = [];
    if (e.fallbackCount) parts.push(`备选 ${e.fallbackCount}`);
    if (e.cacheHitTokens) parts.push(`缓存 ${e.cacheHitTokens}`);
    if (e.cost) parts.push(fmtCost(e.cost));
    right.textContent = parts.length ? parts.join(" · ") : "—";
    row.appendChild(right);
    frag.appendChild(row);
  }
  el.log.replaceChildren(frag);
}

function renderHints(settings, snap) {
  const keySource = (snap && snap.keySource) || (settings.apiKey || settings.apiKeyEnc ? "plugin" : "none");
  const lines = [];
  if (!snap) {
    lines.push("插件还没有发布快照：重启 PI 后再看，或先发一条消息。");
  }
  const hasRecords = Boolean(snap && (Object.keys(snap.models || {}).length || (snap.log || []).length));
  // Never claim the key is missing: the host holds it and a plugin cannot read it.
  if (!hasRecords && keySource === "none") {
    lines.push("还没有请求经过这里：用 ClinePass 的任意模型发一条消息，落点就会出现在上面。");
    lines.push("如果发消息时报「没有 API Key」：设置 → Providers → ClinePass 填好 key。");
  }
  if (snap && snap.listening === false) {
    lines.push("回环端点没有在跑：看插件日志（端口 41892 可能被占用）。要临时绕开，把模型切到 ClinePass Direct。");
  }
  if (snap && Array.isArray(snap.declared) && snap.declared.length === 0) {
    lines.push("ClinePass 这一行还没有模型：在完整面板里保存一次。");
  }
  el.hint.className = lines.length ? "hint warn" : "hint";
  // A message from an action (clear failed, …) must survive the 3 s poll, which
  // rebuilds this hint from scratch on every refresh.
  if (flash) {
    lines.push(flash);
    el.hint.className = "hint warn";
  }
  el.hint.textContent = lines.join("\n");
}

function render() {
  const settings = current || {};
  const snap = snapshotOf(settings);
  renderFacts(settings, snap);
  renderLast(snap);
  renderLog(snap);
  renderHints(settings, snap);
  el.footNote.textContent = snap && snap.at ? "更新 " + fmtClock(snap.at) : "等待第一次请求";
}

/* ------------------------------------------------------------------- ops */

async function refresh() {
  try {
    current = await readSettings();
    render();
    setStatus("已连接", "live");
  } catch (error) {
    setStatus("读取失败", "down");
    el.hint.className = "hint warn";
    el.hint.textContent = error && error.message ? error.message : String(error);
  }
}

async function withBusy(button, label, work) {
  if (busy) return;
  busy = true;
  const original = button.textContent;
  button.disabled = true;
  button.textContent = label;
  flash = null;
  try {
    await work();
  } catch (error) {
    flash = error && error.message ? error.message : String(error);
  } finally {
    busy = false;
    button.disabled = false;
    button.textContent = original;
  }
}

el.refresh.addEventListener("click", () => refresh());
el.open.addEventListener("click", () =>
  withBusy(el.open, "打开中…", async () => {
    await invoke("openFullPanel");
  }),
);
el.clear.addEventListener("click", () =>
  withBusy(el.clear, "清空中…", async () => {
    await invoke("clearLog");
    await refresh();
  }),
);

/* ------------------------------------------------------------------ boot */

(async function boot() {
  await refresh();
  setInterval(() => {
    if (!busy) refresh();
  }, POLL_MS);
})();
