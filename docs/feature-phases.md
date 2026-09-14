# 特性、Phase 与需求执行阶段

| 层级 | 主要展示 | 维护方式 |
|---|---|---|
| 特性 | 目标、文档、各 Phase 交付情况 | 按反馈逐步增加 Phase |
| Phase | 交付范围、状态、需求阶段分布、日期、关注说明 | 状态自动计算，交付由项目经理确认 |
| 需求 | 当前阶段及阶段内工作进度 | 不要求具备完整流程或里程碑 |
| 工作项 | 自身执行状态和百分比 | 执行人员更新 |

首页提供项目交付表格和关系图；`/features` 转到表格，`/paths` 转到关系图，见[项目交付工作区](delivery-workspace.md)。`/execution` 保留需求甘特和执行指标。特性不显示总百分比，人工评估仍可维护。文档链接使用 `referenceLinks:[{title,url}]`，支持 HTTP／HTTPS。

## Phase

Phase 保存 `name/scope/sortOrder/targetDate/note`。名称默认建议 Phase 1、Phase 2，可以修改；范围与日期可留空。各 Phase 可以并行。

| 状态 | 判定 |
|---|---|
| `planning` 规划中 | 尚无有效需求开始执行 |
| `in_progress` 推进中 | 已有需求开始或完成，仍有有效需求未完成 |
| `ready` 待交付 | 至少一个有效需求，且全部完成 |
| `delivered` 已交付 | 项目经理确认实际交付 |

取消需求不计入交付成果。归档的已完成需求仍计入。空 Phase 和全部取消的 Phase 不能交付。

需求使用 `featureId/phaseId`，每条需求属于一个特性；新建未指定时归入“其他特性”。Phase 必须属于所选特性。需求可以只关联特性，显示“未安排 Phase”。跨 Phase 的工作拆为独立需求，保留原编号和来源。

Phase 开始推进后，调整范围、目标日期和需求归属须传 `reason`。首次推进事实由 `startedAt` 保留，即使后来移空也不取消原因要求。批量安排校验所有需求版本，任意一条冲突则整批回滚。

确认交付时重新检查有效需求，保存实际日期及名称、范围、目标日期、需求清单和完成标准快照。实际交付不能晚于今天或早于需求实际完成日期。已交付范围只读；重新打开须填写原因，旧记录保留。重新打开后再通过需求已有返工操作继续执行。

只有无关联需求且没有交付历史的空 Phase 可以删除。延期与关注说明单独显示，不改变执行阶段颜色。

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
| `POST /feature-phases/:phaseId/deliver` | `deliver_feature_phase` | `expectedVersion/deliveredAt` |
| `POST /feature-phases/:phaseId/reopen` | `reopen_feature_phase` | `expectedVersion/reason` |
| `POST /requirement-placement` | `update_requirement_placement` | `requirements:[{id,expectedVersion}],featureId,phaseId,reason` |
| `POST /requirements/:requirementId/test-submission` | `record_test_submission` | `expectedVersion/actualDate/content` |

Phase 写入限项目经理或管理员。REST、MCP、网页共享计算和权限检查，变更接入项目刷新和操作日志。

## 迁移与预览

迁移 0031 增加 Phase、交付快照、阶段分类和节点类型；0032 统一当前索引与触发器名称；0033 将无特性需求归入普通的“其他特性”，记录审计并增加需求版本。旧迁移文件保持原样，既有 ID、关联、布局、评估和历史保留。旧业务接口及字段停用，不提供别名。

旧数据不自动创建 Phase，不从标题推断分期。阶段与节点类型只按迁移中的标准名称白名单回填，其余未分类。启动和备份恢复共用归属、交付、执行状态及外键检查。

导入格式为版本 3，使用 `feature/phase` 名称及 `workItems[].workStage`。只有明确提供 Phase 名称才创建或复用。已开始 Phase 的归属调整传原因。

浏览器加载时迁移旧归属字段和未提交的版本 2 导入草稿。结果未知的批次保留原提交内容，先查询回执；不将改写后的数据当作原批次重试。

隔离 worktree：`D:\tools\project-manage-phases`，分支 `codex/feature-phases`，预览 `http://127.0.0.1:3260`。数据库、备份、会话及固定构建快照位于 `.preview`。真实数据库仅用于一致性快照迁移验证，示例另存。

```powershell
npx tsx scripts/prepare-phases-preview.mjs
npx tsx scripts/seed-phases-preview.mjs
pwsh -NoProfile -File scripts/start-phases-preview.ps1
```

完整验证前将 `CODEX_HOME` 指向 `.preview/codex-home`，将 `PLAYWRIGHT_PORT` 指向未占用的测试端口；运行 `npm run verify`。启动脚本在 3260 已占用时退出，不停止已有服务。正式合并与服务升级单独安排。
