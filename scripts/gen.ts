#!/usr/bin/env bun
// 画像生成の統一ラッパー。nano-banana / openai を --provider で切り替え。
//
// usage:
//   bun run gen "<prompt>" --provider nano|openai -o <name> [-d <dir>] [-r <ref>...]
//
// nano-banana (default) は既存の nano-banana-2 CLI を spawn。
// openai は /v1/images/{generations,edits} を直接叩いて PNG を保存。
// gpt-image-2 は透過非対応なので、緑バック方式で生成 → process-set.sh で抜く。

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(REPO_ROOT, ".env");

function readEnv(key: string): string | undefined {
  if (process.env[key]) return process.env[key];
  if (!existsSync(ENV_PATH)) return undefined;
  const re = new RegExp(`^${key}\\s*=\\s*(.+)$`, "m");
  const v = readFileSync(ENV_PATH, "utf8").match(re)?.[1].trim();
  return v && v.length > 0 ? v : undefined;
}

const { values: opts, positionals } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    provider: { type: "string", default: "nano" },
    model: { type: "string" },
    ref: { type: "string", multiple: true, short: "r" },
    transparent: { type: "boolean", short: "t", default: false },
    size: { type: "string", short: "s" },
    quality: { type: "string", default: "medium" },
    aspect: { type: "string", short: "a" },
    output: { type: "string", short: "o" },
    dir: { type: "string", short: "d", default: "." },
    "no-green-bg": { type: "boolean", default: false },
  },
});

const prompt = positionals[0];
if (!prompt) {
  console.error('usage: bun run gen "<prompt>" --provider nano|openai -o <name> [-d <dir>] [-r <ref>...]');
  process.exit(1);
}
if (!opts.output) {
  console.error("error: --output (-o) is required");
  process.exit(1);
}

const GREEN_BG_SUFFIX =
  ", on a solid pure green screen background rgb(0,255,0), no shadows, no other background elements, full bleed background";
const finalPrompt = opts["no-green-bg"] ? prompt : prompt + GREEN_BG_SUFFIX;

mkdirSync(opts.dir!, { recursive: true });

if (opts.provider === "nano") {
  const args = [
    "run", "nano-banana", finalPrompt,
    "-s", opts.size || "512",
    "-m", opts.model || "flash",
    "-o", opts.output,
    "-d", opts.dir!,
  ];
  if (opts.transparent) args.push("-t");
  if (opts.aspect) args.push("-a", opts.aspect);
  for (const r of opts.ref || []) args.push("-r", r);
  const r = spawnSync("bun", args, { stdio: "inherit", cwd: REPO_ROOT });
  process.exit(r.status ?? 0);
}

if (opts.provider === "openai") {
  const apiKey = readEnv("OPENAI_API_KEY");
  if (!apiKey) {
    console.error("error: OPENAI_API_KEY not found in env or .env");
    process.exit(1);
  }
  if (opts.transparent) {
    console.error("warn: --transparent is ignored for openai (gpt-image-2 doesn't support transparent; use green-screen workflow)");
  }

  // モデル決定の優先順: --model > OPENAI_MODEL env > "gpt-image-1"
  // gpt-image-1 をデフォにしてあるのは、OpenAI が新世代 / フロンティアモデルに対して
  // organization verification (KYC) を要求するポリシーで、現時点では gpt-image-2 が該当
  // (将来 gpt-image-3 等が出ても同じ運用になる可能性が高い)。verify 不要モデルでも
  // ひとまず動かせるよう、ハードコード fallback は verify 不要な gpt-image-1 にしている。
  // verify 済みなら .env で OPENAI_MODEL=<モデル名> を常用化するか、--model で都度切替。
  // verify 手順: https://platform.openai.com/settings/organization/general → "Verify Organization"
  const model = opts.model || readEnv("OPENAI_MODEL") || "gpt-image-1";
  const size = opts.size || "1024x1024";
  const quality = opts.quality!;
  const refs = opts.ref || [];
  const isEdit = refs.length > 0;
  const url = isEdit
    ? "https://api.openai.com/v1/images/edits"
    : "https://api.openai.com/v1/images/generations";

  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  let body: BodyInit;

  if (isEdit) {
    const fd = new FormData();
    fd.append("model", model);
    fd.append("prompt", finalPrompt);
    fd.append("size", size);
    fd.append("quality", quality);
    fd.append("n", "1");
    for (const r of refs) {
      if (!existsSync(r)) {
        console.error(`error: ref image not found: ${r}`);
        process.exit(1);
      }
      const ext = r.toLowerCase().split(".").pop();
      const mime =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
        ext === "webp" ? "image/webp" : "image/png";
      const blob = new Blob([readFileSync(r)], { type: mime });
      fd.append("image[]", blob, basename(r));
    }
    body = fd;
  } else {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({ model, prompt: finalPrompt, size, quality, n: 1 });
  }

  const res = await fetch(url, { method: "POST", headers, body });
  const json: any = await res.json();
  if (!res.ok || json.error) {
    console.error("openai error:", JSON.stringify(json.error || json, null, 2));
    process.exit(1);
  }

  const b64 = json.data?.[0]?.b64_json;
  if (!b64) {
    console.error("no image data in response:", JSON.stringify(json).slice(0, 400));
    process.exit(1);
  }

  const outPath = join(opts.dir!, `${opts.output}.png`);
  writeFileSync(outPath, Buffer.from(b64, "base64"));
  console.log(`saved: ${outPath}`);
  process.exit(0);
}

console.error(`unknown provider: ${opts.provider} (expected: nano | openai)`);
process.exit(1);
