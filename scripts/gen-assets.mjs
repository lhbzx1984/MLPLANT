#!/usr/bin/env node
/**
 * Agnes AI 平台视觉资产生成器
 *
 * 使用 Agnes Image API (agnes-image-2.5-flash) 生成平台 UI 品牌资产,
 * 输出到 public/assets/。可重复运行(重新生成覆盖旧图)。
 *
 * 配置: .env.local 中的 AGNES_API_KEY
 * 用法: node scripts/gen-assets.mjs [名称...]   (无参数 = 生成全部)
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
import path from "path";

// 读取 .env.local
try {
  const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of env.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const API = "https://apihub.agnes-ai.com/v1/images/generations";
const KEY = process.env.AGNES_API_KEY;
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w):/, "$1:")), "..", "public", "assets");

const ASSETS = {
  "login-bg": {
    size: "2K",
    ratio: "16:9",
    prompt:
      "abstract futuristic technology background for enterprise AI education platform, deep navy blue and dark cyan gradient, glowing neural network nodes and flowing data streams, subtle circuit board patterns, soft depth of field, dark professional corporate style, high visual density on the right side with empty darker area on the left for text overlay, cinematic lighting, ultra clean, no text",
  },
  "banner-admin": {
    size: "2K",
    ratio: "21:9",
    prompt:
      "wide banner illustration for admin console of a machine learning education platform, holographic control dashboard, glowing GPU server racks, network topology graphs, deep blue and cyan color scheme with subtle purple accents, dark background, professional enterprise technology style, clean composition, no text",
  },
  "banner-teacher": {
    size: "2K",
    ratio: "21:9",
    prompt:
      "wide banner illustration for teacher workspace of a machine learning education platform, holographic classroom dashboard, floating data charts and experiment progress panels, glowing neural network model visualization, deep blue and cyan gradient with amber accent highlights, dark professional style, clean composition, no text",
  },
  "banner-student": {
    size: "2K",
    ratio: "21:9",
    prompt:
      "wide banner illustration for student learning portal of a machine learning education platform, glowing learning path with milestones, floating code windows and model training curves, rocket launch metaphor, deep blue and cyan gradient with emerald accent highlights, dark professional style, hopeful and energetic, no text",
  },
  "login-robot": {
    size: "1K",
    ratio: "1:1",
    prompt:
      "friendly futuristic AI robot assistant mascot for education technology platform, glossy white and blue metallic body with glowing cyan eyes, holographic neural network halo above head, dark blue gradient background with soft glow, 3D render, centered, cute but professional, no text",
  },
};

const wanted = process.argv.slice(2);
const keys = wanted.length ? wanted : Object.keys(ASSETS);

if (!KEY) {
  console.error("请在 .env.local 中配置 AGNES_API_KEY");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

async function gen(name, cfg) {
  const t0 = Date.now();
  process.stdout.write(`生成 ${name} ... `);
  const r = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "agnes-image-2.5-flash",
      prompt: cfg.prompt,
      size: cfg.size,
      ratio: cfg.ratio,
      return_base64: true,
    }),
    signal: AbortSignal.timeout(300000),
  });
  if (!r.ok) {
    console.log(`失败 HTTP ${r.status}: ${(await r.text()).slice(0, 120)}`);
    return false;
  }
  const d = await r.json();
  const b64 = d.data?.[0]?.b64_json;
  if (!b64) {
    console.log("失败: 响应无 b64_json");
    return false;
  }
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(b64, "base64"));
  console.log(`完成 ${Math.round(statSync(file).size / 1024)}KB, ${Date.now() - t0}ms`);
  return true;
}

let ok = 0;
for (const k of keys) {
  if (!ASSETS[k]) {
    console.log(`未知资产: ${k} (可选: ${Object.keys(ASSETS).join(", ")})`);
    continue;
  }
  if (await gen(k, ASSETS[k])) ok++;
}
console.log(`\n完成 ${ok}/${keys.length} 项, 输出目录: ${OUT}`);
