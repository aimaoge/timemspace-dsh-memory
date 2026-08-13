#!/usr/bin/env node
/**
 * dsh-add-timemspace-memory.mjs — 一键向 DeepSeek Harness 集成 TiMEM-SPACE 记忆（MCP 桥接 + skill 钩子）
 *
 * 功能：
 *   1. 自动搜索 DSH 安装目录下的 cordis.patch.yml
 *      （$DSH_HOME → ~/.dsh → npm npx 缓存目录，可 --file 覆盖）
 *   2. 命令行追问 API Key（粘贴输入，不回显；可 --key 免交互）
 *   3. 幂等追加/更新 "TiMEM-SPACE" 桥接实例（@deepseek-ai/dsh-mcp-client）
 *   4. 自动安装配套 skill（general 默认 / coding、writing 备选）
 *   5. 连接验证（--verify）与 DSH 重启引导
 *
 * 兼容性：Windows 7/10/11、Linux、macOS —— 只需要 node（DSH 依赖 node，
 * 任何能跑 DSH 的机器都自带）。无第三方依赖，仅用 node 内置模块。
 *
 * 用法：
 *   node dsh-add-timemspace-memory.mjs                     # 自动找配置 + 追问 key
 *   node dsh-add-timemspace-memory.mjs --file <path>       # 指定配置文件
 *   node dsh-add-timemspace-memory.mjs --key sk-xxxx -y    # 免交互（脚本/CI 用）
 *   node dsh-add-timemspace-memory.mjs --dry-run --key sk-x  # 只预览不落盘
 *   node dsh-add-timemspace-memory.mjs --url https://api.space.timem.cloud/mcp/ \
 *        --server-name timem-space --key sk-xxxx -y
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
    verify: false, noVerify: false, noRestart: false,
    noSkill: false, forceSkill: false, skillDir: null, skill: null,
  };
  const TAKES_VALUE = new Set(['--file', '--key', '--url', '--server-name', '--skill-dir', '--skill']);
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
      case '--verify': opts.verify = true; break;
      case '--no-verify': opts.noVerify = true; break;
      case '--no-restart': opts.noRestart = true; break;
      case '--no-skill': opts.noSkill = true; break;
      case '--skill': opts.skill = val; break;
      case '--force-skill': opts.forceSkill = true; break;
      case '--skill-dir': opts.skillDir = val; break;
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
  一键向 DeepSeek Harness 集成 TiMEM-SPACE 记忆：写 MCP 桥接配置 + 装配套 skill + 验证连接 + 重启引导。

选项:
  --file <path>        指定 cordis.patch.yml（跳过自动查找）
  --key <key>          直接提供 API Key（跳过交互输入）
  --url <url>          MCP 端点，默认 ${DEFAULTS.url}
  --server-name <name> 工具命名空间，默认 ${DEFAULTS.serverName}
  --dry-run            只打印将要写入的内容，不修改文件
  --verify             只验证 MCP 端点连通/认证/工具清单，不修改配置
  --no-verify          写入配置后跳过自动验证
  --no-restart          写入后不询问是否重启 DSH（直接打印重启命令）
  --no-skill            跳过配套 skill 安装
  --skill <names>       安装指定 skill：general,coding,writing 或 all（默认 general；交互模式逐一询问备选）
  --force-skill         覆盖已存在的同名 skill（默认会询问）
  --skill-dir <dir>     自定义 skill 安装目录（默认 DSH 用户级 ~/.dsh/skills）
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

/** 验证 MCP 端点连通性/认证/工具清单；返回是否通过。失败时给出可读原因。 */
function verifyConnection(url, key, userId) {
  return new Promise((resolve) => {
    console.log(`[验证] 目标: ${url}`);
    const rpcBody = (method, params, id) => JSON.stringify(
      params ? { jsonrpc: '2.0', id, method, params } : { jsonrpc: '2.0', id, method }
    );
    const doRequest = (body, extraHeaders, done) => {
      const req = https.request(new URL(url), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
          'X-API-Key': key,
          ...(userId ? { 'X-TiMEM-User-Id': userId } : {}),
          ...extraHeaders,
        },
      }, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let body = data;
          // Streamable HTTP 可能以 SSE 返回：提取 data: 行再解析
          if ((res.headers['content-type'] || '').includes('text/event-stream')) {
            body = data.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).join('\n');
          }
          done({ status: res.statusCode, headers: res.headers, body });
        });
      });
      req.on('error', (e) => done({ error: e }));
      req.setTimeout(15000, () => req.destroy(new Error('连接超时')));
      req.end(body);
    };

    doRequest(
      rpcBody('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'dsh-add-mcp-verify', version: pkgVersion() } }, 1),
      {},
      (r1) => {
        if (r1.error) {
          console.log(`[验证] 失败: 无法连接 → ${r1.error.message}\n  可能原因: TiMEM 服务未启动 / URL 错误 / 网络或 TLS 问题`);
          resolve(false);
          return;
        }
        if (r1.status === 401 || r1.status === 403) {
          console.log(`[验证] 失败: 认证被拒绝（HTTP ${r1.status}）\n  可能原因: API Key${userId ? ' 或用户 ID' : ''} 不正确/已失效，请到控制台重新生成`);
          resolve(false);
          return;
        }
        if (r1.status === 404) {
          console.log('[验证] 失败: 端点不存在（HTTP 404）\n  可能原因: URL 未指向 MCP 端点（应以 /mcp 结尾）');
          resolve(false);
          return;
        }
        if (r1.status !== 200) {
          console.log(`[验证] 失败: HTTP ${r1.status}\n  ${r1.body.slice(0, 300)}`);
          resolve(false);
          return;
        }
        let init;
        try {
          init = JSON.parse(r1.body);
        } catch {
          console.log('[验证] 失败: 响应不是有效 JSON（协议不兼容？）');
          resolve(false);
          return;
        }
        if (init.error) {
          console.log(`[验证] 失败: ${JSON.stringify(init.error).slice(0, 300)}`);
          resolve(false);
          return;
        }
        const info = init.result?.serverInfo || {};
        console.log(`[验证] 服务器: ${info.name || '未知'} ${info.version || ''}`);
        console.log('[验证] 认证: 通过');
        const sid = r1.headers['mcp-session-id'];
        doRequest(rpcBody('tools/list', null, 2), sid ? { 'Mcp-Session-Id': sid } : {}, (r2) => {
          if (r2.error) {
            console.log(`[验证] 部分通过: 工具清单获取失败 → ${r2.error.message}`);
            resolve(false);
            return;
          }
          let list;
          try {
            list = JSON.parse(r2.body);
          } catch {
            console.log('[验证] 部分通过: 工具清单解析失败');
            resolve(false);
            return;
          }
          const tools = list.result?.tools;
          if (!Array.isArray(tools)) {
            console.log(`[验证] 部分通过: tools/list 异常 ${r2.body.slice(0, 200)}`);
            resolve(false);
            return;
          }
          const names = tools.map((t) => t.name);
          console.log(`[验证] 工具: ${tools.length} 个（${names.slice(0, 6).join(', ')}${names.length > 6 ? ', …' : ''}）`);
          console.log('[验证] 结论: 连接正常 ✅ 重启 DSH host 后即可在工具列表看到 mcp__* 工具');
          resolve(true);
        });
      }
    );
  });
}

