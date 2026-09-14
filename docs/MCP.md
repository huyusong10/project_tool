# MCP 业务查询与拓扑图

端点为 `/mcp`，使用无状态 HTTP POST 和个人 Token。Token 继承账号的项目权限。成功数据在 `structuredContent.result`；业务错误返回 `isError: true`、`structuredContent.error` 和 `statusCode`。

Agent 录入流程维护在 [project-manage-intake skill](../skills/project-manage-intake/SKILL.md)。修改本文涉及的工具、参数或业务口径时，同步更新 skill；生产构建会安装仓库中的版本。

## 选择工具

| 任务 | 工具 | 返回 |
|---|---|---|
| 找项目、人员、成员 | `list_projects`、`list_people`、`list_project_members` | 对应列表 |
| 按条件分页查需求 | `query_requirements` | 分页对象，默认省略工作项 |
| 读取项目全部需求和工作项 | `list_requirements` | 原有数组，每项包含 `workItems` |
| 读取需求及完整进展 | `get_requirement` | 需求、工作项、里程碑、进展和指标 |
| 按 ID 读取工作项 | `get_work_item` | 执行、分工、计划、预计完成及版本 |
| 按人、时间或状态查工作项 | `list_work_items` | 分页对象 |
| 查询项目进展历史 | `list_progress_updates` | 分页对象及历史快照编号 |
| 查询我的工作 | `get_my_work` | 当前账号负责和协作的工作、近期进展 |
| 查询问题和处理历史 | `list_issues`、`get_issue` | 分页问题／单个问题及历史 |
| 查询异常、看板和业务统计 | `list_action_items`、`dashboard_summary`、`query_analytics` | 业务数据 |
| 判断是否需要刷新项目 | `get_project_change_version` | `version`，包括业务日期及共享布局变化 |
| 查询完整执行网络 | `get_path_analysis` | `nodes`、`edges`、依赖、关键性、余量、风险、预测 |
| 查询拓扑视图或导出图 | `get_path_graph` | `cards`、`links`、范围数量、已保存布局，可附自动布局／SVG |
| 整理特性与导入原始需求 | `get_requirement_intake`、`preview_requirement_import`、`apply_requirement_import` 等 | [工具列表与导入契约](requirement-intake.md#rest-与-mcp) |

`get_my_work` 按 Token 绑定账号查询；它的近期进展是该账号发布的最近 8 条。项目历史应使用 `list_progress_updates`。

## 分页与筛选

新分页工具返回 `items`、`total`、`page`、`pageSize`、`pages`。默认每页 50 条，最多 100 条。超出末页返回空 `items`。上述分页查询必须指定 `projectId`，跨项目查询时逐个查询有权访问的项目。

| 工具 | 筛选参数 |
|---|---|
| `query_requirements` | `q`、`featureId`、`ownerId`、`participantId`、`status`、`view=delayed/high_risk`、`from/to`、`includeDeleted`；`includeWorkItems=true` 附带工作项 |
| `list_work_items` | `requirementId`、`q`、`ownerId`、`participantId`、`status`、`active`、`overdue`、`unassigned`、`from/to` |
| `list_progress_updates` | `requirementId`、`workItemId`、`authorAccountId`、`eventType`、正文关键词 `q`、`from/to`、`snapshot` |

`ownerId` 只匹配负责人。工作项的 `participantId` 匹配负责人或协作者；需求的 `participantId` 匹配需求负责人或其工作项参与人。需求关键词匹配标题、需求说明、完成标准及负责人姓名；工作项关键词匹配工作项或所属需求标题。

需求和工作项的 `from/to` 匹配与指定日期范围相交的计划。只有一个计划日期时按该日期匹配；没有计划日期时不匹配日期筛选。进展的 `from/to` 按北京时间自然日匹配发布时间，包含首尾日。

例如，查询某人本周参与的未完成工作项：

```json
{"projectId":"项目ID","participantId":"人员ID","active":true,"from":"2026-09-07","to":"2026-09-13","page":1,"pageSize":50}
```

进展按发布时间、写入顺序倒序排列。首次响应返回 `snapshot`，后续页原样传回，并保持筛选条件不变。这样新发布的进展不会挤动后续页。需求和工作项分页反映当前状态，不保存历史快照。

## 拓扑图

| 参数 | 含义 |
|---|---|
| `view=project` | 默认；需求汇总图，节点 ID 是需求 ID 或项目里程碑 ID |
| `view=requirement`、`requirementId` | 需求内部和直接外部交付节点，复用网页视图转换 |
| `target` | 关键性分析目标；默认为项目，需求视图默认为 `acceptance:需求ID` |
| `rootNodeId`、`traversal`、`depth` | 使用当前视图返回的节点 ID；向 `upstream/downstream/both` 查询，默认深度 1；深度 0 仅保留根节点 |
| `q` | 按卡片标题／副标题过滤，节点之间的连线随之过滤 |
| `attention=true` | 项目视图按网页逻辑保留关键、高风险及信息未确认节点和直接上下文 |
| `maxNodes` | 默认 500，最多 2000；超限报错并提示缩小范围，不悄悄截断图 |
| `direction=right/down` | 横向／纵向布局，默认横向 |
| `layout=auto` | 返回自动布局坐标、连线折点和标签位置 |
| `format=svg` | 返回 SVG 文本及 `mimeType`，同时计算自动布局 |

需求汇总图会合并多个工作项关系。同一对需求双向连线可能表示分阶段协作；是否存在执行循环由完整工作项网络校验。

返回 `totalNodes`、`omittedNodes` 和卡片 `hiddenCount`，用于说明当前视图省略的范围。`savedLayout` 只包含可见节点的已保存位置、方向和版本，`omittedPositions` 表示省略的已存坐标数量。修改布局前用 `get_diagram_layouts` 读取完整坐标并合并修改，避免局部图覆盖隐藏节点位置。浏览器中尚未保存的草稿不进入 MCP 结果。

自动布局复用网页布局算法，以 280×116 的固定卡片尺寸生成独立图，最多支持 200 节点、1000 条关系。SVG 是可保存的文本，不是浏览器截图；自动布局不会覆盖团队已保存的坐标。

例如，导出工作项上游两层的纵向图：

```json
{"projectId":"项目ID","view":"requirement","requirementId":"需求ID","rootNodeId":"工作项ID","traversal":"upstream","depth":2,"direction":"down","format":"svg"}
```

## 图编辑批次

1. 读取 `get_path_analysis` 的 `revision`，作为 `expectedRevision`。布局版本从 `get_diagram_layouts` 或 `get_path_graph.savedLayout` 取得。
2. 调用 `preview_dependency_changes`。`changes` 可包含依赖 `add/remove`、工期 `estimates`、实体 `entities`和布局 `layouts`。
3. 核对 `differences` 后，将原输入和返回的 `previewToken` 原样传给 `apply_dependency_changes`，并生成一个 `batchId` UUID。
4. 用回执 `addedIds` 将客户端临时 ID 替换为正式 ID。结果不确定时先用原 `batchId` 查询 `get_dependency_change_receipt`；重试复用原批次 ID 和输入。

实体类型为 `requirement/work/milestone`，操作为 `create/update/delete`。创建使用客户端临时唯一 ID，同批次的关系和位置可以引用它。更新或删除已有实体需带 `expectedVersion`。

布局 `scope` 为 `global` 或 `requirement:需求ID`，方向为 `right/down`。`positions` 是该范围、方向的完整位置集合；保存时替换原集合。`expectedVersion` 使用已存版本；不存在时为 0。仅改布局不会增加分析 `revision`，刷新检查应比较 `get_project_change_version.version`。

依赖端点用需求 ID 加可选的工作项／里程碑 ID。引用项目独立里程碑时，对应需求 ID 传空字符串；同一端点不能同时提供工作项和里程碑。`add` 的每条关系需要临时 `clientId`。

过期版本、执行循环、无效端点或越权修改会拒绝整批。版本或业务日期变化导致预览失效时，重新读取并预览。

## 对应 REST 查询

| MCP | REST GET |
|---|---|
| `query_requirements` | `/api/requirements/query` |
| `list_work_items` | `/api/work-items` |
| `get_work_item` | `/api/work-items/:id` |
| `list_progress_updates` | `/api/progress-updates` |
| `get_path_graph` | `/api/projects/:id/path-graph` |
| `get_project_change_version` | `/api/projects/:id/change-version` |

分页筛选通过查询参数传入。读取现有对象时，无权访问与对象不存在均返回 404；按项目查询无权项目返回 403。归档需求查询仅供经理或管理员使用。


## 简化工作流

需求和工作项统一使用 `not_started/in_progress/completed/cancelled`。缺少日期只提示未排期；全部有效工作项完成，需求自动完成。无工作项时用 `start_requirement`、`add_progress`、`complete_requirement`；有工作项时使用对应工作项操作。`return_requirement` 或 `reopen_work_item` 记录返工。

完成偏差使用实际工作结束日期。`acceptedAt` 只保留历史；`actualEnd` 表示实际完成，`observationEnd` 表示甘特统计截止日，两者不能互换。迁移后的原文与出处在需求 `sourceNotes` 中。

工具目录已移除来源条款、来源关联、阻塞/解阻、确认验收、预测核对、前置确认、交付承诺以及覆盖/删除历史的工具。新请求不接受 `deliveryScope/executionMode/acceptanceOwnerId/priority/unblockEstimate` 及阻塞协调字段。原始需求导入使用 `formatVersion: 2`。

拓扑中的 `acceptance:需求ID` 保留为历史布局兼容 ID，现在表示工作完成，不要求执行验收操作。独立里程碑只有显式依赖才影响其他工作。

## 特性规划与总体进展

`get_feature_overview({projectId})` 读取大致预期、进展简述、人工判断、评估人和时间，以及当前特性的需求计数和最近三条进展。取消、归档需求不计入汇总。默认判断为待评估，不按完成数量自动推断是否符合预期。

`save_feature` 可传 `overview: {expectation, progressSummary, assessment, note}`，四项均须提供，文字可为空；`assessment` 使用 `pending/on_track/off_track/needs_adjustment`。保存时使用最新特性的 `id/name/sortOrder/expectedVersion`。省略 `overview` 不影响已有评估。项目经理或管理员可保存。

仅根据用户明确提供的判断写入评估。事实变化通过项目刷新版本更新网页，人工评估保持原值。结果未知时先调用 `get_feature_overview` 核对，不直接重复保存。字段和网页行为见 [需求录入说明](requirement-intake.md#总体进展)。


`save_feature` 可传 `description`，与 `overview` 分开维护；列表和总体进展读取支持 `state=active/archived/all`。归档与恢复使用 `archive_feature`、`restore_feature`；`get_feature_requirements` 分页读取当前或归档需求摘要。

`get_path_graph` 支持 `view=features` 顶层图、`view=feature` 加 `featureId` 的特性内需求图（`unassigned` 为未关联特性集合）。`view=project` 仍表示原来的全部需求。用 `list_feature_relations`、`save_feature_relation`、`delete_feature_relation` 维护人工规划；`planning/actual` 分别控制两类连线。规划关系不参与执行分析。

特性图与特性内需求图的共享布局分别使用 `features`、`feature:ID`，沿用布局版本和依赖批次保存。删除特性只允许没有需求及规划连线的空特性；非空特性先处理未完成需求再归档。[接口规则](requirement-intake.md#特性规划与关系图)。

## 连贯画布批次

网页的特性总览、特性内需求、全部需求和需求内工作项共用一个项目草稿。MCP 读取正式资料；网页草稿在保存前不会出现在读取结果中。

`preview_dependency_changes` / `apply_dependency_changes` 的 `changes.featureRelations` 是可选数组：

| op | 字段 |
|---|---|
| create | 临时 `id`、`sourceFeatureId`、`targetFeatureId`、可选 `note` |
| update | `id`、`expectedVersion`、`note` |
| delete | `id`、`expectedVersion` |

规划关系、执行修改和 `layouts` 在同一事务保存。不同对象使用不同临时 ID；回执 `addedIds` 同时返回规划关系和执行对象的正式 ID。规划循环按批次最终关系检查，包含归档特性保留的关系。

预览的 `analysis.featureContext` 包含特性概览、规划关系和需求归属，供统一图投影使用；规划关系不进入关键路径或排期计算。`get_path_graph.analysis` 同样提供该上下文。原单条规划关系工具保持可用。结果未知时查询原批次回执；重试必须复用原批次及输入。

## Phase 与需求阶段

使用 `list_feature_phases/save_feature_phase/deliver_feature_phase/reopen_feature_phase/delete_feature_phase` 管理分期。`record_test_submission` 记录实际提测。接口参数和阶段摘要见 [特性分期说明](feature-phases.md#rest-与-mcp)。
