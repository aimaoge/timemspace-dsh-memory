# timemspace-dsh-memory

一键向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 集成 **TiMEM-SPACE 记忆**：MCP 桥接 + 配套 skill + 连接验证 + 重启引导。

等价于其他平台（Cursor / Claude Code）的 `mcpServers` JSON：

```json
{
  "mcpServers": {
    "TiMEM-SPACE": {
      "url": "https://api.space.timem.cloud/mcp/",
      "headers": { "X-API-Key": "YOUR_API_KEY" }
    }
  }
}
```

本工具把配置以 `@deepseek-ai/dsh-mcp-client` 插件实例写入 DSH profile 的 `cordis.yml`，并**自动安装配套 skill**（`timem-general-memory` 等）。重启 DSH host 后：工具以 `mcp__timem-space__*` 命名注册，skill 提供"何时检索、何时写入"的钩子——**MCP 工具 + skill 才是完整记忆链路**。

## 前置条件

1. 注册 TiMEM-SPACE 账号：[https://space.timem.cloud/](https://space.timem.cloud/)
2. 登录后在控制台生成 **API Key**

运行脚本时按提示粘贴，或直接用 `--key` 传入。

## 快速开始

```bash
# 自动查找 cordis.yml + 交互式输入 API Key（粘贴不回显）
npx --yes github:aimaoge/timemspace-dsh-memory

# 指定配置文件 / 免交互（脚本、CI 用）
npx --yes github:aimaoge/timemspace-dsh-memory --file /path/to/cordis.yml --key sk-xxxx -y

# 只预览不落盘
npx --yes github:aimaoge/timemspace-dsh-memory --dry-run --key sk-xxxx

# 装完 TiMEM-SPACE 后先验证 key/URL 是否可用（不修改配置）
npx --yes github:aimaoge/timemspace-dsh-memory --verify --key sk-xxxx
```

> 每次写入配置后脚本会**自动验证**连接（认证/工具清单），key 错、URL 错、服务未启动都会给出明确提示；`--no-verify` 可跳过。
>
> 验证通过后脚本会**询问是否现在重启 DSH**：输入 `y` 自动重启（查找监听端口的 DSH 进程 → 终止 → 重新拉起 `npx -y @deepseek-ai/dsh --profile web`）；输入 `n` 或自动重启失败时，打印重启命令供手动执行。`--no-restart` 跳过询问。

## skill（记忆钩子）

**general**（`timem-general-memory`）**默认必装**：个人偏好/生活工作背景/主题回忆场景，prefer search + gated create。**coding**（`timem-coding-memory`）与 **writing**（`timem-writing-memory`）为**备选**：交互模式会逐一询问，或用 `--skill` 指定。writing 的官方文件暂未内置，选择后会提示（拿到官网文件后放入 `skills/timem-writing-memory/SKILL.md` 重新安装即可）。

## 选项

| 选项 | 说明 |
|---|---|
| `--file <path>` | 指定 `cordis.yml`（跳过自动查找） |
| `--key <key>` | 直接提供 API Key（优先级：`--key` > 环境变量 `TiMEM_API_KEY` > 交互输入） |
| `--url <url>` | MCP 端点，默认 `https://api.space.timem.cloud/mcp/` |
| `--server-name <name>` | 工具命名空间，默认 `timem-space` |
| `--dry-run` | 只打印将要写入的内容，不修改文件 |
| `--verify` | 只验证 MCP 端点连通/认证/工具清单，不修改配置 |
| `--no-verify` | 写入配置后跳过自动验证 |
| `--no-restart` | 写入后不询问是否重启 DSH（直接打印重启命令） |
| `--skill <names>` | 安装指定 skill：`general,coding,writing` 或 `all`（默认 general；交互模式逐一询问备选） |
| `--no-skill` | 跳过配套 skill 安装 |
| `--force-skill` | 覆盖已存在的同名 skill（默认会询问） |
| `--skill-dir <dir>` | 自定义 skill 安装目录（默认 `~/.dsh/skills`） |
| `--uninstall` | 卸载：移除 MCP 条目 + 删除 skill（`--keep-skill` 保留；`--skill` 指定删哪个） |
| `--update` | 检查并一键升级（发现新版自动清 npx 缓存并提示重跑） |
| `--keep-skill` | 配合 `--uninstall`：保留 skill 不删除 |
| `-y, --yes` | 跳过确认 |
| `-h, --help` | 帮助 |

> 本机 HTTPS 拉取若报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`（TLS 被中间人拦截；SSH 通道同样会经 HTTPS 下载 tarball）：
> - PowerShell：`$env:npm_config_strict_ssl='false'; npx --yes github:aimaoge/timemspace-dsh-memory`
> - bash/zsh：`npm_config_strict_ssl=false npx --yes github:aimaoge/timemspace-dsh-memory`
> - 永久方案：把中间人根证书导出为 `.pem` 并设 `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`

## 本地开发

```bash
node dsh-add-timemspace-memory.mjs [选项]
```

- 自动查找范围：`$DSH_HOME` → `~/.dsh` → npm npx 缓存目录；多个结果时优先 web profile
- 幂等：已存在条目时原地更新 key，不产生重复
- 跨平台：Windows 7/10/11、Linux、macOS，纯 Node 内置模块零依赖
- 保持原文件换行符（CRLF/LF）与 UTF-8 编码

## 维护

```bash
# 检查是否有新版本
npx --yes github:aimaoge/timemspace-dsh-memory --check-update

# 一键升级（发现新版自动清 npx 缓存并提示重跑）
npx --yes github:aimaoge/timemspace-dsh-memory --update

# 卸载：移除 MCP 条目 + 删除已装 skill
npx --yes github:aimaoge/timemspace-dsh-memory --uninstall

# 只移除 MCP 条目，保留 skill
npx --yes github:aimaoge/timemspace-dsh-memory --uninstall --keep-skill
```

## 版本

- 当前版本：**v0.6.0**，查看：`npx --yes github:aimaoge/timemspace-dsh-memory --version`
- 固定版本（可复现）：`npx --yes github:aimaoge/timemspace-dsh-memory#v0.6.0`
- 检查是否有新版本：`npx --yes github:aimaoge/timemspace-dsh-memory --check-update`

> **升级机制说明**：`npx github:...` 不带 tag 时指向默认分支最新代码，但 npx 对同一 spec 有缓存，**不会自动感知新版本**——升级到最新请先 `npm cache clean --force` 再重跑；或直接用 `#vX.Y.Z` 固定到新 tag。

## License

MIT
