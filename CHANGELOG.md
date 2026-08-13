# Changelog

All notable changes to this project are documented in this file.

## [v0.8.0] - 2026-08-14

### Fixed

- **关键修复**：新增插件实例改用 `insert` 语法写入 `cordis.patch.yml`（原直接条目是 id-targeted overlay，cordis 报 `entry not found`，导致 mcp-client 从未被加载、MCP 工具始终不可用）
- `--uninstall` 尊重 `--no-skill`（卸载时不删除与其他平台共享的 skill）

## [v0.7.0] - 2026-08-14

### Fixed

- 目标配置文件统一为 `cordis.yml`（过渡版本；v0.8.0 已改用 `insert` 语法写回官方用户层 `cordis.patch.yml`）

## [v0.6.0] - 2026-08-14

### Added

- `--uninstall`：卸载——移除 MCP 条目 + 删除已装 skill（`--keep-skill` 保留；`--skill` 指定删哪个），幂等
- `--update`：检查并一键升级（发现新版自动清 npx 缓存并给出重跑命令）
- 环境变量 `TiMEM_API_KEY`（优先级：命令行 > 环境变量 > 交互输入），避免密钥明文进命令历史
- 配置写入原子化（临时文件 + rename），杜绝崩溃损坏 `cordis.patch.yml`
- `--help` 按 安装 / 验证 / 维护 分组

### Fixed

- 配置写入中途崩溃可能损坏 YAML 的问题

## [v0.5.0] - 2026-08-14

### Changed

- 仓库更名 `timemspace-dsh-mcp` → `timemspace-dsh-memory`（包名 / bin / 脚本 / remote 同步）

### Added

- skill 多选安装：`--skill general,coding,writing|all`，交互模式逐一询问备选
- 内置 `timem-coding-memory` skill（general 默认必装；writing 官方文件待提供，留位）

## [v0.4.0] - 2026-08-14

### Added

- 写入配置后自动安装配套 `timem-general-memory` skill（`--no-skill` / `--force-skill` / `--skill-dir`）

## [v0.3.0] - 2026-08-14

### Added

- 写入 + 验证通过后询问是否重启 DSH：`y` 自动重启（找监听端口进程 → 终止 → 重新拉起），`n` 或失败打印手动命令；`--no-restart` 跳过

## [v0.2.0] - 2026-08-14

### Added

- `--verify` 连接验证（写入后自动验证 + 独立验证模式），错误原因可读化（401 / 404 / 连不上）
- `--version` / `--check-update`（对比 GitHub 最新 tag）

## [v0.1.0] - 2026-08-14

### Added

- 初始版本：自动查找 `cordis.patch.yml`、交互式输入 API Key（不回显）、幂等追加/更新配置
- 跨平台（Windows 7+/Linux/macOS）、零 npm 依赖
