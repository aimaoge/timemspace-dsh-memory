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

## 快速开始

```bash
# 自动查找 cordis.patch.yml + 交互式输入 API Key（粘贴不回显）
npx --yes github:aimaoge/timemspace-dsh-mcp

# 指定配置文件 / 免交互（脚本、CI 用）
npx --yes github:aimaoge/timemspace-dsh-mcp --file /path/to/cordis.patch.yml --key sk-xxxx -y

# 只预览不落盘
npx --yes github:aimaoge/timemspace-dsh-mcp --dry-run --key sk-xxxx
```

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

## License

MIT
