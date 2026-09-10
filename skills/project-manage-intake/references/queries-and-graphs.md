# 查询、历史与拓扑

用于录入前查重、录入后检查安排缺口、说明拆分与依赖，或核对执行事实。工具名不含连接器前缀，参数以当前连接的 schema 为准。

## 分页和筛选

三个分页工具都必须指定 projectId，返回 items/total/page/pageSize/pages。默认每页 50 条，最多 100 条；按 pages 翻页，超出末页返回空 items。跨项目逐个查询有权访问的项目。

| 工具 | 选择条件 |
|---|---|
| query_requirements | q、groupId、tag、ownerId、participantId、status、deliveryScope、view=delayed/high_risk、from/to、includeDeleted；需要工作项时加 includeWorkItems=true |
| list_work_items | requirementId、q、ownerId、participantId、status、active、overdue、unassigned、from/to |
| list_progress_updates | requirementId、workItemId、authorAccountId、eventType、正文关键词 q、from/to、snapshot |

- ownerId 只匹配负责人。participantId 查工作项时匹配负责人或协作者，查需求时匹配需求负责人或其工作项参与人。authorAccountId 是发布账号 ID，不能拿人员 ID 代替。
- 需求 q 查询标题、背景、验收条件及负责人姓名；工作项 q 查询工作项或需求标题。关键词命中仅用于定位候选，仍要核对系统 ID、来源和落实范围。
- 需求及工作项的 from/to 匹配与日期区间相交的计划；仅有一个计划日期时按该日期匹配，完全未排期的记录不会命中。检查安排缺口时省略日期条件，不能从“本周列表为空”推断没有未安排工作。
- active=true 表示未完成／未取消，并不只限正在执行。unassigned=true 表示未设置主负责人，不能与 ownerId 同用。已完成／已取消状态不能与 active=true 或 overdue=true 同用。
- query_requirements 默认省略 workItems，不代表需求没有工作项；用 workItemCount、includeWorkItems 或 get_requirement 核对。list_work_items 不包括直接执行需求，检查缺口要同时查看需求。
- includeDeleted 查询归档需求需要经理或管理员权限；旧 list_requirements 返回完整数组及工作项，不改用分页对象解析它。

例如，查候选的站点归属交付：

```json
{"projectId":"项目ID","q":"归属","deliveryScope":"candidate","includeWorkItems":true,"page":1,"pageSize":50}
```

再用 list_work_items 查未分派工作；这里不加日期条件：

```json
{"projectId":"项目ID","active":true,"unassigned":true,"page":1,"pageSize":50}
```

## 历史与执行条件

list_progress_updates 按发布时间及写入顺序倒序返回。第一次响应取得 snapshot，后续页原样传回并保持筛选条件，避免新记录挤动分页。from/to 按北京时间自然日筛选发布时间，包含首尾日。需求和工作项分页反映当前状态，不提供历史快照；保存修改前仍需回读对象版本。

get_my_work 适合查看当前账号负责和协作的工作，近期进展仅包含该账号发布的最近 8 条。查项目历史用 list_progress_updates，不能把“我的工作”当成项目流水。

get_work_item({id}) 返回工作项分工、计划／实际、阻塞、预测依据、未满足前置和 version；进展历史另查 list_progress_updates。直接需求的前置使用 get_requirement_start_conditions({id})，需要需求负责人或经理权限。查询到未满足前置时先处理实际问题，不自动例外开工。

## 拓扑范围与 SVG

get_path_analysis 始终返回完整执行网络 nodes/edges，用于全项目影响和执行成环判断。get_path_graph 返回面向展示的 cards/links，用于理解和交付图示。

| 参数 | 用法 |
|---|---|
| view=project | 需求汇总图，节点为需求或项目里程碑；省略 requirementId |
| view=requirement | 必须传 requirementId，显示内部及直接外部交付节点 |
| target | 关键性分析目标，默认项目；需求视图默认 acceptance:需求ID；它不等于局部筛选根节点 |
| rootNodeId/traversal/depth | 用当前视图返回的节点 ID，查 upstream/downstream/both；默认深度 1，深度 0 只有根节点 |
| q / attention | q 过滤标题／副标题；attention=true 在项目视图保留关键、高风险、信息未确认节点及直接上下文 |
| direction / layout / format | direction=right/down；layout=auto 返回坐标及连线路径；format=svg 返回 SVG 文本并计算布局 |

读取 totalNodes、omittedNodes、卡片 hiddenCount 和 savedLayout.omittedPositions，说明省略范围。局部图中的风险和余量仍来自其分析目标，不能将筛选图当成完整项目的交付预测。需求汇总图双向连线可能是分阶段协作，不代表执行网络成环。

默认 maxNodes=500，最多 2000；超限明确报错。自动布局／SVG 最多 200 节点、1000 条关系，使用固定 280×116 卡片。超限时缩小需求或上下游范围，不悄悄丢弃节点。

先读取需求视图取得真实工作项节点 ID，再导出上游两层：

```json
{"projectId":"项目ID","view":"requirement","requirementId":"需求ID","rootNodeId":"工作项ID","traversal":"upstream","depth":2,"direction":"down","format":"svg"}
```

将响应 svg 文本保存为 .svg 文件并交付链接。它是服务端生成的独立图，不是浏览器截图。自动布局不修改团队已保存的位置，网页未保存草稿也不进入 MCP 结果。

## 版本与布局保存

| 版本来源 | 使用位置 |
|---|---|
| get_project_change_version.version | 比较是否刷新；包括业务日期和共享布局变化，不能当成写入版本 |
| get_path_analysis.revision | 数值；依赖／实体批次的 expectedRevision |
| 需求或工作项详情 version | 对应实体的 expectedVersion |
| get_diagram_layouts 中的 version | 对应 scope/direction 的布局 expectedVersion；没有已存布局时用 0 |
| 来源目录 revision、导入预览 expectedRevision | 字符串；用于来源维护／导入，不替代路径 revision |

仅修改布局不增加路径分析 revision；检查页面刷新使用 get_project_change_version。业务日期或版本变化导致预览失效时，保留原输入，重新读取并预览。

用户要求保存团队布局时，用 get_diagram_layouts 读取完整位置，合并本次修改，再走 preview_dependency_changes → apply_dependency_changes。changes.layouts 每项包含 scope、direction、expectedVersion、positions。scope 为 global 或 requirement:需求ID；positions 替换整个范围和方向的集合，不能直接用局部图的可见位置覆盖。新实体的位置可以引用同批临时 ID，保存后按 addedIds 换成正式 ID。
