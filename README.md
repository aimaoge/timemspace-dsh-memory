# dsh-add-mcp-timem

一键向 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 追加 **TiMEM 记忆中枢** 的 MCP 桥接配置。

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

本工具把这个配置以 `@deepseek-ai/dsh-mcp-client` 插件实例的形式，追加到 DSH profile 的 `cordis.patch.yml`。重启 DSH host 后，工具以 `mcp__timem-space__*` 命名注册（如 `mcp__timem-space__search_memories`）。

## 特性

- **自动查找** `cordis.patch.yml`：`$DSH_HOME` → `~/.dsh` → npm npx 缓存目录；多个结果时优先 web profile
- **交互式输入 API Key**：粘贴不回显，支持退格 / Ctrl+C / Ctrl+D；非 TTY（管道）也能读
- **幂等**：已存在条目时原地更新 key，不产生重复；夹在其他条目中间也不误伤
- **跨平台**：Windows 7/10/11、Linux、macOS —— 纯 Node 内置模块，零依赖
- 自动保持原文件换行符（CRLF/LF）与 UTF-8 编码

## 用法

### 直接运行（无需安装）

```bash
# 自动查找配置 + 追问 API Key
npx --yes github:USERNAME/timem-dsh-mcp

# 指定配置文件 / 免交互（脚本、CI 用）
npx --yes github:USERNAME/timem-dsh-mcp --file /path/to/cordis.patch.yml --key sk-xxxx -y

# 只预览不落盘
npx --yes github:USERNAME/timem-dsh-mcp --dry-run --key sk-xxxx
```

`https://github.com/USERNAME/timem-dsh-mcp` 全 URL 形式同样可用。

### 本地开发

```bash
node dsh-add-mcp-timem.mjs [选项]
```

| 选项 | 说明 |
|---|---|
| `--file <path>` | 指定 `cordis.patch.yml`（跳过自动查找） |
| `--key <key>` | 直接提供 API Key（跳过交互输入） |
| `--url <url>` | MCP 端点，默认 `https://api.space.timem.cloud/mcp/` |
| `--server-name <name>` | 工具命名空间，默认 `timem-space` |
| `--dry-run` | 只打印将要写入的内容，不修改文件 |
| `-y, --yes` | 跳过确认 |
| `-h, --help` | 帮助 |

## 注意事项

- **仓库必须是公开的**，且根目录含 `package.json`（`bin` 字段）——本仓库已配好
- **npx 从 GitHub 拉取的是默认分支 HEAD**，没有版本号：想要固定版本用 `github:USERNAME/timem-dsh-mcp#v1.0.0`（tag）或 `#<commit-sha>`
- npx 有缓存，更新后若仍跑旧版：`npm cache clean --force` 后重试
- 脚本零依赖，npx 安装瞬间完成，可离线复用缓存

## 发布到 GitHub

```bash
cd timem-dsh-mcp
git init && git add -A && git commit -m "feat: dsh-add-mcp-timem v0.1.0"
gh repo create timem-dsh-mcp --public --source=. --push
```

## License

MIT
