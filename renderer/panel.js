"use strict";

/**
 * ClinePass upstream observer — panel (draft + save).
 *
 * Ticking a box only mutates a local draft; nothing is written until 保存.
 * Saving writes the settings once and then asks the plugin to re-apply them
 * (fetch the catalog and republish the declaration), which is what makes the
 * model selection take effect in the picker after a restart.
 *
 * Read path: `plugin.getSettings` (host bridge channel) → the plugin's
 * `routingSnapshot` string. A panel cannot reach loopback, so this channel is
 * how routing results travel.
 * Write path: `writeSettings` / `applyModels` / `probeUpstream` → the plugin's
 * `onPanelInvoke`.
 */

const KNOWN_UPSTREAMS = [
  "deepseek", "fireworks", "baseten", "digitalocean", "pareto", "wafer", "runware",
  "alibaba", "vertex", "particle", "novita", "togetherai", "deepinfra", "parasail",
  "gmicloud", "modal", "morph", "runinfra", "tencent", "boundless", "inference-net",
  "relace", "token-pass",
];

const el = {
  status: document.getElementById("status"),
  pulse: document.getElementById("pulse"),
  refresh: document.getElementById("refresh"),
  save: document.getElementById("save"),
  inject: document.getElementById("inject"),
  abilities: document.getElementById("abilities"),
  toast: document.getElementById("toast"),
  dirty: document.getElementById("dirty"),
  hint: document.getElementById("hint"),
  upstreams: document.getElementById("upstreams"),
  models: document.getElementById("models"),
  modelsHint: document.getElementById("models-hint"),
  allOfficial: document.getElementById("all-official"),
  rows: document.getElementById("rows"),
  footLeft: document.getElementById("foot-left"),
  footRight: document.getElementById("foot-right"),
};

let current = {};
let draft = null;
let dirty = false;
let busy = false;
let probing = null;
let lastProbe = null;
let lastProbeRows = {};
/** One-shot message from an action; renderHints re-applies it after each refresh. */
let flash = null;

/* ---------------------------------------------------------- shared helpers */

// Bridge, settings, snapshot and formatters live in renderer/shared.js so the
// docked view and this panel cannot drift apart.
const {
  invoke,
  readSettings,
  splitList,
  snapshotOf,
  fmtCount,
  fmtCost,
  verdictClass,
  verdictTone,
  verdictLabel,
  TERMS,
  glossaryText,
} = window.ClinePassPanel;

/**
 * Every column says what it means: on hover from the header title, and spelled
 * out in the collapsible glossary under the table. Both read the same TERMS text.
 */
function renderGlossary() {
  const columns = {
    "th-landed": "landed",
    "th-pinned": "pinned",
    "th-fallbacks": "fallbacks",
    "th-cache": "cache",
    "th-cost": "cost",
    "th-verdict": "verdict",
  };
  for (const [id, key] of Object.entries(columns)) {
    const cell = document.getElementById(id);
    if (cell) cell.title = glossaryText(key);
  }
  const list = document.getElementById("glossary-list");
  if (!list) return;
  const frag = document.createDocumentFragment();
  for (const term of TERMS) {
    const dt = document.createElement("dt");
    dt.textContent = term.label;
    const dd = document.createElement("dd");
    dd.textContent = term.text;
    frag.append(dt, dd);
  }
  list.replaceChildren(frag);
}

function setStatus(text, mode) {
  el.status.textContent = text;
  el.pulse.className = "pulse" + (mode === "live" ? " live" : mode === "down" ? " down" : "");
}

function markDirty() {
  dirty = true;
  el.dirty.classList.add("on");
  el.save.disabled = false;
}

function clearDirty() {
  dirty = false;
  el.dirty.classList.remove("on");
  el.save.disabled = true;
}

function setStatus(text, mode) {
  el.status.textContent = text;
  el.pulse.className = "pulse" + (mode === "live" ? " live" : mode === "down" ? " down" : "");
}

function markDirty() {
  dirty = true;
  el.dirty.classList.add("on");
  el.save.disabled = false;
}

