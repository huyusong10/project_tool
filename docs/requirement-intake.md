# 需求分组、来源与导入

需求仍选择直接执行或按工作项执行。分组整理模块，标签表达阶段、部署侧等维度。分组没有独立进度、排期或验收状态。

## 页面操作

1. 需求管理 → 管理分组：新建、改名、排序。删除分组会将需求移入“未分组”。
2. 勾选需求 → 整理所选需求：统一调整分组、替换标签。已结束需求通过详情的纠错入口修改。
3. 导入预览 → 下载示例，上传或粘贴 Codex 整理的 JSON，点击“读取并整理”。
4. 核对来源与交付范围。可编辑标题、分组、标签、验收条件，合并或拆出交付，关联已有需求，跳过交付或填写暂缓原因。
5. 点击“预览导入”，核对重复编号、已有匹配、未安排条款、新旧内容和依赖影响，再保存。
6. 需求详情 → 来源与落实范围：查看原文、版本、实施出处；来源变化后逐条核对落实范围。

需求列表、甘特、路径都可筛选分组和标签。筛选只影响展示，交付预测使用完整项目数据。来源条款视图可以查未关联、候选、正式交付、已验收及暂缓安排；它只统计已导入条款，不提供整篇文档完成率。

## JSON 格式

可下载示例位于导入页；[同一示例文件](examples/requirement-import.json)可用于 REST 和 MCP。完整校验定义见 [intake.ts](../src/shared/intake.ts)。单包上限为 10 MB。

| 字段 | 用法 |
|---|---|
| `formatVersion` | 当前为 `1` |
| `documents[]` | `key`、`title`、HTTP(S) `url`、字符串 `version`、`clauses`；`complete` 默认 `false`（选摘） |
| `documents[].clauses[]` | `key`、`title` 必填；`section`、`externalId`、`content`、`priority` 保存原文信息 |
| `deferredReason` | 条款暂缓原因；省略保留已有原因，明确传空字符串恢复安排 |
| `requirements[]` | `key`、`title` 必填；`action` 默认 `create`，也可用 `link` 或 `skip` |
| `existingId` | `action=link` 时指定同项目系统需求 ID；保留已有需求资料与执行事实 |
| `confirmAdditional` | 来源已有交付时，确需再建需求才明确设为 `true` |
| `group`、`tags` | 新需求分组名称与标签数组；分组按项目内确切名称复用或创建 |
| `background`、`acceptanceCriteria` | 建议拆分依据和验收条件；建议在背景及标签注明“建议拆分” |
| `deliveryScope` | 默认 `candidate`；经理可明确选择 `committed` |
| `ownerId` | 可选、同项目人员系统 ID；省略不自动分配 |
| `workItems[]` | `key`、`title` 必填；可选 `ownerId`、`durationDays`。没有工作项则直接执行，有工作项则分解执行 |
| `links[]` | `requirement`（包内需求 key）、`document`（文档 key）、`clause`（条款 key）、非空 `scope`；可选 `workItem` 指向包内工作项 key |
| `dependencies[]` | `source`、`target` 各含 `requirement` 和可选 `workItem`；源对象完成后才能推进目标 |

文档 `key` 在项目内稳定，例如 `confluence:6595117`；条款 `key` 在文档内稳定。原编号可以重复，不能拿标题模糊匹配后覆盖。后续版本沿用相同 key，原文变化会追加条款版本并标记已有关联待核对。包中未出现的旧条款保留。

多个条款可指向同一个需求，同一条款也可关联多份交付。工作项出处与需求落实范围分别保存；工作量只统计实际执行对象。关联已有需求时，`workItems` 留空；引用已有工作项时，`links[].workItem` 或依赖端点的 `workItem` 使用该需求下的真实工作项 ID。

## REST 与 MCP

REST 路径以 `/api/projects/:projectId` 开头。MCP 参数加入 `projectId`，两种入口使用相同校验和业务服务。

| REST | MCP 工具 |
|---|---|
| `GET /requirement-intake` | `get_requirement_intake` |
| `GET /requirement-groups` | `list_requirement_groups` |
| `POST /requirement-groups` | `save_requirement_group` |
| `DELETE /requirement-groups/:groupId` | `delete_requirement_group` |
| `POST /requirement-organization` | `update_requirement_organization` |
| `GET /requirement-sources` | `list_requirement_sources` |
| `POST /requirement-sources` | `save_requirement_sources` |
| `POST /requirement-source-links` | `save_requirement_source_link` |
| `DELETE /requirement-source-links/:linkId` | `delete_requirement_source_link` |
| `POST /requirement-sources/clauses/:clauseId/defer` | `defer_requirement_source_clause` |
| `POST /requirement-import/preview` | `preview_requirement_import` |
| `POST /requirement-import/apply` | `apply_requirement_import` |
| `GET /requirement-import/receipts/:batchId` | `get_requirement_import_receipt` |

预览传 `{package}`，返回规范化的 `package`、`expectedRevision`、`previewToken`、提示、来源差异和交付影响。保存原样传回这三个字段，并增加 UUID `batchId`。同一批次和内容重试返回原回执。版本冲突重新预览；单项失败整批回滚。结果未知时先查回执，未找到时按原批次重试。

分组更新传 `id/name/sortOrder/expectedVersion`，新建省略 `id/expectedVersion`。批量整理传 `requirements:[{id,expectedVersion}]` 与 `groupId`、`tags` 中至少一项；`groupId:null` 移入未分组，`tags:[]` 清空标签。旧需求 REST/MCP 及共享草稿同时支持这两个可选字段。

来源维护传 `expectedRevision/documents`；版本来自来源查询的 `revision`。来源关联传 `requirementId/clauseId/scope/expectedVersion`，可加 `workItemId` 和本次核对的 `reviewedRevisionId`。需求负责人只能维护自己的关联；已结束需求修改由经理填写 `reason`。分组、来源文档、暂缓和批量导入由项目经理或管理员操作。

## 隔离试用

工作区为 `D:\tools\project-manage-intake`。首次配置执行 `node scripts/setup-intake-preview.mjs`；构建后运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-intake-preview.ps1`。脚本检查 3240、5176 端口，任一占用即报错。

- 试用：`http://127.0.0.1:3240`；开发前端：`http://127.0.0.1:5176`。
- 登录资料：`.preview/access.json`。独立 `.env`、SQLite、备份和会话不与原服务共用。
- LOG v24、ORG v18 原文：`.preview/sources/`；试录包：`.preview/log-org-import.json`；回执及项目 ID：`.preview/trial.json`。
- 试录为选摘和建议拆分；全部候选，人员、日期、工期留空。未安排 DFX 与后续功能可在来源条款视图继续整理。

`.preview/`、`.env` 和构建产物均忽略。业务迁移只新增组织和来源资料，原执行、验收、日期、工作项及交付承诺保持原值。