/* ------------------------- DSH 重启引导 ------------------------- */
/** 重启 DSH 的建议命令（DSH 经 npx 启动，跨平台统一）。 */
function dshRestartCommand() {
  return 'npx -y @deepseek-ai/dsh --profile web';
}

/** DSH web 端口：优先 DSH_WEB_URL 环境变量，否则默认 3080。 */
function dshWebPort() {
  const m = /:(\d+)\/?$/.exec(process.env.DSH_WEB_URL || '');
  return m ? m[1] : '3080';
}

/** 执行命令并收集输出（spawn，无 shell 注入）。失败返回 {code:-1, out}。 */
function execOut(cmd, args) {
  return new Promise((resolve) => {
    const cp = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    cp.stdout.on('data', (d) => { out += d; });
    cp.stderr.on('data', (d) => { out += d; });
    cp.on('error', (e) => resolve({ code: -1, out: String(e) }));
    cp.on('close', (code) => resolve({ code, out }));
  });
}

/** 找监听指定端口的 DSH 进程 PID（Windows netstat / Unix lsof）；找不到返回 null。 */
async function findDshPid(port) {
  try {
    if (process.platform === 'win32') {
      const r = await execOut('netstat', ['-ano']);
      const line = r.out.split(/\r?\n/).find((l) => l.includes(`:${port}`) && l.includes('LISTENING'));
      const pid = line && line.trim().split(/\s+/).pop();
      return pid && /^\d+$/.test(pid) ? pid : null;
    }
    const r = await execOut('lsof', ['-ti', `tcp:${port}`]);
    const pid = r.out.trim().split(/\r?\n/)[0];
    return pid && /^\d+$/.test(pid) ? pid : null;
  } catch {
    return null;
  }
}

