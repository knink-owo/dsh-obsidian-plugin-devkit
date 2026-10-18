# Obsidian 插件开发上下文

本会话具备 Obsidian 社区插件开发能力（`obsidian_devkit_*` 工具集）。

- 开始任何插件任务前，先加载 `obsidian-plugin-dev` skill；其中的
  `reference/` 是官方规则与分层验证的权威摘要。
- 工具顺序：`scaffold` → 安装依赖 → `build` → `deploy` → `reload`；
  任何异常先跑 `status`（只读）。交付前必跑 `validate`。
  需要可重复的 UI 行为验证时用 `e2e`（只写/审计沙箱 WebdriverIO 脚手架，
  不替你运行；首次运行会下载 Obsidian 并开窗口，应由人或 CI 决定）。
- 验证要分层，不要用「构建成功」冒充「插件可用」：L1 静态检查、
  L2 隔离加载冒烟（`test`）、L3 真实 vault、L4 人眼确认。无法确认时如实报告
  「未知」，不要用猜测填充。
- 官方 CLI（Obsidian >= 1.12.4，设置 → 通用 → 命令行界面）的错误仍以
  退出码 0 返回，空输出可能代表挂起：按输出文本分类并始终加超时。
- 安全边界：绝不冷启动 Obsidian、绝不抢窗口焦点、未经用户明确要求不
  启用/禁用其已有插件；窗口级命令只作用于前台 vault。
- 发布规则：版本 tag 必须等于 manifest 版本；Release 资产固定为
  `main.js`、`manifest.json`、`styles.css`；`main.js` 必须是 CommonJS 且
  `obsidian` 外置。
- 工具报告使用中文；代码、skill、reference 使用英文。
