# 原始需求录入与导入

原始需求直接成为需求。原文写入需求说明，出处放在来源链接；分组用于整理模块。没有工作项时直接推进需求，需要分工时添加工作项或套用模板。

## 页面操作

1. 新建需求填写标题和说明即可保存，负责人、计划可以随后补齐。
2. 导入预览支持粘贴原文，或上传 TXT、Markdown、JSON。文本按空段分成需求，首行作为标题。
3. 在预览中修改标题、原文、来源、负责人和日期。可合并、拆分、更新已有需求或跳过。
4. 核对预览后保存。重复标题须明确选择更新已有需求或另建，系统不会静默覆盖。

需求详情的资料区域保存原文与出处。旧来源条款和落实范围迁移为 `sourceNotes`，历史版本保留在数据库中；页面不再维护独立来源对象。

## 导入格式

[示例](examples/requirement-import.json)与网页、REST、MCP 使用同一契约。

| 字段 | 用法 |
|---|---|
| `formatVersion` | `2` |
| `requirements[]` | `key/title` 必填；`action` 为 `create/update/skip` |
| `background/referenceUrl` | 原始需求正文与 HTTP(S) 来源链接 |
| `acceptanceCriteria` | 完成标准 |
| `group/ownerId` | 可选分组和负责人，不自动选择人员 |
| `plannedStart/plannedEnd/durationDays` | 可选计划日期、工作日工期 |
| `existingId/expectedVersion` | 更新已有需求时必填；未提交的资料保留原值 |
| `confirmAdditional` | 重名确需另建时设为 `true` |
| `workItems[]` | 可选；每项 `key/title`，可加负责人、计划和工期 |
| `dependencies[]` | `source/target` 各含需求 `requirement` 和可选 `workItem` |

更新已有需求不同时新增工作项；需要拆分时使用工作项或图形批次工具。旧 `documents/clauses/links/deliveryScope` 输入明确拒绝。

## REST 与 MCP

REST 路径前缀为 `/api/projects/:projectId`；MCP 参数加入 `projectId`。

| REST | MCP |
|---|---|
| `GET /requirement-intake` | `get_requirement_intake` |
| `GET /requirement-groups` | `list_requirement_groups` |
| `POST /requirement-groups` | `save_requirement_group` |
| `DELETE /requirement-groups/:groupId` | `delete_requirement_group` |
| `POST /requirement-organization` | `update_requirement_organization` |
| `POST /requirement-import/preview` | `preview_requirement_import` |
| `POST /requirement-import/apply` | `apply_requirement_import` |
| `GET /requirement-import/receipts/:batchId` | `get_requirement_import_receipt` |

预览传 `{package}`。保存传回规范化 `package/expectedRevision/previewToken`，增加 UUID `batchId`。单项失败整批回滚；结果未知时先查回执，重试复用原批次和内容。并发修改后重新预览。

项目经理管理分组和导入。批量分组传 `requirements:[{id,expectedVersion}]` 与 `groupId`；`null` 表示未分组。工具、skill 和案例随仓库同步维护。