async function killPid(pid) {
  const r = process.platform === 'win32'
    ? await execOut('taskkill', ['/F', '/PID', pid])
    : await execOut('kill', ['-9', pid]);
  return r.code === 0;
}

/** 后台 detached 拉起重启命令（不阻塞、不接管输出）。 */
async function spawnDetached(cmdline) {
  try {
    const [cmd, ...args] = cmdline.split(/\s+/);
    const cp = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });
    cp.unref();
    return true;
  } catch {
    return false;
  }
}

/** 尝试自动重启 DSH：找进程 → kill → 重新拉起；任何一步失败则打印手动命令。 */
async function restartDsh() {
  const port = dshWebPort();
  const pid = await findDshPid(port);
  if (!pid) {
    console.log(`[重启] 未找到监听 :${port} 的 DSH 进程（无法自动重启），请手动运行:`);
    console.log(`  ${dshRestartCommand()}`);
    return;
  }
  console.log(`[重启] 找到 DSH 进程 PID=${pid}（:${port}），正在终止并重启…`);
  const killed = await killPid(pid);
  if (!killed) {
    console.log(`[重启] 终止 PID ${pid} 失败，请手动结束该进程后运行:`);
    console.log(`  ${dshRestartCommand()}`);
    return;
  }
  await spawnDetached(dshRestartCommand());
  console.log('[重启] 已发起重启，DSH 正在拉起（约数秒）。若页面未恢复，请手动运行:');
  console.log(`  ${dshRestartCommand()}`);
}

/* ------------------------- skill 安装 ------------------------- */
/** 内置 skill 清单：general 默认必装；coding/writing 备选（writing 官方文件待提供）。 */
const SKILLS = {
  general: { dir: 'timem-general-memory', builtin: true, desc: '通用/个人场景' },
  coding: { dir: 'timem-coding-memory', builtin: true, desc: 'coding 场景（仓库/调试/架构）' },
  writing: { dir: 'timem-writing-memory', builtin: false, desc: 'writing 场景（文风/受众，官方文件待提供）' },
};

