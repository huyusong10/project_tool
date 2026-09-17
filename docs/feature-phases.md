# 特性、Phase 与需求执行阶段

| 层级 | 主要展示 | 维护方式 |
|---|---|---|
| 特性 | 目标、文档、各 Phase 交付情况 | 按反馈逐步增加 Phase |
| Phase | 交付范围、状态、需求阶段分布、日期、关注说明 | 状态完全由需求自动汇总 |
| 需求 | 当前阶段及阶段内工作进度 | 不要求具备完整流程或里程碑 |
| 工作项 | 自身执行状态和百分比 | 执行人员更新 |

首页提供项目交付表格和关系图；`/features` 转到表格，`/paths` 转到关系图，见[项目交付工作区](delivery-workspace.md)。`/execution` 保留需求甘特和执行指标。进展表显示特性当前已明确范围的加权完成度，人工评估仍可维护。文档链接使用 `referenceLinks:[{title,url}]`，支持 HTTP／HTTPS。

## Phase

Phase 保存 `name/scope/sortOrder/targetDate/note`。名称默认建议 Phase 1、Phase 2，可以修改；范围与日期可留空。各 Phase 可以并行。

更新时省略 `scope/sortOrder/targetDate/note` 保留原值；空字符串清空文字，`targetDate:null` 清空日期。只改名称或备注不会触发范围、日期变更校验。

| 状态 | 判定 |
|---|---|
| `planning` 待规划 | 没有有效需求 |
| `not_started` 未开始 | 有效需求均未开始 |
| `in_progress` 推进中 | 已有需求开始或完成，仍有有效需求未完成 |
| `completed` 已完成 | 至少一个有效需求，且全部完成 |

取消需求不计入交付成果。归档的已完成需求仍计入。空 Phase 和全部取消的 Phase 显示待规划。

进展表的特性、Phase 使用一条实际槽，不把下属需求排期汇总成独立计划，也不在这两级突出延期。已有目标日期保留在悬浮明细中。实际开始取有效需求最早实际开始，进行中延伸到统计日，完成后停在实际完成日期；缺失日期不使用目标或审计时间补齐。

实际槽末端使用完整胶囊。特性显示 `Phase 1 · 42%`：编号表示当前推进批次，百分比表示特性整体完成度；0% 也保留完整标签。Phase 子行显示自身百分比，0% 隐藏。多 Phase 并行加“+N”。无进行中 Phase 时显示最近排序的已完成 Phase，再回退到首个已有需求的 Phase；不编造编号。完整名称、各 Phase 进度和日期放在浮窗中。标签随时间轴移动；没有实际日期时在统计日显示，不画实际条。

| 汇总 | 计算 |
|---|---|
| 需求进度 | 沿用工作项加权进度及已有拆分基准；不是当前阶段百分比 |
| 需求权重 | 有效工作项权重之和；直接执行取已填工期，无估算默认 1 |
| Phase 完成度 | `Σ(需求进度 × 需求权重) / Σ需求权重` |
| 特性完成度 | Phase 按所含需求总权重汇总；尚未安排 Phase 的需求一并计入 |

特性直接汇总需求加权值，等价于按 Phase 工作量加权，避免中间取整误差。百分比四舍五入，尚有未完成需求时最高 99%。修改日历排期不改变已记录权重。未排期需求参与计算，取消需求排除，归档完成需求保留。空 Phase 没有已知工作量，不计入分母，浮窗注明待细化数量；100% 只表示当前明确范围完成。新增范围或返工后比例可以下降。

实际及比例使用正式记录，筛选和结构草稿不改变进展表统计口径。REST 和 MCP 共用 `completion:{total,completed,inProgress,notStarted,percent,weight}`；特性总览也返回该字段。需求摘要返回 `progress/progressWeight`，Phase 保留 `actualStart/observationEnd/completedAt`。

需求、工作项固定为计划／实际两层。阶段与百分比合成一个胶囊，贴在实际条末端，点击仍可更新进度。并行阶段显示 `设计 80% │ 开发 17%`；可见时间轴空间不足时显示 `设计 80% · +1`，悬浮查看全部，不隐藏首个阶段。计划线、延期边框和完成色保留，不重复显示待排期、延期、已完成文字。每条需求仅显示当前执行轮次最近实际达成的里程碑，名称和历史在浮窗内查看。其他需求和未分派阶段只作为目录，不画汇总条。

需求使用 `featureId/phaseId`，每条需求属于一个特性；新建未指定时归入“其他特性”。Phase 必须属于所选特性。需求可以只关联特性，显示“未安排 Phase”。跨 Phase 的工作拆为独立需求，保留原编号和来源。

Phase 开始推进后，调整范围、目标日期和需求归属须传 `reason`。首次推进事实由 `startedAt` 保留，即使后来移空也不取消原因要求。批量安排校验所有需求版本，任意一条冲突则整批回滚。

Phase 不提供确认交付或重新打开操作。全部有效需求完成时自动完成；新增未完成需求、移入未完成需求或需求返工后自动重算。`completedAt` 取有效需求最晚实际完成日期；日期不全时留空。汇总使用完整需求数据，不受页面筛选影响。完成后仍可编辑 Phase 和维护需求归属。旧交付快照保留为历史，不再限制当前操作。

