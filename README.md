# timemspace-dsh-mcp

一键向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 追加 **TiMEM-SPACE** 的 MCP 桥接配置。

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

本工具把这个配置以 `@deepseek-ai/dsh-mcp-client` 插件实例的形式，写入 DSH profile 的 `cordis.patch.yml`。重启 DSH host 后，工具以 `mcp__timem-space__*` 命名注册（如 `mcp__timem-space__search_memories`）。

## 前置条件

1. 注册 TiMEM-SPACE 账号：[https://space.timem.cloud/](https://space.timem.cloud/)
2. 登录后在控制台生成 **API Key**

运行脚本时按提示粘贴，或直接用 `--key` 传入。

## 快速开始

```bash
# 自动查找 cordis.patch.yml + 交互式输入 API Key（粘贴不回显）
npx --yes github:aimaoge/timemspace-dsh-mcp

# 指定配置文件 / 免交互（脚本、CI 用）
npx --yes github:aimaoge/timemspace-dsh-mcp --file /path/to/cordis.patch.yml --key sk-xxxx -y

# 只预览不落盘
npx --yes github:aimaoge/timemspace-dsh-mcp --dry-run --key sk-xxxx

# 装完 TiMEM-SPACE 后先验证 key/URL 是否可用（不修改配置）
npx --yes github:aimaoge/timemspace-dsh-mcp --verify --key sk-xxxx
```

> 每次写入配置后脚本会**自动验证**连接（认证/工具清单），key 错、URL 错、服务未启动都会给出明确提示；`--no-verify` 可跳过。
>
> 验证通过后脚本会**询问是否现在重启 DSH**：输入 `y` 自动重启（查找监听端口的 DSH 进程 → 终止 → 重新拉起 `npx -y @deepseek-ai/dsh --profile web`）；输入 `n` 或自动重启失败时，打印重启命令供手动执行。`--no-restart` 跳过询问。

> 本机 HTTPS 拉取若报 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`（TLS 被中间人拦截；SSH 通道同样会经 HTTPS 下载 tarball）：
> - PowerShell：`$env:npm_config_strict_ssl='false'; npx --yes github:aimaoge/timemspace-dsh-mcp`
> - bash/zsh：`npm_config_strict_ssl=false npx --yes github:aimaoge/timemspace-dsh-mcp`
> - 永久方案：把中间人根证书导出为 `.pem` 并设 `NODE_EXTRA_CA_CERTS=/path/to/ca.pem`

## 选项

| 选项 | 说明 |
|---|---|
| `--file <path>` | 指定 `cordis.patch.yml`（跳过自动查找） |
| `--key <key>` | 直接提供 API Key（跳过交互输入） |
| `--url <url>` | MCP 端点，默认 `https://api.space.timem.cloud/mcp/` |
| `--server-name <name>` | 工具命名空间，默认 `timem-space` |
| `--dry-run` | 只打印将要写入的内容，不修改文件 |
| `--verify` | 只验证 MCP 端点连通/认证/工具清单，不修改配置 |
| `--no-verify` | 写入配置后跳过自动验证 |
| `--no-restart` | 写入后不询问是否重启 DSH（直接打印重启命令） |
| `-y, --yes` | 跳过确认 |
| `-h, --help` | 帮助 |

## 本地开发

```bash
node dsh-add-timemspace-mcp.mjs [选项]
```

- 自动查找范围：`$DSH_HOME` → `~/.dsh` → npm npx 缓存目录；多个结果时优先 web profile
- 幂等：已存在条目时原地更新 key，不产生重复
- 跨平台：Windows 7/10/11、Linux、macOS，纯 Node 内置模块零依赖
- 保持原文件换行符（CRLF/LF）与 UTF-8 编码

## 版本

- 当前版本：**v0.3.0**，查看：`npx --yes github:aimaoge/timemspace-dsh-mcp --version`
- 固定版本（可复现）：`npx --yes github:aimaoge/timemspace-dsh-mcp#v0.3.0`
- 检查是否有新版本：`npx --yes github:aimaoge/timemspace-dsh-mcp --check-update`

> **升级机制说明**：`npx github:...` 不带 tag 时指向默认分支最新代码，但 npx 对同一 spec 有缓存，**不会自动感知新版本**——升级到最新请先 `npm cache clean --force` 再重跑；或直接用 `#vX.Y.Z` 固定到新 tag。

## License

MIT