/** 把选中的内置 skill 安装到 DSH skill 根目录（幂等；内容不同时询问/按 --force-skill 覆盖）。 */
async function installSkill(skillRoot, force, names) {
  for (const name of names) {
    const meta = SKILLS[name];
    if (!meta) {
      console.log(`[skill] 未知 skill: ${name}（可选: ${Object.keys(SKILLS).join(', ')}）`);
      continue;
    }
    const src = fileURLToPath(new URL(`./skills/${meta.dir}/SKILL.md`, import.meta.url));
    if (!fs.existsSync(src)) {
      console.log(`[skill] ${name}: 未内置官方 SKILL.md（${meta.desc}），跳过安装。`);
      continue;
    }
    const dest = path.join(skillRoot, meta.dir, 'SKILL.md');
    const srcContent = fs.readFileSync(src, 'utf8');
    if (fs.existsSync(dest)) {
      if (fs.readFileSync(dest, 'utf8') === srcContent) {
        console.log(`[skill] ${name}: 已安装且为最新版本（无需更新）: ${dest}`);
        continue;
      }
      console.log(`[skill] ${name}: 检测到同名 skill 内容不同: ${dest}`);
      if (process.stdin.isTTY) {
        const ans = await askLine('  覆盖为内置版本？(y/N) ');
        if (!/^y(es)?$/i.test(ans)) {
          console.log('[skill] 跳过（保留现有版本），可用 --force-skill 强制覆盖。');
          continue;
        }
      } else if (!force) {
        console.log('[skill] 非交互模式跳过覆盖（--force-skill 可强制）。');
        continue;
      }
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, srcContent, 'utf8');
    console.log(`[skill] ${name}: 已安装: ${dest}`);
  }
  console.log('[skill] 重启 DSH 后新会话将自动携带所选 skill 钩子（配合 mcp__* 工具）。');
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

  // 2) 获取 API Key
  let key = opts.key;
  if (!key) {
    key = await askSecret('请输入 TiMEM API Key（粘贴后回车，不回显）: ');
    if (!key) {
      console.error('[错误] 未输入 API Key，已取消。');
      process.exit(1);
    }
  }

  // 2b) 仅验证模式：不找配置、不写文件，只测端点/认证/工具
  if (opts.verify) {
    const ok = await verifyConnection(url, key, null);
    process.exit(ok ? 0 : 1);
  }

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
  const headers = { 'X-API-Key': key };
  console.log('等价的其他平台配置（供对照）:');
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          'TiMEM-SPACE': {
            url,
            headers,
          },
        },
      },
      null,
      2
    )
  );

  // 6) 写入后自动验证（--no-verify 跳过）：提前发现 key 错/URL 错/服务未启动
  if (!opts.noVerify) {
    console.log('');
    const ok = await verifyConnection(url, key, null);
    if (!ok) {
      console.log('\n[提示] 配置已写入，但连接验证未通过——请按上面原因修正后重跑本脚本，再重启 DSH。');
      return;
    }
  }

  // 6b) 安装配套 skill（--no-skill 跳过）：MCP 工具 + skill 才是完整钩子
  //     general 默认必装；coding/writing 通过 --skill 指定，或交互模式逐一询问（备选）
  if (!opts.noSkill) {
    let skillNames = [];
    if (opts.skill) {
      skillNames = String(opts.skill).split(',').map((s) => s.trim()).filter(Boolean);
      if (skillNames.includes('all')) skillNames = ['general', 'coding', 'writing'];
    } else {
      skillNames.push('general');
      if (process.stdin.isTTY) {
        const a1 = await askLine('是否同时安装 timem-coding-memory（coding 场景）？(y/N) ');
        if (/^y(es)?$/i.test(a1)) skillNames.push('coding');
        const a2 = await askLine('是否同时安装 timem-writing-memory（writing 场景）？(y/N) ');
        if (/^y(es)?$/i.test(a2)) skillNames.push('writing');
      }
    }
    console.log('');
    const skillRoot = opts.skillDir || path.join(process.env.DSH_HOME || path.join(os.homedir(), '.dsh'), 'skills');
    await installSkill(skillRoot, opts.forceSkill, skillNames);
  }

  // 7) 重启引导：询问是否重启 / 打印重启命令
  if (opts.noRestart) {
    console.log('\n[重启] 配置已写入。重启 DSH 使其生效（当前会话会中断）:');
    console.log(`  ${dshRestartCommand()}`);
  } else if (process.stdin.isTTY) {
    const ans = await askLine('\n需要现在重启 DSH 使配置生效吗？(y/N) ');
    if (/^y(es)?$/i.test(ans)) {
      await restartDsh();
    } else {
      console.log('\n[重启] 稍后手动重启 DSH 即可生效:');
      console.log(`  ${dshRestartCommand()}`);
    }
  } else {
    console.log('\n[重启] 非交互模式，请手动重启 DSH 使配置生效:');
    console.log(`  ${dshRestartCommand()}`);
  }
}

main().catch((err) => {
  console.error(`[错误] ${err && err.stack ? err.stack : err}`);
  process.exit(1);
});
