# 首版验证记录

验证日期：2026-09-07。工作区：`D:/tools/project-manage-paths`，分支：`codex/dependency-paths`。

## 功能与回归

| 检查 | 结果 |
|---|---|
| `npm run verify` | 运行时检查、Lint、44 个测试文件 / 465 条测试、类型检查、前后端构建通过。最终展示文案调整后再次通过 Lint、类型检查和构建。 |
| 路径页面 Playwright | 6 个桌面视口合计 19 条通过；5 条跳过是重复视口上的性能采样，仅在固定视口执行。 |
| 现有页面相关 Playwright | 甘特、主题、日夜、表单、需求操作和刷新失败保护共 100 条最终通过，分批运行并按用例及视口去重。2 条限定其他视口的用例在 office-1280 跳过。 |
| 真实试用访问 | 3220 与 5174 登录、全局图、需求图、异常样例、390px 窄屏均通过；浏览器错误为空，Cookie 为 `pm_paths_3220`。 |
| 重复启动与样例生成 | 重复启动识别已有隔离进程；重复生成保留试用修改。 |

| 验收范围 | 验证位置 |
|---|---|
| 串行、并行、多前置、并列关键分支、部分交付、合法跨需求往返 | `tests/paths.test.ts`、`tests/path-api.test.ts` |
| 未知解阻、缺失工期、过期预测、待验收、取消及返工 | `tests/paths.test.ts`；异常样例实际页面 |
| 完成与开始同日、阻塞暂停人工工期、等待不消耗工期 | `tests/paths.test.ts`、`tests/path-api.test.ts` |
| 模板关系复制及实例化、历史日期保留、核对启用 | `tests/path-api.test.ts`；原有模板与迁移测试 |
| REST / MCP 并发反向关系、权限、旧排期预览及跨日失效 | `tests/path-api.test.ts` |
| 全局→需求→外部交付→返回；刷新保留目标、选择、筛选；局部目标不改变项目风险 | `tests/responsive/path-analysis.pw.ts` |
| 真实增删关系和工期后重算、主题变化位置稳定、窄屏内容完整 | `tests/responsive/path-analysis.pw.ts` |
| 风险高→中→待评估→低、关键阻塞优先、结束需求置后、刷新保留主动排序 | `tests/responsive/gantt-unified.pw.ts` |
| 20 / 80 / 200 节点、分叉汇合、不同卡片尺寸、正交方向及穿卡检查 | `tests/path-layout.test.ts`；浏览器 Worker 布局和标签遮挡检查 |

相关回归同时修复两处已有边界问题：日期超出日历范围时显示回退提示；归档响应未知时，不将恢复后再次归档误判为本次操作成功。

## 性能

设备：Intel Core i9-14900K，24 个逻辑处理器，32 GiB 内存，Windows 11（10.0.22631），Node.js v24.15.0，浏览器 Microsoft Edge。每组预热后顺序采样 20 次。

| 场景 | p50 | p95 | 最大值 | 目标 |
|---|---:|---:|---:|---:|
| 2,000 工作项 / 6,000 依赖：完整快照、单目标分析、阻塞汇总、JSON 序列化 | 55.8 ms | 63.1 ms | 63.5 ms | ≤ 1,000 ms |
| 同规模，全部工作项阻塞 | 352.6 ms | 360.9 ms | 404.6 ms | ≤ 1,000 ms |
| 浏览器 Worker：200 节点 / 600 边 | 1,235.4 ms | 1,369.1 ms | 1,400.6 ms | ≤ 2,000 ms |

服务端计时包含 SQLite 读取和序列化，不含 HTTP 往返；布局计时包含 Worker 请求往返和路由计算，不含资源下载及整页渲染。结果来自此设备，不代表所有客户端或并发负载。

原始数据：[服务端](validation/server-performance.json)、[浏览器布局](validation/browser-layout.json)。独立服务冒烟记录：[3220](validation/smoke-3220.json)、[5174](validation/smoke-5174.json)。截图保存在工作区 `.preview/qa`。

## 复验命令

```powershell
npm run verify
npx playwright test tests/responsive/path-analysis.pw.ts
npx playwright test tests/responsive/gantt-unified.pw.ts tests/responsive/gantt-colors.pw.ts tests/responsive/day-night-motion.pw.ts tests/responsive/form-submission.pw.ts tests/responsive/requirement-actions.pw.ts tests/responsive/refresh-failures.pw.ts --project=office-1280
npx tsx scripts/benchmark-paths-server.ts
node scripts/check-paths-preview.mjs
$env:PATHS_PREVIEW_URL='http://127.0.0.1:5174'
node scripts/check-paths-preview.mjs
```

## 试用边界

预测使用当前系统工作日日历；超出法定日历覆盖范围显示回退提示。未知解阻、取消前置或等待验收会使受影响目标显示“待确认”。甘特排序选择在当前页面的数据刷新中保留。首版没有资源调平、手工布图和历史趋势。

当前 3210 服务未重启，数据库、构建和启动配置未修改。本分支不合并、不部署到当前服务。
