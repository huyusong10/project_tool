# 沉浸式路径分析与流程编辑 · 验证记录

日期：2026-09-07。工作区：`D:/tools/project-manage-paths`。分支：`codex/dependency-paths`，基线：`b2ee5af`。

## 本轮交付

| 范围 | 结果 |
|---|---|
| 三处工作区 | 全局需求图、需求内部工作项图、流程模板编辑共用画布；详情与辅助面板悬浮显示。 |
| 画布操作 | 点击激活、滚轮平移、组合键缩放、中键与空格拖动、浮层独立滚动；选择不移动视口，定位与总览由用户触发。 |
| 图上编辑 | 拖线或点击连接点建线；前置勾选、标签移除和清空；聚合边展开真实关系；合法跨需求往返保留。 |
| 草稿 | 项目内共享，模板独立；会话恢复、撤销重做、未保存分析、冲突核对；保存成功才刷新正式风险、甘特与行动。 |
| 批量接口 | REST 与 MCP 共用最终网络校验。关系、估算、审计、分析版本及回执在一个事务内提交；重复批次不重复写入。 |
| 模板 | 页面编辑器、后续／并行工作、空白处创建、属性编辑、相对排期；历史偏移保留至用户核对建议。 |
| 布局 | React Flow + ELK Worker；业务连接点与路由端口分离；连通范围缓存、操作节点锚定、过期结果丢弃、节点与线路同时更新。 |

使用入口、手势和账号位置见 [TRIAL.md](TRIAL.md)。关系保存更新预测，计划日期仍需单独预览并应用。

## 检查结果

| 检查 | 结果 |
|---|---|
| `npm run verify` | 45 个测试文件、470 条测试通过；运行时、Lint、类型检查和前后端构建通过。 |
| 路径 Playwright | 本轮 35 个用例与视口组合通过：5 个基础场景覆盖 6 个桌面视口，4 个补充场景及性能采样在 office-1280 执行。重复运行不重复计数。 |
| 相关页面 Playwright | 甘特、颜色、日夜模式、表单、需求操作、刷新失败保护共 100 条通过。2 条限定其他视口的用例跳过。 |
| 真实服务冒烟 | 3220、5174 登录、全局图、内部图、模板画布、批量预览、异常样例及 390px 窄屏通过；浏览器错误为空。 |

| 验收场景 | 验证位置 |
|---|---|
| 原生多选替换；连续选择不平移；主动定位避开浮层；刷新及往返恢复 | `tests/responsive/path-analysis.pw.ts` |
| 未激活滚轮、中键、触控板滑动、键盘、浮层边界；全部主题及日夜；390px | `tests/responsive/path-analysis.pw.ts` |
| 建线、改接、移除、前置并列、部分交付、合法往返、循环端点提示 | `tests/path-api.test.ts`、`tests/responsive/path-analysis.pw.ts` |
| 批次最终合法但逐条操作会产生临时循环；失败回滚关系、估算、版本、回执 | `tests/path-api.test.ts` |
| 并发版本、越权、端点失效、跨日预览、响应丢失、重复批次 | `tests/path-api.test.ts`、`tests/responsive/path-analysis.pw.ts` |
| 草稿恢复、冲突核对、执行前处理草稿、权限变化与退出登录清理 | `tests/responsive/path-analysis.pw.ts` |
| 模板整体保存、保存响应未知、版本冲突、旧偏移兼容 | `tests/responsive/form-submission.pw.ts`、`tests/path-api.test.ts` |
| 20／80／200 节点的正交路由、穿卡、重叠、标签；连通范围合并／拆分位置稳定 | `tests/path-layout.test.ts`、`tests/graph-stability.test.ts`、`tests/responsive/path-analysis.pw.ts` |

触控板通过浏览器滚轮事件验证，键鼠通过 Playwright 输入验证。截图人工复核涵盖全局、内部、模板和窄屏；截图保存在 `.preview/qa`。

## 性能

设备：Intel Core i9-14900K，24 个逻辑处理器，32 GiB 内存，Windows 11，Node.js v24.15.0，Microsoft Edge。每组预热后顺序采样 20 次。

| 场景 | p50 | p95 | 目标 |
|---|---:|---:|---:|
| 2,000 工作项／6,000 依赖，完整快照、分析、阻塞汇总与序列化 | 60.4 ms | 68.9 ms | ≤ 1,000 ms |
| 同规模，全部工作项阻塞 | 370.9 ms | 406.3 ms | ≤ 1,000 ms |
| 浏览器 Worker，200 节点／600 边 | 1,074.5 ms | 1,178.9 ms | ≤ 2,000 ms |

服务端计时含 SQLite 读取，不含 HTTP 往返；布局计时含 Worker 往返及路由，不含资源下载与整页渲染。此结果是单机顺序采样，不是并发压测。

原始数据：[服务端](validation/immersive-server-performance.json)、[布局](validation/immersive-browser-layout.json)。

## 试用更新与数据保留

迁移前备份：`.preview/backups/pre-immersive-install-2026-09-07T14-00-24-283Z.db`。

新增迁移 `0021_cold_titania.sql` 保存轻量提交回执，不增加服务端草稿表。迁移前后逐表内容摘要一致：9 个需求、17 个工作项、14 条依赖、6 个模板、17 个模板节点均保留。

3220 使用独立数据库、备份目录、密钥及 `pm_paths_3220` Cookie。5174 代理仅指向 3220。本轮没有对 3210 执行构建、迁移或重启，没有写入主工作区数据库和配置；主目录其他任务的修改未纳入本分支。未合并、未部署到当前服务。

记录：[迁移](validation/immersive-migration.json)、[3220 冒烟](validation/immersive-smoke-3220.json)、[5174 冒烟](validation/immersive-smoke-5174.json)。

## 复验

在隔离工作区执行；Playwright 使用临时测试库与 3211 端口。

```powershell
npm run verify
npx playwright test tests/responsive/path-analysis.pw.ts
npx playwright test tests/responsive/gantt-unified.pw.ts tests/responsive/gantt-colors.pw.ts tests/responsive/day-night-motion.pw.ts tests/responsive/form-submission.pw.ts tests/responsive/requirement-actions.pw.ts tests/responsive/refresh-failures.pw.ts --project=office-1280
npx tsx scripts/benchmark-paths-server.ts
node scripts/check-paths-preview.mjs
$env:PATHS_PREVIEW_URL='http://127.0.0.1:5174'
node scripts/check-paths-preview.mjs
```
