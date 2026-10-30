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

  /**
   * Plain-language explanations of every word the panel shows. The panel renders
   * this as a collapsible glossary and the column headers carry it as tooltips, so
   * the two cannot say different things.
   */
  const TERMS = [
    {
      key: "upstream",
      label: "上游",
      text:
        "真正跑模型的那台机器 / 那家公司。ClinePass 只是一个入口：同一个 cline-pass/kimi-k3 背后挂着二十多家（deepseek、fireworks、baseten…），你每次请求由 Cline 指派给其中一家去算。",
    },
    {
      key: "landed",
      label: "实际落点",
      text:
        "这一次请求最后是哪家算的。网关自己在响应里报的 finalProvider，不是猜的。",
    },
    {
      key: "pinned",
      label: "钉住",
      text:
        "网关给你这个会话钉住的那家。一般和实际落点一致；不一致说明中途降级了，或者钉住的那家没接。",
    },
    {
      key: "fallbacks",
      label: "备选",
      text:
        "除了落点之外，这个模型还能落到几家的数量（网关报的 fallbacksAvailable）。0 = 没有退路，这家出问题这次就失败；大于 0 = 还能降级到别家。",
    },
    {
      key: "cache",
      label: "缓存命中",
      text:
        "这次有多少输入 token 直接命中了对方的 prompt 缓存、没有重新计算（promptCacheHitTokens）。越大越省钱省时。显示 — 表示这条通道不报这个数。",
    },
    {
      key: "cost",
      label: "成本",
      text:
        "这一次的开销。优先取市场价 marketCost，其次实际推理成本 inferenceCost，最后才用 cost —— 走 Cline 私有通道时 cost 恒为 0，只看它会永远显示 $0。",
    },
    {
      key: "verdict",
      label: "校验",
      text:
        "仅观察 = 你没指定目标上游，没得比；落点一致 = 指定了目标且落在它上面；网关忽略 = 指定了目标却落在别家（实测 Cline 网关不认这个字段，属预期）；无元数据 = 响应里没有 routing 块，判断不了。",
    },
    {
      key: "anchor",
      label: "改写模型 id（锚定）",
      text:
        "落点其实是 (key, 模型 id) 的函数：同一个 id 永远落在同一家。所以想换家只能把 id 换成同族、但落在目标上游的那个（面板每行右侧的下拉，旁边「探测」先试给你看）。代价：可能换到同族的另一个版本或量化。",
    },
    {
      key: "count",
      label: "次数",
      text: "这个模型累计发出过多少次请求（本插件记的，重启后仍保留）。",
    },
    {
      key: "names",
      label: "这些名字是什么",
      text:
        "deepseek / fireworks / baseten / alibaba / novita / gmicloud / togetherai… 都是第三方推理服务商（租算力跑开源模型的平台）。openai-compatible-private 是网关自己的一条私有通道，不是公开厂商 —— 闻到它的特征通常是「成本 $0、备选 0」。",
    },
  ];

  function glossaryText(key) {
    const term = TERMS.find((entry) => entry.key === key);
    return term ? term.text : "";
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
    TERMS,
    glossaryText,
  };
})(typeof window === "undefined" ? globalThis : window);
