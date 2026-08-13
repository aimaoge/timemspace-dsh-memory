#!/usr/bin/env node
/**
 * dsh-add-timemspace-mcp.mjs — 一键向 DeepSeek Harness 追加 TiMEM-SPACE MCP 桥接
 *
 * 功能：
 *   1. 自动搜索 DSH 安装目录下的 cordis.patch.yml
 *      （$DSH_HOME → ~/.dsh → npm npx 缓存目录，可 --file 覆盖）
 *   2. 命令行追问 API Key（粘贴输入，不回显；可 --key 免交互）
 *   3. 幂等追加/更新 "TiMEM-SPACE" 桥接实例（@deepseek-ai/dsh-mcp-client）
 *   4. 支持 --dry-run 预览、--yes 跳过确认
 *
 * 兼容性：Windows 7/10/11、Linux、macOS —— 只需要 node（DSH 依赖 node，
 * 任何能跑 DSH 的机器都自带）。无第三方依赖，仅用 node 内置模块。
 *
 * 用法：
 *   node dsh-add-timemspace-mcp.mjs                    # 自动找配置 + 追问 key
 *   node dsh-add-timemspace-mcp.mjs --file <path>      # 指定配置文件
 *   node dsh-add-timemspace-mcp.mjs --key sk-xxxx -y   # 免交互（脚本/CI 用）
 *   node dsh-add-timemspace-mcp.mjs --dry-run --key sk-x  # 只预览不落盘
 *   node dsh-add-timemspace-mcp.mjs --url https://api.space.timem.cloud/mcp/ \
 *        --server-name timem-space --key sk-xxxx -y
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import https from 'node:https';

const ENTRY_ID = 'mcp-timem-space';
const DEFAULTS = {
  serverName: 'timem-space',
  url: 'https://api.space.timem.cloud/mcp/',
  githubRepo: 'aimaoge/timemspace-dsh-mcp',
};

/* ------------------------- 命令行参数 ------------------------- */
function parseArgs(argv) {
  const opts = {
    file: null, key: null, url: null, serverName: null,
    dryRun: false, yes: false, help: false, version: false, checkUpdate: false,
  };
  const TAKES_VALUE = new Set(['--file', '--key', '--url', '--server-name']);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    const inlineVal = eq > 0 ? a.slice(eq + 1) : null;
    const val = inlineVal !== null ? inlineVal : (TAKES_VALUE.has(name) ? argv[++i] : null);
    switch (name) {
      case '--file': opts.file = val; break;
      case '--key': opts.key = val; break;
      case '--url': opts.url = val; break;
      case '--server-name': opts.serverName = val; break;
      case '--version': case '-v': opts.version = true; break;
      case '--check-update': opts.checkUpdate = true; break;
      case '--dry-run': opts.dryRun = true; break;
      case '--yes': case '-y': opts.yes = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        console.error(`[错误] 未知参数: ${a}`);
        process.exit(2);
    }
  }
  return opts;
}

function printHelp() {
  console.log(`用法: node ${path.basename(process.argv[1])} [选项]
  自动查找 DSH 的 cordis.patch.yml 并追加 TiMEM MCP 桥接（等价于其他平台的 mcpServers JSON）。

选项:
  --file <path>        指定 cordis.patch.yml（跳过自动查找）
  --key <key>          直接提供 API Key（跳过交互输入）
  --url <url>          MCP 端点，默认 ${DEFAULTS.url}
  --server-name <name> 工具命名空间，默认 ${DEFAULTS.serverName}
  --dry-run            只打印将要写入的内容，不修改文件
  -y, --yes            跳过确认
  -v, --version        显示当前版本
  --check-update       检查是否有新版本（对比 GitHub 最新 tag）
  -h, --help           显示帮助`);
}

/* ------------------------- 交互输入 ------------------------- */
/** 询问一行明文（回车结束）。stdin 非 TTY（管道）时直接读完。 */
function askLine(question) {
  return new Promise((resolve) => {
    process.stdin.resume();
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: !!process.stdin.isTTY,
    });
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/** 询问密钥：TTY 下进入 raw 模式不回显，支持粘贴/退格/Ctrl+C/Ctrl+D；非 TTY 直接读管道。 */
function askSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let buf = '';
      stdin.setEncoding('utf8');
      const onData = (d) => { buf += d; };
      const onEnd = () => {
        stdin.off('data', onData);
        stdin.off('end', onEnd);
        resolve(buf.replace(/[\r\n]+$/, '').trim());
      };
      stdin.on('data', onData);
      stdin.on('end', onEnd);
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk) => {
      const s = chunk;
      if (s === '\r' || s === '\n' || s === '\u0004') { // Enter / Ctrl+D
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(value);
      } else if (s === '\u0003') { // Ctrl+C
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off('data', onData);
        process.stdout.write('\n');
        resolve(null);
      } else if (s === '\u007f' || s === '\b') { // 退格 (Windows=0x7f, Unix=0x08)
        value = value.slice(0, -1);
      } else if (!/^[\u001b\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(s)) {
        value += s; // 忽略控制/转义序列（方向键等），其余（含粘贴内容）累积
      }
    };
    stdin.on('data', onData);
  });
}

