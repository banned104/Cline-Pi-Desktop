#!/usr/bin/env node
/**
 * Sync the ClinePass model list in `manifest.json` with Cline's own catalog.
 *
 *   node scripts/sync-clinepass.mjs            # update manifest.json
 *   node scripts/sync-clinepass.mjs --check    # report drift, change nothing
 *   node scripts/sync-clinepass.mjs --remote   # read Cline's live endpoint only
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
 
 /** Provider id in `manifest.json` to rewrite. */
 const PROVIDER_ID = "clinepass";
 
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
  return {
    check: argv.includes("--check"),
    remoteOnly: argv.includes("--remote"),
  };
}

 async function fetchText(url, label) {
   let lastError;
   // Small responses (the live list) are read directly; the 4 MB catalog goes
   // through the base64 contents channel, because streaming it raw over HTTP/2
   // truncates the body on some networks.
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
       const payload = await response.json();
       // A GitHub contents response carries the file base64-encoded under
       // `content` — but omits it (an empty string) for files above ~1 MB, so
       // only a non-empty value means "this is the file body". Anything else
       // (Cline's own endpoints, or contents metadata) is already the data.
       if (typeof payload?.content === "string" && payload.content.length > 0) {
         return Buffer.from(payload.content, "base64").toString("utf8");
       }
       return payload;
     } catch (error) {
       lastError = error;
       if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_500 * attempt));
     }
   }
   throw lastError;
 }
 
 /**
  * The catalog source: resolve the file's blob sha, then read that blob's body.
  * Kept separate from `fetchText` because it needs two requests and a sha.
  */
 async function fetchCatalogSource() {
   const meta = await fetchText(CATALOG_CONTENTS_URL, "catalog metadata");
   // Small file: the contents call already returned the decoded body.
   if (typeof meta === "string") return meta;
   if (typeof meta?.sha !== "string" || meta.sha === "") {
     throw new Error("catalog metadata: no blob sha returned");
   }
   // Large file: the blob call returns the decoded body directly.
   const blob = await fetchText(`${CATALOG_BLOB_URL}${meta.sha}`, "catalog blob");
   if (typeof blob !== "string") {
     throw new Error("catalog blob: no body returned");
   }
   return blob;
 }

/**
 * Pull the `"cline-pass": { … }` object out of the generated TypeScript catalog
 * and return it as data. Brace matching is string-aware so braces inside
 * descriptions do not end the block early.
 */
function extractClinePassBlock(source) {
  const marker = '"cline-pass": {';
  const at = source.indexOf(marker);
  if (at < 0) {
    throw new Error('catalog: no "cline-pass" block found');
  }

  const start = source.indexOf("{", at + marker.length - 1);
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(source.slice(start, index + 1));
    }
  }

  throw new Error("catalog: the cline-pass block is not closed");
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

function replaceModelsSection(source, models) {
  const providers = source.indexOf('"providers": [');
  if (providers < 0) throw new Error("manifest: no contributes.providers section");

  const modelsKey = source.indexOf('"models": [', providers);
  if (modelsKey < 0) throw new Error("manifest: no provider models list");

  const open = source.indexOf("[", modelsKey);
  let depth = 0;
  let inString = false;
  let escaped = false;
  let close = -1;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]") {
      depth -= 1;
      if (depth === 0) {
        close = index;
        break;
      }
    }
  }
  if (close < 0) throw new Error("manifest: provider models list is not closed");

   const body = models.map((model) => renderModel(model)).join(",\n");
  return `${source.slice(0, open)}[\n${body}\n        ${source.slice(close)}`;
}

async function main() {
  const { check, remoteOnly } = parseArgs(process.argv.slice(2));

  const remotePayload = await fetchText(RECOMMENDED_URL, "recommended-models");
  const remotePass = Array.isArray(remotePayload?.clinePass) ? remotePayload.clinePass : [];
  const remoteNames = new Map(remotePass.map((entry) => [entry.id, entry.name]));
 
  if (remoteOnly) {
    throw new Error(
       "--remote alone cannot build the manifest: the live list carries no context window, output ceiling or reasoning ladder.",
    );
  }
 
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

  const source = await readFile(MANIFEST_PATH, "utf8");
  const provider = JSON.parse(source).contributes.providers.find(
    (entry) => entry.id === PROVIDER_ID,
  );
  const previous = new Map((provider?.models ?? []).map((model) => [model.id, model]));

  const added = models.filter((model) => !previous.has(model.id));
  const removed = [...previous.keys()].filter((id) => !models.some((m) => m.id === id));
  const changed = models.filter((model) => {
    const before = previous.get(model.id);
    return before && JSON.stringify(before) !== JSON.stringify(model);
  });

  console.log(`models: ${previous.size} → ${models.length}`);
  for (const model of added) console.log(`  + ${model.id}`);
  for (const id of removed) console.log(`  - ${id}`);
  for (const model of changed) console.log(`  ~ ${model.id}`);

  if (added.length + removed.length + changed.length === 0) {
    console.log("manifest already matches Cline's catalog");
    return;
  }
  if (check) {
    console.log("--check: nothing written");
    process.exitCode = 1;
    return;
  }

  await writeFile(MANIFEST_PATH, replaceModelsSection(source, models), "utf8");
  console.log("manifest.json updated");
}

await main();
