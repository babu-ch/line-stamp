#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const ENV_PATH = join(REPO_ROOT, ".env");
const USER_DIR = join(REPO_ROOT, "user");
const CHAR_DIR = join(USER_DIR, "character");
const SETS_DIR = join(USER_DIR, "sets");

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function readApiKey(): string | null {
  if (!existsSync(ENV_PATH)) return null;
  const m = readFileSync(ENV_PATH, "utf8").match(/^GEMINI_API_KEY\s*=\s*(.+)$/m);
  const v = m?.[1].trim();
  return v && v.length > 0 ? v : null;
}

function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

async function readLine(q: string): Promise<string> {
  process.stdout.write(q);
  for await (const line of console) return line.trim();
  return "";
}

async function readSingleKey(q: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return readLine(q);
  }
  process.stdout.write(q);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.once("data", (chunk: Buffer) => {
      stdin.setRawMode(false);
      stdin.pause();
      const key = chunk.toString();
      // Ctrl+C / Ctrl+D
      if (key === "\x03" || key === "\x04") {
        process.stdout.write("\n");
        process.exit(130);
      }
      // Enter → 空文字（呼び出し側で推奨選択肢にマップ）
      if (key === "\r" || key === "\n") {
        process.stdout.write("\n");
        resolve("");
        return;
      }
      // その他キーはエコー表示
      process.stdout.write(key + "\n");
      resolve(key);
    });
  });
}

const apiKey = readApiKey();
const characters = listDirs(CHAR_DIR);
const sets = listDirs(SETS_DIR);

console.log();
console.log(`${BOLD}stamps${RESET} ${DIM}— LINE スタンプ自動生成ツール${RESET}`);
console.log();
console.log(`${DIM}流れ:${RESET} ① キャラクターを決める → ② スタンプ内容を決める → ③ まとめて作る → ④ LINE 提出チェック`);
console.log();
console.log(`${DIM}現在の状況:${RESET}`);
console.log(`  API キー:      ${apiKey ? `${GREEN}設定済み${RESET}` : `${RED}未設定${RESET}`}`);
console.log(`  キャラクター:  ${characters.length ? characters.join(", ") : `${DIM}まだありません${RESET}`}`);
console.log(`  スタンプ案:    ${sets.length ? sets.join(", ") : `${DIM}まだありません${RESET}`}`);
console.log();

if (!apiKey) {
  console.log(`${YELLOW}先に環境をセットアップしてください:${RESET}`);
  console.log(`  1. ./scripts/setup.sh`);
  console.log(`  2. .env の GEMINI_API_KEY に API キーを貼る`);
  console.log(`  3. もう一度 bun start`);
  process.exit(0);
}

// 状態から推奨アクションを決める
let recommend: string;
if (characters.length === 0) {
  recommend = "1";
} else if (sets.length === 0) {
  recommend = "2";
} else {
  recommend = "3";
}

const menu = [
  {
    key: "1",
    label: "キャラクターをデザインする",
    help: "全スタンプ共通の「絵柄の見本」を1枚作ります。ここが全体の雰囲気を決めます",
  },
  {
    key: "2",
    label: "スタンプの中身（セリフ・ポーズ）を決める",
    help: "8 / 16 / 24 / 32 / 40 個から選んで、それぞれのセリフと状況を決めます",
  },
  {
    key: "3",
    label: "決めた内容でスタンプをまとめて生成する",
    help: "実際に画像を作ります。1枚 $0.045 程度。40個セットで約 $1.80",
  },
  {
    key: "4",
    label: "LINE 提出用のチェックをする",
    help: "サイズ・容量・透過背景・余白など、LINE の仕様に合っているか確認",
  },
  {
    key: "5",
    label: "これまでの利用料金を見る",
    help: "nano-banana の累計コスト履歴を表示",
  },
  {
    key: "q",
    label: "終了",
    help: "",
  },
];

console.log(`${BOLD}何をしますか?${RESET}`);
for (const m of menu) {
  const mark = m.key === recommend ? `${GREEN}▶${RESET}` : " ";
  console.log(`  ${mark} [${CYAN}${m.key}${RESET}] ${m.label}`);
  if (m.help) console.log(`       ${DIM}${m.help}${RESET}`);
}
console.log();
console.log(`${DIM}▶ は現在の状況からのおすすめ。何も押さず Enter でそれが選ばれます${RESET}`);
console.log();

const rawInput = await readSingleKey("> ");
const choice = rawInput === "" ? recommend : rawInput;
console.log();

const prompts: Record<string, string> = {
  "1": "stamps のキャラクターを新しく作りたい。CLAUDE.md のワークフロー 1 に沿って、モチーフ・画風・色味・用途を順に聞いて、候補を複数並列で生成してください。",
  "2": "スタンプの中身（セリフ・ポーズ一覧）を決めたい。CLAUDE.md のワークフロー 2 に沿って、対象キャラ・個数（8/16/24/32/40）・全体テーマを聞いて、各スタンプの内容を提案してください。",
  "3": "user/sets/<セット名>/manifest.json を読んで、各スタンプを nano-banana で順に生成し、user/sets/<セット名>/raw/ に保存してください。事前に見積もりコストを1行で出してください。",
  "4": "user/sets/<セット名>/submit/ の LINE 提出仕様チェックをしてください（寸法 / 偶数px / 1MB以下 / 背景透過 / 余白10px）。",
};

if (choice === "q") process.exit(0);

if (choice === "5") {
  const r = spawnSync("bun", ["run", "nano-banana", "--costs"], { stdio: "inherit", cwd: REPO_ROOT });
  process.exit(r.status ?? 0);
}

const userPrompt = prompts[choice];
if (!userPrompt) {
  console.log(`${RED}選択肢が見つかりません: ${choice}${RESET}`);
  process.exit(1);
}

const claudeCmd = Bun.which("claude");
if (!claudeCmd) {
  console.log(`${RED}claude コマンドが見つかりません${RESET}`);
  console.log(`${DIM}Claude Code をインストールするか、他のエージェントで本ディレクトリを開いてください（CLAUDE.md を読んで同じメニューを提示します）。${RESET}`);
  process.exit(1);
}

console.log(`${DIM}Claude Code を起動します...${RESET}`);
console.log();
const r = spawnSync(claudeCmd, [userPrompt], { stdio: "inherit", cwd: REPO_ROOT });
process.exit(r.status ?? 0);