/* ------------------------- 自动查找配置 ------------------------- */
function candidateRoots() {
  const roots = new Set();
  if (process.env.DSH_HOME) roots.add(process.env.DSH_HOME);
  roots.add(path.join(os.homedir(), '.dsh'));
  // npm npx 缓存（DSH 常通过 npx 启动，profile 可能落在缓存里）
  if (process.env.npm_config_cache) roots.add(process.env.npm_config_cache);
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    roots.add(path.join(appData, 'npm-cache'));
    roots.add(path.join(localAppData, 'npm-cache'));
    roots.add(path.join(os.homedir(), 'AppData', 'Local', 'npm-cache'));
  } else {
    roots.add(path.join(os.homedir(), '.npm', '_npx'));
    if (process.env.HOME === '/root') roots.add('/root/.npm/_npx');
  }
  return [...roots].filter(fs.existsSync);
}

/** 在候选根下递归寻找所有 cordis.patch.yml（跳过 node_modules，限制深度）。 */
function findPatchFiles(roots, maxDepth = 8) {
  const found = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.name === 'cordis.patch.yml') found.push(p);
    }
  };
  for (const r of roots) walk(r, 0);
  return found;
}

/** 多个结果时优先 web profile（GUI），否则让用户选；非 TTY 自动选 web。 */
async function pickFile(files) {
  if (files.length === 1) return files[0];
  const web = files.find((f) => f.split(/[\\/]/).includes('web'));
  if (web) {
    console.log(`[信息] 找到 ${files.length} 个配置文件，优先使用 web profile:\n  ${web}`);
    return web;
  }
  if (!process.stdin.isTTY) {
    console.log(`[信息] 找到 ${files.length} 个配置文件（非交互模式），使用第一个:\n  ${files[0]}`);
    return files[0];
  }
  console.log('[信息] 找到多个配置文件，请选择:');
  files.forEach((f, i) => console.log(`  [${i + 1}] ${f}`));
  const ans = await askLine(`选择 1-${files.length}（回车默认 1）: `);
  const idx = parseInt(ans, 10);
  const chosen = Number.isInteger(idx) && idx >= 1 && idx <= files.length ? files[idx - 1] : files[0];
  console.log(`[信息] 使用: ${chosen}`);
  return chosen;
}

/* ------------------------- 版本检查 ------------------------- */
function pkgVersion() {
  try {
    const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0-dev';
  }
}

