#!/usr/bin/env node
/**
 * Sync the ClinePass model list in `manifest.json` with Cline's own catalog.
 *
 *   node scripts/sync-clinepass.mjs            # update manifest.json
 *   node scripts/sync-clinepass.mjs --check    # report drift, change nothing
 *
 * Why a script and not runtime discovery
 * --------------------------------------
 * PI-Desktop can only discover a plugin provider's models through the standard
 * `GET {baseUrl}/models` listing, and Cline answers that one with upstream ids
 * (`openai/gpt-6.1-sol`, `moonshotai/kimi-k3.1-pro`, …) — not a single
 * `cline-pass/*` slug. Declaring an empty model list would therefore leave the
 * plugin with no selectable model at all. The authoritative list lives behind
 * Cline's own `recommended-models` endpoint instead, and a plugin cannot write
 * provider rows at runtime, so the list is synced here and shipped in the
 * manifest.
 *
 * Sources, in priority order
 * --------------------------
 * 1. `catalog.generated.ts` in cline/cline — the payload Cline ships to its own
 *    clients. Carries the full detail this manifest needs: context window,
 *    output ceiling, image capability and the reasoning ladder.
 * 2. `GET /api/v1/ai/cline/recommended-models` — Cline's live list, fetched
 *    anonymously. Carries ids and names only, so it is used to cross-check the
 *    snapshot and to name models the snapshot names badly (some entries repeat
 *    their raw slug as the display name).
 *
 * A retired model disappears from both. A model that is in one and not the
 * other is reported, never silently dropped.
 */

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

 const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
 const MANIFEST_PATH = join(REPO_ROOT, "manifest.json");
 
/**
 * Provider ids in `manifest.json` to keep in sync. Both declare the same list;
 * `clinepass` is the observed row (loopback) and `clinepass-direct` the escape
 * hatch. Never anchor on position — the sync writes both by id.
 */
const OBSERVED_PROVIDER_ID = "clinepass";
const DIRECT_PROVIDER_ID = "clinepass-direct";
const PROVIDER_IDS = [OBSERVED_PROVIDER_ID, DIRECT_PROVIDER_ID];
 
 /** Only these model ids belong to the subscription this provider bills against. */
 const CLINE_PASS_PREFIX = "cline-pass/";
 
 /**
  * Two ways to read Cline's catalog, both over the GitHub API host because
  * `raw.githubusercontent.com` does not resolve on every network:
  *
  *   1. contents API — resolves the file's blob sha, and returns small files whole;
  *   2. git blobs API — returns the base64 body of that blob. Required here
  *      because the contents API omits `content` for a file above ~1 MB, and
  *      this one is ~4.4 MB.
  */
 const CATALOG_CONTENTS_URL =
   "https://api.github.com/repos/cline/cline/contents/sdk/packages/llms/src/catalog/catalog.generated.ts";
 const CATALOG_BLOB_URL = "https://api.github.com/repos/cline/cline/git/blobs/";
 const RECOMMENDED_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";
 
 /**
  * Cline's reasoning ladders starting with `none` describe an explicit "no
  * reasoning" choice. PI-Desktop models `off` as *sending nothing*, so `none` is
  * dropped instead of being mapped onto a level that means something else.
  */
 const LEVELS_PI_CANNOT_EXPRESS = new Set(["none"]);

/** A default the manifest must name when a model declares levels. */
const PREFERRED_DEFAULT = ["medium", "high"];

function parseArgs(argv) {
  return { check: argv.includes("--check") };
}

/** GET a JSON endpoint, retrying transient failures. */
async function fetchJson(url, label) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "pi-clinepass-sync",
          accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`${label}: HTTP ${response.status} from ${url}`);
      }
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
    }
  }
  throw lastError;
}

/**
 * The file body a GitHub contents/blob payload carries, or null when it carries
 * none. The contents API inlines small files base64-encoded under `content` and
 * omits it (empty string) above ~1 MB, which is why this catalog needs the blob
 * call; the blob API always inlines.
 */
function decodeContentsPayload(payload) {
  if (typeof payload?.content !== "string" || payload.content.length === 0) return null;
  return Buffer.from(payload.content, "base64").toString("utf8");
}
 
 /**
  * The catalog source: resolve the file's blob sha, then read that blob's body.
 * Kept separate from `fetchJson` because it needs two requests and a sha.
  */
