# 原始需求录入与导入

原始需求直接成为需求。原文写入需求说明，出处放在来源链接；特性用于维护长期目标、当前预期和人工判断。没有工作项时直接推进需求，需要分工时添加工作项或套用模板。

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

特性规划页和路径分析按特性展示大致预期、进展简述、人工判断和最近评估时间。项目经理、管理员编辑，项目成员查看。判断包括待评估、基本符合、有偏差、需要调整；不要求填写日期。

系统汇总当前分组中未归档、未取消的需求，显示完成、进行中、延期、排期不完整、近七天完成数量及最近三条进展。近七天含今天，按业务日期和实际完成日期计算。需求变化不会覆盖人工判断和评估时间。

`GET /api/projects/:projectId/group-overview`（MCP：`get_group_overview`）返回 `asOfDate/recentFrom/groups/ungroupedCount`。分组含原资料、`overview`、`assessedAt/assessedBy/assessedByName`、`counts/requirements/recentUpdates`。

现有分组保存接口接受可选 `overview`，提供时须完整传入下列字段，文字可为空且各最多 2000 字：

```json
{"expectation":"本季度具备试用条件","progressSummary":"基础授权完成","assessment":"on_track","note":"复杂权限场景稍慢，暂不影响试用"}
```

`assessment` 为 `pending/on_track/off_track/needs_adjustment`。服务器记录当前账号和评估时间。省略 `overview` 时保留已有评估，重命名和排序不刷新评估时间。更新仍传 `expectedVersion`；冲突或结果未知时先读取最新资料，网页保留输入供核对，修改前后内容保存在操作日志。


## 特性规划与关系图

原分组记录直接作为特性，ID、groupId 和旧工具名保留。`/features` 维护长期目标、评估、排序与归档；`/paths` 默认显示特性关系图，依次下钻到需求与工作项。首页保留执行进展。

`save_requirement_group` 新增可选 `description`（长期目标与范围，最多 10000 字），省略时保留；基础资料保存省略 `overview`，评估单独保存。读取记录增加 `description/archivedAt`。`list_requirement_groups`、`get_group_overview` 的 `state` 为 `active`（默认）、`archived` 或 `all`。

以下 REST 路径均带 `/api/projects/:projectId` 前缀：

| REST | MCP | 行为 |
|---|---|---|
| `POST /requirement-groups/:groupId/archive` | `archive_requirement_group` | 所属需求均完成、取消或移出后归档 |
| `POST /requirement-groups/:groupId/restore` | `restore_requirement_group` | 恢复特性，保留关联与人工资料 |
| `GET /requirement-groups/:groupId/requirements` | `get_feature_requirements` | `state=current/archived`，`page/pageSize` 分页历史摘要；`groupId=ungrouped` 为未归属集合 |
| `GET /feature-relations` | `list_feature_relations` | 读取人工规划关系，包含归档特性保留的边 |
| `POST /feature-relations` | `save_feature_relation` | `sourceFeatureId/targetFeatureId/note`；修改还需 `id/expectedVersion` |
| `DELETE /feature-relations/:relationId` | `delete_feature_relation` | 仅删除人工关系，传 `expectedVersion` |

归档、恢复、删除特性均传 `expectedVersion`。旧删除接口现在拒绝有任何需求（包含归档、取消项）或规划连线的特性。需求批量归属调整允许未归档的终态需求，不改变状态、完成日期或排期。归档特性不能接收新的需求；需求重新开启前先恢复特性或移出归属。

`get_path_graph` 增加 `view=features` 和 `view=feature&featureId=...`，后者支持 `ungrouped`。旧 `view=project/requirement` 保持原义。规划关系为虚线，实际依赖为实线；同向关系合并展示，返回 `planningRelationIds` 与 `dependencyIds` 供分别查询。人工规划禁止循环（含归档边），实际依赖汇总后的双向关系不等于执行循环。

布局范围新增 `features` 和 `feature:ID`（含 `feature:ungrouped`），通过现有依赖批次的 `changes.layouts` 保存。规划边独立存储，不参与执行预测或排期。日志用稳定特性 ID 记录修改前后内容；不增加独立历史版本页面。

## 连贯画布操作

`/paths` 的“特性总览”和“全部需求”是并列入口。单击查看摘要，双击特性进入需求图，双击需求进入工作项图。面包屑只显示当前层级，返回恢复位置、缩放和选择；旧需求路径链接转入同一画布。

规划关系、执行依赖、对象修改和各层布局共用草稿，一次保存。特性目标与人工评估仍在 `/features` 分开保存，详情使用“目标与范围 / 进展评估 / 关联需求”页签；归档、恢复和删除放在更多操作中。

批次预览与提交接口增加可选 `changes.featureRelations`，分别用 `op=create/update/delete` 表示创建、更新说明和删除。已有关系传 `expectedVersion`，新关系传临时 `id`。保存失败不会部分提交；未知结果先核对批次回执。单条规划关系接口和旧请求保持兼容。
