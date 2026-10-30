"use strict";

/**
 * Shared panel helpers — loaded by both renderer pages before their own script.
 *
 * `renderer/panel.js` (the full window panel) and `renderer/view.js` (the docked
 * status view) read the same snapshot and talk over the same bridge; keeping one
 * copy of that plumbing means a snapshot-format change is a one-file edit, not a
 * two-file edit that silently half-lands.
 *
 * Classic script on purpose: these pages are sandboxed `file://` documents, where
 * ES modules are blocked by CORS.
 */
(function attachSharedPanelHelpers(global) {
  /** The host bridge injected into every plugin panel/view. */
  function bridge() {
    return global.pluginBridge || null;
  }

  async function invoke(channel, payload) {
    const b = bridge();
    if (!b || typeof b.invoke !== "function") throw new Error("pluginBridge.invoke 不可用");
    return b.invoke(channel, payload);
  }

  /** The plugin's settings, including the published `routingSnapshot` string. */
  async function readSettings() {
    const raw = await invoke("plugin.getSettings");
    const s = (raw && typeof raw === "object" && (raw.settings || raw.value)) || raw;
    return s && typeof s === "object" ? s : {};
  }

  function splitList(value) {
    return String(value || "")
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /** The snapshot the plugin publishes through settings, or null. */
  function snapshotOf(settings) {
    const raw = settings && settings.routingSnapshot;
    if (!raw || typeof raw !== "string") return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function fmtCount(v) {
    return v === null || v === undefined ? "—" : String(v);
  }

  function fmtCost(v) {
    if (!v) return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (n === 0) return "$0";
    return "$" + (n < 0.01 ? n.toFixed(5) : n.toFixed(4));
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  /** HH:MM:SS */
  function fmtClock(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  }

  /** MM-DD HH:MM:SS */
  function fmtStamp(ms) {
    if (!ms) return "—";
    const d = new Date(ms);
    return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${fmtClock(ms)}`;
  }

  /** Label for the landed upstream: matched / mismatched / not compared. */
  function verdictClass(entry) {
    const matched = entry && entry.matched;
    return matched === true ? "hit" : matched === false ? "miss" : "";
  }

  /** Badge tone for the same comparison: ok / bad / idle. */
  function verdictTone(entry) {
    const matched = entry && entry.matched;
    return matched === true ? "ok" : matched === false ? "bad" : "idle";
  }

  global.ClinePassPanel = {
    bridge,
    invoke,
    readSettings,
    splitList,
    snapshotOf,
    fmtCount,
    fmtCost,
    fmtClock,
    fmtStamp,
    verdictClass,
    verdictTone,
  };
})(typeof window === "undefined" ? globalThis : window);