只有无关联需求且没有交付历史的空 Phase 可以删除。未完成且超过目标日期的 Phase 显示逾期；空 Phase 和已完成 Phase 不显示当前逾期。

## 执行阶段

工作项与模板元素可选 `workStage`：

| 值 | 文字 | 颜色 |
|---|---|---|
| 未开始／未分类 | 未开始；进行中及当前工作名称 | 灰 |
| `analysis` | 分析设计中 | 蓝 |
| `development` | 开发中 | 青 |
| `integration` | 联调中 | 紫 |
| 提测事实 | 已提测 | 橙 |
| `testing` | 测试中 | 品红 |
| 已完成／已交付 | 终态文字 | 绿 |
| `other` | 原执行状态及当前工作名称 | 灰 |

执行进展与排期甘特使用旧版配色：各执行阶段共用蓝色，完成为绿色、取消为灰色，延期单独描边。甘特内的阶段标签使用中性文字，保留阶段名称及阶段内百分比；其他视图的阶段色仍按上表显示。

`executionStage` 返回 `key/label/tone/stages/currentWork`。阶段内百分比沿用有效工作项的权重，取消项不计入。需求的原始 `progress` 仍供分析使用，主列表不显示该总百分比。

- 明确阶段正在执行时显示该阶段；开发和测试同时执行时显示“开发中 · 部分测试”，并分别显示进度。
- 没有执行中阶段时显示本轮已达成的节点，不推断下一阶段已经开始。
- 无分类、无里程碑和无工作项均可正常执行。没有测试工作不等于已测试或无需测试。
- 完成、取消优先显示终态。返工记录 `stageResetAt`，之前的节点保留为历史。
- Phase 每条需求只计入一个阶段桶，并行需求计入“并行推进”。点击数量查看该桶的需求，包括归档完成项。

里程碑 `milestoneKind` 为 `ordinary/analysis_completed/design_completed/test_ready/test_submitted/test_passed`。`test_ready` 是“提测就绪”；`test_submitted` 是“已提测”，使用人工确认，不随前置完成自动达成。

需求负责人或项目经理可“记录提测”，填写 `actualDate` 和可选 `content`。系统创建并达成人工节点，无需先补流程。测试工作已开始时直接显示测试阶段。返工后可记录新一轮提测。

## REST 与 MCP

下表 REST 均带 `/api/projects/:projectId` 前缀。

| REST | MCP | 写入字段 |
|---|---|---|
| `GET /feature-overview` | `get_feature_overview` | — |
| `GET /feature-phases?featureId=...` | `list_feature_phases` | — |
| `POST /features/:featureId/phases` | `save_feature_phase` | `name/scope/targetDate/note/sortOrder`；修改加 `id/expectedVersion` |
| `DELETE /feature-phases/:phaseId` | `delete_feature_phase` | `expectedVersion` |
| `POST /requirement-placement` | `update_requirement_placement` | `requirements:[{id,expectedVersion}],featureId,phaseId,reason` |
| `POST /requirements/:requirementId/test-submission` | `record_test_submission` | `expectedVersion/actualDate/content` |

Phase 写入限项目经理或管理员。REST、MCP、网页共享计算和权限检查，变更接入项目刷新和操作日志。

## 迁移与预览

迁移 0031 增加 Phase、交付快照、阶段分类和节点类型；0032 统一当前索引与触发器名称；0033 将无特性需求归入普通的“其他特性”，记录审计并增加需求版本。0036 移除旧交付锁，仅保留项目与特性归属校验。旧迁移文件保持原样，既有 ID、关联、布局、评估和历史保留。旧业务接口及字段停用，不提供别名。

旧数据不自动创建 Phase，不从标题推断分期。阶段与节点类型只按迁移中的标准名称白名单回填，其余未分类。启动和备份恢复共用归属、历史快照、执行状态及外键检查。

导入格式为版本 3，使用 `feature/phase` 名称及 `workItems[].workStage`。只有明确提供 Phase 名称才创建或复用。已开始 Phase 的归属调整传原因。

浏览器加载时迁移旧归属字段和未提交的版本 2 导入草稿。结果未知的批次保留原提交内容，先查询回执；不将改写后的数据当作原批次重试。

隔离 worktree：`D:\tools\project-manage-phases`，分支 `codex/feature-phases`，预览 `http://127.0.0.1:3260`。数据库、备份、会话及固定构建快照位于 `.preview`。真实数据库仅用于一致性快照迁移验证，示例另存。

```powershell
npx tsx scripts/prepare-phases-preview.mjs
npx tsx scripts/seed-phases-preview.mjs
pwsh -NoProfile -File scripts/start-phases-preview.ps1
```

完整验证前将 `CODEX_HOME` 指向 `.preview/codex-home`，将 `PLAYWRIGHT_PORT` 指向未占用的测试端口；运行 `npm run verify`。启动脚本在 3260 已占用时退出，不停止已有服务。正式合并与服务升级单独安排。