async function fetchCatalogSource() {
  const meta = await fetchJson(CATALOG_CONTENTS_URL, "catalog metadata");
  // Small file: the contents call inlined the body.
  const inline = decodeContentsPayload(meta);
  if (inline) return inline;
  // Large file: read the blob the contents call pointed at.
  if (typeof meta?.sha !== "string" || meta.sha === "") {
    throw new Error("catalog metadata: no blob sha returned");
  }
  const blobPayload = await fetchJson(`${CATALOG_BLOB_URL}${meta.sha}`, "catalog blob");
  const blob = decodeContentsPayload(blobPayload);
  if (!blob) throw new Error("catalog blob: no body returned");
  return blob;
}

/**
 * Index of the delimiter that closes the one at `openIndex`, string-aware so
 * braces/brackets inside string literals do not count. Shared by the catalog
 * block extractor and the manifest models-list rewriter.
 */
function closingDelimiter(source, openIndex, open, close) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Pull the `"cline-pass": { … }` object out of the generated TypeScript catalog
 * and return it as data.
 */
function extractClinePassBlock(source) {
  const marker = '"cline-pass": {';
  const at = source.indexOf(marker);
  if (at < 0) {
    throw new Error('catalog: no "cline-pass" block found');
  }

  const start = source.indexOf("{", at + marker.length - 1);
  const end = closingDelimiter(source, start, "{", "}");
  if (end < 0) throw new Error("catalog: the cline-pass block is not closed");
  return JSON.parse(source.slice(start, end + 1));
}

function effortLevels(reasoningOptions) {
  const values = [];
  for (const option of reasoningOptions ?? []) {
    if (option.type !== "effort") continue;
    for (const value of option.values ?? []) {
      if (!LEVELS_PI_CANNOT_EXPRESS.has(value) && !values.includes(value)) {
        values.push(value);
      }
    }
  }
  return values;
}

function pickDefaultLevel(levels) {
  for (const candidate of PREFERRED_DEFAULT) {
    if (levels.includes(candidate)) return candidate;
  }
  return levels[0];
}

 /**
  * The label the model picker shows. Cline's own catalog publishes a proper
  * name per model ("DeepSeek V4 Pro", "Muse Spark 1.3 Contributor") — use it,
  * and fall back to the live recommendation name only when the catalog repeats
  * the raw slug (as it does for `cline-pass/qwen3.8-max`).
  */
 function displayName(id, entry, remoteNames) {
   const catalogName = typeof entry.name === "string" ? entry.name.trim() : "";
   const slug = id.slice(id.lastIndexOf("/") + 1);
   const remote = remoteNames.get(id);
   const usable = (value) => value && value !== id && value !== slug;
   if (usable(catalogName)) return `${catalogName} (ClinePass)`;
   if (usable(remote)) return `${remote} (ClinePass)`;
   return `${slug} (ClinePass)`;
 }

function buildModel(id, entry, remoteNames) {
  const levels = effortLevels(entry.reasoningOptions);
  const model = {
    id,
     name: displayName(id, entry, remoteNames),
    contextWindow: entry.contextWindow,
    maxTokens: entry.maxTokens,
    supportsImages: Boolean(entry.capabilities?.includes("images")),
  };
  if (levels.length > 0) {
    model.thinkingLevels = levels;
    model.defaultThinkingLevel = pickDefaultLevel(levels);
  }
  return model;
}

/** Emit the provider block the way the repo writes it: short rows stay one-line. */
 function renderModel(model) {
   const inline = JSON.stringify(model);
   if (inline.length <= 128) return `          ${inline}`;
   // One key per line, `id` first, and no trailing comma so the block stays JSON.
   const rows = Object.entries(model)
     .map(([key, value]) => `            ${JSON.stringify(key)}: ${JSON.stringify(value)}`)
     .join(",\n");
   return `          {\n${rows}\n          }`;
 }