function compareSemver(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

/** 简易 HTTPS GET 返回 JSON；失败（TLS/网络）返回 null，保证优雅降级。 */
function fetchJSON(url) {
  return new Promise((resolve) => {
    const req = https.get(url, { headers: { 'User-Agent': 'dsh-add-mcp' } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
  });
}

async function checkUpdate(repo) {
  const cur = pkgVersion();
  const tags = await fetchJSON(`https://api.github.com/repos/${repo}/tags`);
  if (!Array.isArray(tags) || tags.length === 0) {
    console.log(`[信息] 当前版本 v${cur}；无法检查远程版本（网络/TLS 或仓库无 tag）。`);
    console.log('  提示：npx 有缓存，升级到最新请先运行 npm cache clean --force 再重试。');
    return;
  }
  const latest = tags
    .map((t) => t.name)
    .filter((n) => /^v?\d+\.\d+\.\d+$/.test(n))
    .sort(compareSemver)
    .at(-1);
  if (latest && compareSemver(latest, `v${cur}`) > 0) {
    console.log(`[提示] 发现新版本 ${latest}（当前 v${cur}）`);
    console.log(`  升级: npm cache clean --force 后重新执行 npx，或直接: npx --yes github:${repo}#${latest}`);
  } else {
    console.log(`[信息] 已是最新版本 v${cur}。`);
  }
}

/* ------------------------- YAML 补丁 ------------------------- */
function yamlScalar(v) {
  return /^[A-Za-z0-9_\-./]+$/.test(v) ? v : JSON.stringify(v);
}

function buildBlock({ serverName, url, key, eol }) {
  const L = [
    '',
    '# ---- TiMEM SPACE MCP 桥接（DSH 版 mcpServers 示例）----',
    '# 等价于其他平台 JSON: {"mcpServers":{"TiMEM-SPACE":{"url":"' + url + '","headers":{"X-API-Key":"..."}}}}',
    `- id: ${ENTRY_ID}`,
    "  name: '@deepseek-ai/dsh-mcp-client'",
    '  config:',
    `    serverName: ${serverName}`,
    '    transport: streamable-http',
    `    url: ${url}`,
    '    headers:',
    `      X-API-Key: ${yamlScalar(key)}`,
  ];
  return L.join(eol);
}

/** 找到 - id: <entryId> 的行号；没有则 -1。 */
function findEntryLine(lines) {
  for (let i = 0; i < lines.length; i++) {
    const m = /^- id:\s*(\S+)\s*$/.exec(lines[i]);
    if (m && m[1] === ENTRY_ID) return i;
  }
  return -1;
}

/** 幂等合并：空文件/`[]` → 直接替换；已存在 → 原位更新（含其上方注释）；否则追加到末尾。 */
function applyPatch(content, block, eol) {
  const trimmed = content.trim();
  if (trimmed === '' || trimmed === '[]') {
    return block.replace(/^\s*\r?\n/, '') + eol;
  }
  const lines = content.split(/\r?\n/);
  const entryLine = findEntryLine(lines);
  if (entryLine === -1) {
    return content.replace(/\s+$/, '') + block + eol;
  }
  // 向上吞掉该条目上方的注释/空行，整体替换
  let start = entryLine;
  while (start > 0) {
    const prev = lines[start - 1].trim();
    if (prev === '' || prev.startsWith('#')) start--;
    else break;
  }
  // 下一个条目必须从 entryLine 之后找（start 可能已被上移到注释行）
  let end = lines.length;
  for (let i = entryLine + 1; i < lines.length; i++) {
    if (/^- id:\s*\S+\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const newLines = block.split(eol);
  if (newLines[0] === '') newLines.shift();
  lines.splice(start, end - start, ...newLines);
  return lines.join(eol);
}

/* ------------------------- 主流程 ------------------------- */
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (opts.version) {
    console.log(`v${pkgVersion()}`);
    process.exit(0);
  }
  if (opts.checkUpdate) {
    await checkUpdate(DEFAULTS.githubRepo);
    process.exit(0);
  }

  const serverName = opts.serverName || DEFAULTS.serverName;
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(serverName)) {
    console.error(`[错误] serverName 必须是 1-32 位 [A-Za-z0-9_-]（当前: ${serverName}）`);
    process.exit(1);
  }
  const url = opts.url || DEFAULTS.url;

  // 1) 找配置文件
  let file = opts.file;
  if (!file) {
    const files = findPatchFiles(candidateRoots());
    if (files.length === 0) {
      console.error(
        '[错误] 未找到 cordis.patch.yml。\n' +
        '  请确认 DSH 已安装（查找位置: $DSH_HOME、~/.dsh、npm npx 缓存），\n' +
        '  或用 --file 显式指定路径。'
      );
      process.exit(1);
    }
    file = await pickFile(files);
  }
  if (!fs.existsSync(file)) {
    console.error(`[错误] 配置文件不存在: ${file}`);
    process.exit(1);
  }
  console.log(`[信息] 目标配置文件: ${file}`);

  // 2) 获取 API Key
  let key = opts.key;
  if (!key) {
    key = await askSecret('请输入 TiMEM API Key（粘贴后回车，不回显）: ');
    if (!key) {
      console.error('[错误] 未输入 API Key，已取消。');
      process.exit(1);
    }
  }

  // 3) 生成并合并补丁
  const raw = fs.readFileSync(file, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const block = buildBlock({ serverName, url, key, eol });
  const updated = applyPatch(raw, block, eol);

  // 4) 预览 / 确认 / 写入
  if (opts.dryRun) {
    console.log('\n---- 将要写入的内容 ----');
    console.log(updated);
    console.log('------------------------\n[信息] --dry-run 模式，未修改文件。');
    process.exit(0);
  }
  if (!opts.yes) {
    const ans = await askLine(`确认写入 ${file} ? (y/N) `);
    if (!/^y(es)?$/i.test(ans)) {
      console.log('已取消。');
      process.exit(0);
    }
  }
  fs.writeFileSync(file, updated, 'utf8');

  // 5) 结果与对照
  console.log(`\n[完成] 已写入: ${file}`);
  console.log(`[完成] 重启 DSH host 后，工具将以 mcp__${serverName}__* 命名注册`);
  console.log('        （如 mcp__timem-space__search_memories、mcp__timem-space__create_memory）\n');
  console.log('等价的其他平台配置（供对照）:');
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          'TiMEM-SPACE': {
            url,
            headers: { 'X-API-Key': key },
          },
        },
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(`[错误] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