function clearDirty() {
  dirty = false;
  el.dirty.classList.remove("on");
  el.save.disabled = true;
}

/* ----------------------------------------------------------------- draft */

function availableModels(settings) {
  const snap = snapshotOf(settings);
  return (snap && snap.available) || [];
}

/** The list the sync script owns (declared on the direct provider). */
function officialModels(settings) {
  const snap = snapshotOf(settings);
  return (snap && Array.isArray(snap.official) && snap.official) || [];
}

/** 某个模型已探测到的候选 id：[{ id, upstream }] */
function probeOf(settings, id) {
  const snap = snapshotOf(settings) || {};
  const all = snap.probe || {};
  if (Array.isArray(all[id]) && all[id].length) return all[id];
  // 快照是防抖发布的，刚探测完可能还没落地，先用本地结果顶上
  return Array.isArray(lastProbeRows[id]) ? lastProbeRows[id] : [];
}

function parseThinking(raw) {
  try {
    const parsed = JSON.parse(String(raw || "") || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function makeDraft(settings) {
  const available = availableModels(settings);
  const chosen = splitList(settings.enabledModels);
  return {
    upstreams: new Set(splitList(settings.preferredUpstream)),
    models: new Set(chosen.length === 0 ? available : chosen),
    thinking: new Map(Object.entries(parseThinking(settings.modelThinking))),
    overrides: new Map(Object.entries(parseThinking(settings.modelIdOverride))),
    inject: Boolean(settings.injectRouting),
    abilities: String(settings.pinAbilities || ""),
    toast: settings.toastOnMismatch !== false,
  };
}

/* ---------------------------------------------------------------- render */

function detectedUpstreams(settings) {
  const snap = snapshotOf(settings);
  const counts = new Map();
  const bump = (name, kind) => {
    if (!name) return;
    const row = counts.get(name) || { name, final: 0, pinned: 0, fallback: 0 };
    row[kind] += 1;
    counts.set(name, row);
  };
  for (const entry of Object.values((snap && snap.models) || {})) {
    bump(entry.finalProvider, "final");
    bump(entry.pinnedProvider, "pinned");
    for (const name of entry.fallbacks || []) bump(name, "fallback");
  }
  return [...counts.values()].sort(
    (a, b) => b.final - a.final || b.pinned - a.pinned || b.fallback - a.fallback,
  );
}

function checkRow(checked, labelText, metaText, onChange) {
  const label = document.createElement("label");
  label.className = "model" + (checked ? " on" : "");
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  box.addEventListener("change", () => onChange(box.checked));
  const text = document.createElement("span");
  text.textContent = labelText;
  label.append(box, text);
  if (metaText) {
    const meta = document.createElement("em");
    meta.className = "meta";
    meta.textContent = metaText;
    label.appendChild(meta);
  }
  return label;
}

function renderUpstreams(settings) {
  const detected = detectedUpstreams(settings);
  const names = [];
  const seen = new Set();
  for (const d of detected) {
    if (!seen.has(d.name)) { seen.add(d.name); names.push(d.name); }
  }
  for (const n of KNOWN_UPSTREAMS) {
    if (!seen.has(n)) { seen.add(n); names.push(n); }
  }
  const meta = new Map(detected.map((d) => [d.name, `${d.final}/${d.pinned}/${d.fallback}`]));

  const frag = document.createDocumentFragment();
  for (const name of names) {
    frag.appendChild(
      checkRow(draft.upstreams.has(name), name, meta.get(name) || "0/0/0", (checked) => {
        if (checked) draft.upstreams.add(name);
        else draft.upstreams.delete(name);
        markDirty();
        renderUpstreams(settings);
      }),
    );
  }
  el.upstreams.replaceChildren(frag);
}

function renderModels(settings) {
  const available = availableModels(settings);
  const official = officialModels(settings);
  el.allOfficial.disabled = official.length === 0;
  if (available.length === 0) {
    el.models.replaceChildren();
    el.modelsHint.textContent = "还没有模型目录：插件载入后会自己拉取（失败则用内置的官方声明）。";
    return;
  }
  const checkedCount = available.filter((id) => draft.models.has(id)).length;
  const effCount = checkedCount === 0 ? available.length : checkedCount;
  const scope =
    checkedCount === available.length || checkedCount === 0
      ? "全部启用"
      : `已选 ${checkedCount} 个（未勾选的请求被拒绝）`;
  el.modelsHint.textContent =
    `共 ${available.length} 个（官方 ${official.length} 个），${scope} · 重启 PI 后这个服务商的模型下拉框 = ${effCount} 个 · 右侧可设思考强度与锚定上游`;
  const cat = (snapshotOf(settings) || {}).catalog;
  if (cat && cat.ok === false) {
    const why =
      cat.note === "no-api-key"
        ? "还没有拿到 key（发一条消息后会自动带上宿主的 key 再拉）"
        : cat.note === "network"
          ? "网络失败"
          : String(cat.note || "未知原因");
    el.modelsHint.textContent += ` · 目录未刷新（${why}），当前显示已知模型`;
  }

  const meta = (snapshotOf(settings) || {}).modelMeta || {};
  const frag = document.createDocumentFragment();
  for (const id of available) {
    const row = document.createElement("div");
    row.className = "model-row";
    row.appendChild(
      checkRow(draft.models.has(id), id, "", (checked) => {
        if (checked) draft.models.add(id);
        else draft.models.delete(id);
        markDirty();
        renderModels(settings);
      }),
    );
    const info = meta[id];
    if (info && Array.isArray(info.levels) && info.levels.length > 1) {
      const pick = document.createElement("select");
      pick.className = "think";
      pick.title = "默认思考强度（保存后重启 PI 生效）";
      for (const level of info.levels) {
        const opt = document.createElement("option");
        opt.value = level;
        opt.textContent = level;
        pick.appendChild(opt);
      }
      pick.value = draft.thinking.get(id) || info.default;
      pick.addEventListener("change", () => {
        draft.thinking.set(id, pick.value);
        markDirty();
      });
      row.appendChild(pick);
    }
    const probeRows = probeOf(settings, id);
    const override = document.createElement("select");
    override.className = "think route";
    override.title = "锚定上游：选一个会落到目标上游的模型 id（默认原样转发）";
    const keep = document.createElement("option");
    keep.value = "";
    keep.textContent = "原样转发";
    override.appendChild(keep);
    for (const probeRow of probeRows) {
      const opt = document.createElement("option");
      opt.value = probeRow.id;
      const usable = Boolean(probeRow.upstream) && probeRow.status === 200;
      opt.textContent = usable
        ? `${probeRow.upstream} ← ${probeRow.id}（备选 ${(probeRow.fallbacks || []).length}）`
        : `${probeRow.id}（探测失败，不可选）`;
      // 探测失败的候选置灰：选了也只会 500，避免误选
      if (!usable) opt.disabled = true;
      override.appendChild(opt);
    }
    override.value = draft.overrides.get(id) || "";
    override.addEventListener("change", () => {
      if (override.value) draft.overrides.set(id, override.value);
      else draft.overrides.delete(id);
      markDirty();
    });
    row.appendChild(override);

    const probe = document.createElement("button");
    probe.type = "button";
    probe.className = "ghost tiny";
    probe.textContent = probing === id ? "探测中…" : "探测";
    probe.disabled = probing !== null;
    probe.title = "用最小请求问一次上游：这个模型有哪些 id、各落在哪家（会产生少量真实调用）";
    probe.addEventListener("click", async () => {
      probing = id;
      renderModels(settings);
      try {
        const res = await invoke("probeUpstream", { model: id });
        if (res && Array.isArray(res.rows)) {
          let text;
          if (res.rows.length <= 1) {
            const only = res.rows[0] || {};
            const n = (only.fallbacks || []).length;
            text =
              `已探测 ${id}：上游目录里没有同族的替代 id，只能原样转发` +
              `（当前落点 ${only.upstream || "未知"}${n ? `，另有 ${n} 家备选` : ""}）。`;
          } else {
            const union = new Map();
            for (const probeRow of res.rows) {
              if (probeRow.upstream) union.set(probeRow.upstream, "primary");
              for (const name of probeRow.fallbacks || []) if (!union.has(name)) union.set(name, "fallback");
            }
            const primaryRows = res.rows.filter((r) => r.upstream);
            const fallbackOnly = [...union.entries()]
              .filter(([, kind]) => kind === "fallback")
              .map(([name]) => name);
            text =
              `已探测 ${id} · 可达上游共 ${union.size} 家\n` +
              `可锚定（${primaryRows.length}）：\n` +
              (primaryRows.length
                ? primaryRows
                    .map((r) => `  ${r.upstream} ← ${r.id}（备选 ${(r.fallbacks || []).length} 家）`)
                    .join("\n")
                : "  无") +
              (fallbackOnly.length ? `\n仅备选（${fallbackOnly.length}）：${fallbackOnly.join("、")}` : "");
          }
          lastProbeRows[id] = res.rows;
          lastProbe = text;
          el.hint.className = "hint";
          el.hint.textContent = text;
          renderModels(current || {});
        }
      } catch (error) {
        flash = error && error.message ? error.message : String(error);
      } finally {
        probing = null;
        await refresh(true);
      }
    });
    row.appendChild(probe);

    const channels = document.createElement("button");
    channels.type = "button";
    channels.className = "ghost tiny";
    channels.textContent = probing === id ? "…" : "候选";
    channels.disabled = probing !== null;
    channels.title =
      "免费列出这个模型能落到哪些上游：发一个指定不存在上游的请求，网关会在报错里把清单吐回来，不产生 token";
    channels.addEventListener("click", async () => {
      probing = id;
      renderModels(settings);
      try {
        const res = await invoke("probeProviders", { model: id });
        const list = res && Array.isArray(res.providers) ? res.providers : [];
        const wanted = (res && res.wanted) || [];
        let text;
        if (list.length === 0) {
          text =
            `候选上游：网关没给出清单（HTTP ${(res && res.status) || 0}）。原始回复：` +
            String((res && res.message) || "").slice(0, 300);
        } else {
          const missing = wanted.filter((p) => list.indexOf(p) === -1);
          text =
            `${id} 的候选上游 ${list.length} 家：${list.join("、")}` +
            (wanted.length === 0
              ? ""
              : missing.length
                ? `\n注意：你要钉的 ${missing.join("、")} 不在清单里 —— 这个账号钉不住。`
                : `\n你要钉的 ${wanted.join("、")} 在清单里。`);
        }
        lastProbe = text;
        el.hint.className = "hint";
        el.hint.textContent = text;
      } catch (error) {
        flash = error && error.message ? error.message : String(error);
      } finally {
        probing = null;
        await refresh(true);
      }
    });
    row.appendChild(channels);
    frag.appendChild(row);
  }
  el.models.replaceChildren(frag);
}

/** Same layout as the view's timestamps; one implementation, in shared.js. */
const fmtTime = window.ClinePassPanel.fmtStamp;

/** 逐条请求日志：一条请求一行，按时间倒序。 */
function renderTable(settings) {
  const snap = snapshotOf(settings) || {};
  const items = Array.isArray(snap.log) ? snap.log : [];
  const td = (text, cls) => {
    const c = document.createElement("td");
    if (cls) c.className = cls;
    c.textContent = text === null || text === undefined || text === "" ? "—" : String(text);
    return c;
  };
  if (items.length === 0) {
    const tr = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "empty";
    cell.textContent =
      "还没有请求记录：用 ClinePass 的任意 cline-pass/* 模型发一条消息，这里会按请求逐条记下来。";
    tr.appendChild(cell);
    el.rows.replaceChildren(tr);
    return;
  }
  const frag = document.createDocumentFragment();
  for (const e of items) {
    const tr = document.createElement("tr");
    tr.appendChild(td(fmtTime(e.at), "time"));
    const modelCell = td(e.model, "model");
    if (e.sentModel) {
      const sub = document.createElement("span");
      sub.className = "sent";
      sub.textContent = `→ ${e.sentModel}`;
      modelCell.appendChild(sub);
    }
    tr.appendChild(modelCell);

    const final = td("");
    const span = document.createElement("span");
    span.className = "provider " + verdictClass(e);
    span.textContent = e.finalProvider || "—";
    final.appendChild(span);
    tr.appendChild(final);

    tr.appendChild(td(e.pinnedProvider));
    tr.appendChild(td(fmtCount(e.fallbackCount), "num"));
    const cacheCell = td(fmtCount(e.cacheHitTokens), "num");
    if (e.cacheAligned === true) {
      const mark = document.createElement("em");
      mark.className = "dim small";
      mark.textContent = " ·64";
      mark.title = glossaryText("fingerprint");
      cacheCell.appendChild(mark);
    }
    tr.appendChild(cacheCell);
    tr.appendChild(td(fmtCost(e.cost), "num"));

    const verdict = td("");
    const badge = document.createElement("span");
    if (e.injected) badge.className = "badge " + verdictTone(e);
    else badge.className = "badge idle";
    badge.textContent = verdictLabel(e);
    verdict.appendChild(badge);
    tr.appendChild(verdict);
    frag.appendChild(tr);
  }
  el.rows.replaceChildren(frag);
}

function renderHints(settings) {
  const snap = snapshotOf(settings) || {};
  const keySource = snap.keySource || (settings.apiKey || settings.apiKeyEnc ? "plugin" : "none");
  const targets = splitList(settings.preferredUpstream);
  const hasRecords = Object.keys(snap.models || {}).length > 0 || (snap.log || []).length > 0;

  if (!hasRecords && keySource === "none") {
    // Nothing has passed through yet and no key has been seen. The host holds the
    // key and a plugin cannot read it, so do not claim it is missing — say what to
    // do instead.
    el.hint.className = "hint";
    el.hint.textContent =
      "怎么开始：\n" +
      "1. 直接用 ClinePass 的任意模型发一条消息 —— 现在所有 ClinePass 请求都会经过这里，发完就会出现在下面的表里。\n" +
      "2. 如果发消息时报「没有 API Key」：设置 → Providers → ClinePass 填好 key（这一行就是本插件的入口）。\n" +
      "3. 想临时绕开插件：把模型切到 ClinePass Direct（直连 api.cline.bot，不经过记录）。";
  } else if (settings.injectRouting) {
    const has = splitList(settings.pinAbilities);
    const parts = [
      targets.length ? `only=[${targets.join(",")}]` : "only 未设（不限制上游）",
      has.length ? `has=[${has.join(",")}]` : "has 未设",
    ];
    el.hint.className = has.length ? "hint" : "hint warn";
    el.hint.textContent =
      `已开启钉住：请求体顶层写入 providerOptions.gateway 的 ${parts.join(" ")}。` +
      (has.length
        ? "看下表「实际落点」有没有变成目标上游：没变 = 网关没采纳，或这个账号本来只有一条上游。"
        : "只写 only 在多数账号上不生效，把「能力过滤 has」填上（例如 vision,implicit-caching）才稳。") +
      " 想先确认这个模型有几条上游可选，点模型行末的「候选」。";
  } else if (targets.length) {
    el.hint.className = "hint";
    el.hint.textContent = `已记下目标「${targets.join(" / ")}」，当前只观察，不改写请求。`;
  } else {
    el.hint.className = "hint";
    el.hint.textContent =
      "本插件负责观察：每个请求落在哪个上游、还有多少备选、花了多少钱。ClinePass Direct 那一条是直连，不经过这里，所以不会被记录。";
  }

  if (keySource === "host") {
    el.hint.textContent += "\nKey 来源：宿主为 ClinePass 这一行发送的 Authorization 头（插件不落盘）。";
  } else if (keySource === "plugin") {
    el.hint.textContent += snap.keySealed
      ? "\nKey 来源：插件设置（Windows DPAPI 加密存放）。"
      : "\nKey 来源：插件设置（明文保存：本机没有 DPAPI 或加密失败，日志与快照不含 key）。";
  }
  if (snap.endpoint) el.hint.textContent += `\n观察端点：${snap.endpoint}`;

  // 探测结果要能留住：refresh() 会走 renderHints()，否则刚显示就被通用提示覆盖
  if (lastProbe) {
    el.hint.className = "hint";
    el.hint.textContent += "\n" + lastProbe;
  }
  // Action feedback must survive refresh(): renderHints rebuilds this hint from
  // scratch, so a one-shot message written straight into el.hint is lost.
  if (flash) {
    el.hint.className = "hint warn";
    el.hint.textContent += (el.hint.textContent ? "\n" : "") + flash;
  }
}

function render() {
  const settings = current || {};
  const snap = snapshotOf(settings);
  renderUpstreams(settings);
  renderModels(settings);
  renderTable(settings);
  renderHints(settings);

  el.inject.checked = draft.inject;
  // A refresh must not clobber what the user is typing.
  if (document.activeElement !== el.abilities) el.abilities.value = draft.abilities;
  el.toast.checked = draft.toast;

  const rows = Object.keys((snap && snap.models) || {}).length;
  el.footLeft.textContent = rows === 0 ? "尚无请求记录" : `已记录 ${rows} 个模型`;
  el.footRight.textContent = snap && snap.at
    ? "最近更新 " + new Date(snap.at).toLocaleTimeString()
    : "等待第一次请求";
}

/* ------------------------------------------------------------------- ops */

function fail(error) {
  setStatus("失败", "down");
  el.hint.className = "hint warn";
  el.hint.textContent = error && error.message ? error.message : String(error);
}

async function refresh(keepDraft) {
  try {
    const next = await readSettings();
    const first = !current || !current.routingSnapshot;
    const availableChanged =
      JSON.stringify(availableModels(next)) !== JSON.stringify(availableModels(current));
    current = next;
    if (!draft || first || (availableChanged && !dirty)) draft = makeDraft(current);
    if (!keepDraft && !dirty) draft = makeDraft(current);
    render();
    setStatus("已连接", "live");
  } catch (error) {
    setStatus("读取失败", "down");
    fail(error);
  }
}

async function save() {
  if (busy) return;
  busy = true;
  el.save.disabled = true;
  try {
    const available = availableModels(current);
    const all = available.length > 0 && available.every((id) => draft.models.has(id));
    const patch = {
      preferredUpstream: [...draft.upstreams].join(","),
      enabledModels: all ? "" : [...draft.models].join(","),
      injectRouting: draft.inject,
      pinAbilities: draft.abilities.trim(),
      toastOnMismatch: draft.toast,
      modelThinking: JSON.stringify(Object.fromEntries(draft.thinking)),
      modelIdOverride: JSON.stringify(Object.fromEntries(draft.overrides)),
    };
    const res = await invoke("writeSettings", patch);
    if (res && res.settings) current = res.settings;
    clearDirty();
    setStatus("已保存，正在应用…", "live");
    const applied = await invoke("applyModels");
    setStatus("已应用", "live");
    if (applied && typeof applied.applied === "number") {
      flash =
        `已保存：ClinePass 这个服务商的清单改为 ${applied.applied} 个（可选 ${applied.available} 个）。` +
        "PI 的模型下拉框要重启 PI 后才会跟着变；ClinePass Direct 不受影响。";
    }
    await refresh(true);
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
    el.save.disabled = !dirty;
  }
}

/* ------------------------------------------------------------------ boot */

function bindDraftSwitch(node, key) {
  node.addEventListener("change", () => {
    draft[key] = node.checked;
    markDirty();
  });
}

el.refresh.addEventListener("click", () => refresh(false));
el.save.addEventListener("click", save);
el.allOfficial.addEventListener("click", () => {
  const official = officialModels(current);
  if (official.length === 0) return;
  for (const id of official) draft.models.add(id);
  markDirty();
  renderModels(current || {});
});
bindDraftSwitch(el.inject, "inject");
el.abilities.addEventListener("input", () => {
  draft.abilities = el.abilities.value;
  markDirty();
});
bindDraftSwitch(el.toast, "toast");

(async function boot() {
  renderGlossary();
  await refresh(false);
  setInterval(() => { if (!dirty) refresh(true); }, 4000);
})();
