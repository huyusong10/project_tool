# 甘特加权进度与标签验证

日期：2026-09-17。计算及展示规则见 [特性与 Phase](feature-phases.md)。

| 改动 | 结果 |
|---|---|
| 特性标签 | 当前 Phase + 特性整体百分比，包含 0%；编号不编造 |
| 加权进度 | 需求沿用工作项进度与权重，Phase 和特性逐级汇总；未排期参与，空 Phase 不给虚构权重 |
| 历史贡献 | 取消排除，归档完成保留，未安排 Phase 的需求计入特性 |
| 并行阶段 | 一个胶囊用分隔线排列；空间不足显示首阶段及 +N；浮窗展开全部 |
| 操作与布局 | 保持两层高度、最新里程碑、点击百分比更新；标签跟随日期，不吸附到视口 |

## 验证结果

| 检查 | 结果 |
|---|---|
| 类型检查、差异空白检查 | 通过 |
| 全库 ESLint | 通过 |
| 单元与服务测试 | 6 个文件、85 项通过 |
| REST、MCP、关系图摘要一致性 | 通过；进行中的需求进度与权重一致，正式摘要不被图形投影中的旧值覆盖 |
| 页面与 HTTP 回归 | 42 项通过：6 种办公视口；流程内包含 390×844 检查 |
| 隔离前后端构建 | 通过，产物位于 `.playwright`；测试使用 3271 和临时数据库，结束后服务退出 |

单元与服务覆盖 `phase-completion`、`feature-phases`、`workspace-gantt-presentation`、`workspace-rows`、`gantt-milestones`、`domain`。关系图摘要补充断言单独复跑通过。

页面覆盖 `phase-progress`、`progress-timeline`、`http-access`：0% 完整标签、Phase 子行隐藏 0%、空范围、并行进度、日周月缩放、滚动、筛选保持完整汇总、快捷更新、最新里程碑和 HTTP 登录流程。

截图：

- [特性及 Phase](../.playwright/weighted-progress-preview/phase-progress.png)
- [并行阶段](../.playwright/weighted-progress-preview/parallel-progress.png)
- [窄屏](../.playwright/weighted-progress-preview/narrow-progress.png)

## 全量检查的其他问题

`npm run lint` 的 ESLint 阶段通过，后续按钮样式检查报 `src/client/project-workspace.css:123`：游客项目列表样式未进入 application 层，并覆盖公共按钮。该段不属于本轮修改。

额外运行 `feature-overview.test.ts`：5 项通过、1 项失败。跨项目访问测试预期 403，当前游客访问入口返回 404，见该文件第 88 行；本轮未修改访问权限。

本轮未重建正式 `dist`、未操作 3210 服务，未新增数据库结构或改写业务数据。修改保留在当前工作目录，未提交或推送其他并行改动。