function replaceModelsSection(source, providerId, models) {
  const providers = source.indexOf('"providers": [');
  if (providers < 0) throw new Error("manifest: no contributes.providers section");

  // Anchor on the provider's own id: the manifest carries several providers and
  // the observer one is not necessarily the first.
  const providerAt = source.indexOf(`"id": ${JSON.stringify(providerId)}`, providers);
  if (providerAt < 0) throw new Error(`manifest: no provider ${providerId}`);

  const modelsKey = source.indexOf('"models": [', providerAt);
  if (modelsKey < 0) throw new Error(`manifest: provider ${providerId} has no models list`);

  const open = source.indexOf("[", modelsKey);
  const close = closingDelimiter(source, open, "[", "]");
  if (close < 0) throw new Error(`manifest: provider ${providerId} models list is not closed`);

  const body = models.map((model) => renderModel(model)).join(",\n");
  return `${source.slice(0, open)}[\n${body}\n        ${source.slice(close)}`;
}

/** One provider block from the manifest, or null when it is not declared. */
function providerOf(source, providerId) {
  const providers = JSON.parse(source)?.contributes?.providers;
  if (!Array.isArray(providers)) throw new Error("manifest: no contributes.providers section");
  return providers.find((entry) => entry && entry.id === providerId) ?? null;
}

async function main() {
  const { check } = parseArgs(process.argv.slice(2));

  const remotePayload = await fetchJson(RECOMMENDED_URL, "recommended-models");
  const remotePass = Array.isArray(remotePayload?.clinePass) ? remotePayload.clinePass : [];
  const remoteNames = new Map(remotePass.map((entry) => [entry.id, entry.name]));

  const catalogSource = await fetchCatalogSource();
  const catalog = extractClinePassBlock(catalogSource);
  /*
    The generated catalog interleaves several catalogs — plain `cline-pass/*`
    slugs plus free and third-party lanes (`cline-free/*`, `nvidia/*`,
    `reflection/*`, `poolside/*`). Only `cline-pass/*` belongs to the ClinePass
    subscription this provider bills against, so the rest is filtered out: a
    free lane listed here would look like a subscription model and fail.
  */
  const catalogIds = Object.keys(catalog).filter((id) => id.startsWith(CLINE_PASS_PREFIX));
  const models = catalogIds
    .map((id) => buildModel(id, catalog[id], remoteNames))
    .sort((a, b) => a.id.localeCompare(b.id));

  // Cross-check: the live list and the shipped catalog must describe the same
  // models, or one of them is mid-deploy and the sync should not guess.
  const catalogSet = new Set(catalogIds);
  const remoteSet = new Set(remotePass.map((entry) => entry.id));
  const onlyCatalog = catalogIds.filter((id) => !remoteSet.has(id));
  const onlyRemote = [...remoteSet].filter((id) => !catalogSet.has(id));
  if (onlyCatalog.length || onlyRemote.length) {
    console.warn("⚠ live list and catalog disagree");
    if (onlyCatalog.length) console.warn(`  only in catalog: ${onlyCatalog.join(", ")}`);
    if (onlyRemote.length) console.warn(`  only in live list: ${onlyRemote.join(", ")}`);
  }

  let source = await readFile(MANIFEST_PATH, "utf8");
  const drifted = [];

  for (const providerId of PROVIDER_IDS) {
    const provider = providerOf(source, providerId);
    if (!provider) {
      console.warn(`⚠ manifest has no provider ${providerId}; skipped`);
      continue;
    }
    const previous = new Map((provider.models ?? []).map((model) => [model.id, model]));
    const added = models.filter((model) => !previous.has(model.id));
    const removed = [...previous.keys()].filter((id) => !models.some((m) => m.id === id));
    const changed = models.filter((model) => {
      const before = previous.get(model.id);
      return before && JSON.stringify(before) !== JSON.stringify(model);
    });

    console.log(`${providerId}: models ${previous.size} → ${models.length}`);
    for (const model of added) console.log(`  + ${model.id}`);
    for (const id of removed) console.log(`  - ${id}`);
    for (const model of changed) console.log(`  ~ ${model.id}`);

    if (added.length + removed.length + changed.length === 0) continue;
    drifted.push(providerId);
  }

  if (drifted.length === 0) {
    console.log("manifest already matches Cline's catalog");
    return;
  }
  if (check) {
    console.log("--check: nothing written");
    process.exitCode = 1;
    return;
  }

  for (const providerId of drifted) {
    source = replaceModelsSection(source, providerId, models);
  }
  await writeFile(MANIFEST_PATH, source, "utf8");
  console.log(`manifest.json updated: ${drifted.join(", ")}`);
}

await main();
