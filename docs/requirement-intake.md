# 原始需求录入与导入

原始需求直接成为需求。原文写入需求说明，出处放在来源链接；分组用于整理模块，也可记录总体预期与人工判断。没有工作项时直接推进需求，需要分工时添加工作项或套用模板。

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

## 总体进展

项目进展页按分组展示大致预期、进展简述、人工判断和最近评估时间。项目经理、管理员编辑，项目成员查看。判断包括待评估、基本符合、有偏差、需要调整；不要求填写日期。

系统汇总当前分组中未归档、未取消的需求，显示完成、进行中、延期、排期不完整、近七天完成数量及最近三条进展。近七天含今天，按业务日期和实际完成日期计算。需求变化不会覆盖人工判断和评估时间。

`GET /api/projects/:projectId/group-overview`（MCP：`get_group_overview`）返回 `asOfDate/recentFrom/groups/ungroupedCount`。分组含原资料、`overview`、`assessedAt/assessedBy/assessedByName`、`counts/requirements/recentUpdates`。

现有分组保存接口接受可选 `overview`，提供时须完整传入下列字段，文字可为空且各最多 2000 字：

```json
{"expectation":"本季度具备试用条件","progressSummary":"基础授权完成","assessment":"on_track","note":"复杂权限场景稍慢，暂不影响试用"}
```

`assessment` 为 `pending/on_track/off_track/needs_adjustment`。服务器记录当前账号和评估时间。省略 `overview` 时保留已有评估，重命名和排序不刷新评估时间。更新仍传 `expectedVersion`；冲突或结果未知时先读取最新资料，网页保留输入供核对，修改前后内容保存在操作日志。
