---
name: project-manage-intake
description: 通过 MCP 将原始需求直接录入 project-manage，按需拆分或合并需求、添加工作项、套用模板、建立依赖及安排计划。用于需求录入和计划安排；人员由人类确定。
---

# 需求录入与计划

原始需求直接形成系统需求。保留原文、原编号和出处；只在实际需要独立安排与完成时拆成多个需求。多人协作时添加工作项或套用模板，无工作项时直接推进需求。

## 录入

1. 用 query_requirements、list_work_items 查询已有记录，详情用 get_requirement、get_work_item。分页读完相关结果，不按相似标题直接覆盖。
2. 需求说明 background 保留原始内容，referenceLinks 保存真实来源链接列表（每项 title/url/kind，名称自由填写，kind 为 document/task/other），acceptanceCriteria 写可观察的完成标准。来源未知可留空；不编造人员、日期或原文。
3. 小批量用 create_requirement；批量用 preview_requirement_import → apply_requirement_import。导入格式为 formatVersion=3，仅包含 requirements 和可选 dependencies；工作项放在需求的 workItems 中。示例见 assets/log-intake.json、assets/org-intake.json。
4. 更新已有需求使用 action=update、真实 existingId 和读取的 expectedVersion。省略的字段保持原值，按字段类型显式传 null 或空字符串才清空；已结束需求使用详情纠错。重复内容选择跳过或更新，只有明确是另一件事时才确认另建。

创建和编辑需求使用 featureId，导入使用 feature；先读取已有特性并复用，不根据章节另造多层计划。

负责人和协作者按用户给定的人选填写；未给人选则新增留空、已有分配保留。未分配和未排期不阻断录入。

更新特性省略 sortOrder 时保留位置，新建省略时追加。仅改名或说明不用重传排序、人工评估和链接。更新 Phase 省略 scope、targetDate、note 和 sortOrder 时保留原值；targetDate:null 清空日期。

## 工作与依赖

- create_work_item 直接添加工作项，不需要切换执行模式。已开始的需求只拆剩余工作，系统保留已有进度基线。
- 复用流程用 list_templates、apply_template；按模板排期用 preview_requirement_plan → apply_requirement_plan。
- 依赖表示提供成果的工作完成后，下游可以开始。优先连接具体工作项；等待上游整体完成时才连接需求完成端点。路径标识 acceptance:需求ID 为兼容已有布局保留，含义是工作完成。
- 同一文档、模块或章节顺序不自动构成依赖。共享成果只安排一次，不为连成一张图而加线。
- 实体、依赖和布局可通过 preview_dependency_changes → apply_dependency_changes 一批保存。临时实体 ID 可在同批次互相引用。
- get_path_analysis 检查完整网络、循环和下游影响；get_path_graph 查看局部拓扑或导出 SVG。按依赖排期用 preview_dependency_plan → apply_dependency_plan。

没有工期或日期依据时保留未知，可给出标明假设的建议。缺少计划会影响项目整体预测；不把部分已排期工作当成整个项目的完成日期。

## 特性分期与人工评估

用 get_feature_overview 查看各 Phase 的范围、交付状态、日期和历史；已完成归档需求仍计入 Phase。用户询问是否符合预期时，同时读取人工评估与最近进展，不根据需求完成比例自动填写判断。

用户明确要求更新总体预期或判断时，先读取特性最新 id/name/sortOrder/version，再用 save_feature 携带 expectedVersion 和完整 overview：expectation、progressSummary、assessment、note。文字可为空；assessment 为 pending（待评估）、on_track（基本符合）、off_track（有偏差）、needs_adjustment（需要调整）。保留用户未要求修改的内容，不编造评估。仅整理名称或顺序时省略 overview，保留原评估时间。

提交结果未知或发生版本冲突时，先读取 get_feature_overview 核对，避免重复保存。原始需求录入的授权不包含代替人类判断是否符合预期。

特性长期目标使用 save_feature 的 description，排序使用 sortOrder。空特性可以先记录目标，不自动创建占位需求。查看关系用 get_path_graph：view=features 为顶层，view=feature 加 featureId 为特性内需求图，新建未指定特性或归属传 null 时归入系统归类“其他需求”。unassigned 仅保留历史查询入口；旧 view=project/requirement 保持原义。

用户明确给出特性先后关系时，用 list_feature_relations → save_feature_relation 维护 sourceFeatureId、targetFeatureId、note；修改传 id 和 expectedVersion。人工规划与需求实际依赖分开，规划连线不参与排期，也不自动转成需求依赖。同一章节顺序不构成规划关系。

需要同时调整规划关系、执行依赖和布局时，使用现有 preview_dependency_changes → apply_dependency_changes 原子批次。changes.featureRelations 可选：create 传临时 id、sourceFeatureId、targetFeatureId、note；update 传 id、expectedVersion、note；delete 传 id、expectedVersion。所有临时 ID 保持唯一，回执 addedIds 返回正式 ID。规划循环按最终关系检查，不参与排期。结果未知先查询 get_dependency_change_receipt，不自动再次提交。

归档用 archive_feature，先完成、取消或移出未完成需求；restore_feature 恢复。归档保留需求与规划关系，get_feature_requirements 的 state=archived 可读分页历史。delete_feature 仅删除没有任何需求或规划关系的空特性。未归档的已完成、已取消需求可通过 update_requirement_placement 调整归属，保留执行事实。

## 执行与保存

需求和工作项统一使用未开始、进行中、已完成；取消保留为退出操作。全部有效工作项完成后需求自动完成，不再提交或确认验收。实际需要的验证、验收可作为有负责人和计划的工作项。

无工作项时用 start_requirement、add_progress（requirementPercent）、complete_requirement；有工作项时用 start_work_item、add_progress（workItemId/workItemPercent）、complete_work_item。遇到困难写进展或问题，不标记阻塞。

MCP 不再使用条款关联、落实范围、交付范围、执行模式切换、阻塞协调、预测核对或承诺确认工具。参数以当前工具 schema 为准。

核对预览、版本及影响后保存。用户已授权录入或安排时继续保存；只要求方案时保留草稿。提交保存 batchId 和原请求；结果未知先查 get_requirement_import_receipt 或 get_dependency_change_receipt，重试复用原批次及内容。

需要拆分案例时读取 [案例说明](references/examples.md)。完成后简要列出已保存的需求、工作和依赖、计划假设，以及仍需人类决定的事项。

## Phase 与工作阶段

先用 list_feature_phases 读取已有 Phase。仅在用户明确给出分期时创建或安排；不从标题自动推断 Phase。save_feature_phase 保存 name、scope、targetDate、note，修改携带 id 和 expectedVersion。需求使用 featureId、phaseId；批量调整使用 update_requirement_placement，逐条传 expectedVersion，推进后的归属、范围或目标日期调整填写 reason。

特性关注各 Phase 的状态，不填写总百分比。需求读取 executionStage；workStage 可选 analysis、development、integration、testing、other，不确定时留空。模板和工作项同步保留此字段。导入版本 3 使用 feature、phase 和 workItems[].workStage。

当前系统的 Phase 状态由有效需求自动汇总：无有效需求为待规划、全部未开始为未开始、全部完成为已完成，其余为进行中。取消需求不计入，归档完成需求保留贡献。没有独立的交付确认或重新打开命令，需求返工后自动重算。这个“已完成”只表示现有汇总结果，不能替代 DCIM V3.0 的整体验证通过。

管理员或项目经理可用 update_requirement、update_work_item、update_issue 维护终态记录的负责人等资料，填写 reason 说明更正原因；原执行状态、进度和历史保留。实际日期使用相应更正字段或更正命令。delete_work_item 自动清理关联依赖，仅删除未开始且无执行历史的工作项。流程重选提交 confirmTemplateReset:true，并传当前版本和排期日期。

记录实际提测使用 record_test_submission，填写 actualDate、expectedVersion 及可选 content。提测就绪不是已提测，不自动补提测事实。测试已经开始可直接显示测试阶段。结果未知先核对原请求与最新记录，不重复提交。

项目工作区分为关系图、进展表。清单工具提供录入、导入和批量维护；进展表查看 Phase 交付和工作执行，未安排 Phase 的需求直接列在特性下。dashboard_summary 的指定项目响应增补 featureOverview，与需求数据使用同一统计日期。get_path_graph 在 view=feature 时可用 phaseId（或 unassigned）筛选，phaseRegions 表达交付区域；区域顺序不代表执行依赖。布局范围 feature-phase:<featureId>:<phaseId|unassigned> 保存区域内相对坐标，修改前读取完整布局并携带版本。

查询需求用 query_requirements：statuses 指定多种状态，excludeStatuses 排除状态，两者取交集；与旧单状态 status 不同时传 statuses。排除未开始用 excludeStatuses=["not_started"]，尚未结束用 excludeStatuses=["completed","cancelled"]。省略 statuses 表示全部，空数组表示不选任何状态。stage 查询当前阶段，含并行中的阶段。返回 executionStage 的阶段内进度，不把需求总百分比当作测试进度。

list_work_items 支持 featureId、phaseId、workStage；phaseId=unassigned 查询未安排 Phase，workStage=unclassified 查询未分类。需求默认按名称编号自然排序，工作项默认按需求编号及流程顺序；原排序分别指定 sort=updated 或 planned_end。筛选排序在分页前生效，汇总完整结果需读取所有页，不能只统计第一页。

导出项目图显式传 view=features，旧默认 project 仍表示需求汇总。SVG 显示 Phase 标签和区域；自动布局先排列拓扑，再确定外框，layout.nodeSizes/regions 返回尺寸。导出不保存坐标，也不读取网页未保存的草稿。


清单顺序与批量操作：`order_outline` 传对象类型、父级和完整同级 `items:[{id,expectedVersion}]`；`archive_features` 原子归档所选特性。排序和 `update_requirement_placement` 返回 `undo`，可交给 `restore_outline` 核对版本后撤销；涉及已推进 Phase 时填写原因。`query_requirements(sort=manual)` 读取人工顺序，默认仍按名称。系统归类以 `kind=other` 标识，每项目最多一个，置底且不能改名、归档、删除或新建 Phase／特性规划关系；历史引用保留。

MCP 服务 `1.5.0` 的特性、Phase、需求和工作项均可关联多个文档或任务。优先使用 `referenceLinks`；省略保留原值，空数组清空，顺序按数组保存。MPS、MDS、Confluence、Jira 和自定义资料可混合添加；类型只用于展示。同一对象最多 20 条 HTTP(S) 链接，不重复添加相同地址。旧需求 `referenceUrl` 仍兼容，单独修改只影响列表首项，不清空其他链接。工具参数缺少 `referenceLinks` 时先确认服务已更新并重新连接 MCP，不用旧单链接字段替代整个列表。

## DCIM AI 工作流 V3.0

仅在 DCIM V3.0 上下文使用以下规则；其他项目不自动套用。规则来源：[SDS 工作流与设计协作规则](https://ecc.jereh.cn/pages/viewpage.action?pageId=6589992)。

特性维护 MPS、UX、数据设计、MDS、Phase 划分和需求拆分。公共数据、契约和系统约束由特性级设计负责人维护；局部工程选择随实现处理，缺失公共约定回 MDS，跨系统边界回 SDS。Phase 属于单一特性，需求是可验证功能；跨 Phase 拆可分别完成的增量，可共同引用同一 EPDS。

### Phase0 与设计基线

默认顺序：MPS → UX 设计与数据设计并行 → MDS 及接口基线 → 设计基线确认里程碑。前端与 UX 结对，后端与数据人员协作；后端设计负责人提前参与，接口和 MDS 可同步起草，最后确认一致且可实现的方案。整体体验和数据框架覆盖特性，已确定近期范围做到可开发，未来批次增量完善。

数据设计是 MDS 的组成或唯一来源引用，接口精确结构使用版本可定位的 OpenAPI 等工程契约。文档随特性持续维护，Phase0 只是首批设计工作。默认一个设计基线确认里程碑，直接前置为 MPS、MDS；UX/数据作为 MDS 前置，不重复直连里程碑。MDS 完成说明引用适用设计、契约版本和校核证据，确认 MPS、UX/数据、MDS 与接口基线一致。自动达成只检查直接前置，不代表系统审核了设计证据，不增加逐岗位签署。接口确有独立交付时间和外部消费者时才另设接口里程碑，不逐需求创建。

无界面特性省略 UX，没有数据变化时引用已有定义。Phase0 验证设计一致性、可实现性及契约，不要求尚未实现的软件 E2E。相关实现前明确本轮接口；真实联调及相关功能测试前核对实现、契约和环境版本，单元测试与契约检查可提前。

### 需求执行与模板

先 `list_templates` 核对工作项及实际依赖，描述可能滞后，不能据此覆盖结构。Phase0 使用“DCIM AI工作流V3.0（设计）”，有界面功能使用“DCIM AI工作流V3.0”，纯后端使用“DCIM AI工作流V3.0（后端）”。按类型裁剪：

| 需求类型 | 默认工作 | 适配规则 |
|---|---|---|
| 有界面且涉及后端 | EPDS设计与前端开发 → 后端与数据实现 → 联调 → 功能测试 | 默认串行，联调等待两项实现；UX 和数据人员按差异协作 |
| 纯后端 | EPDS设计 → 后端与数据实现 → 功能测试 | 由后端编写或修订 EPDS，明确本次行为、输入输出、异常与验收；有实际接口协作时加联调 |
| 纯前端 | EPDS设计与前端开发 → 功能测试 | 不虚构后端工作；需要接入已有服务时保留相应联调 |

需求形成或修订 EPDS，继承 Phase0 的 UX、数据设计、MDS 和接口基线，展开本次行为、差异、实现依据和验收；已有 EPDS 定向更新，不按需求复制。公共设计不在需求级重做，也不增加 UX 确认、数据确认审批节点。仅在用户或实际项目明确调整依赖时，按就绪契约安排前后端并行；不把既有并行实例当成模板默认。无界面需求不安排前端/UX 或虚构界面手册，按需提供接口或运行说明。“EPDS设计与前端开发”及后端实现用 `development`，后端模板的“EPDS设计”用 `analysis`，联调用 `integration`，功能测试用 `testing`。第一项完成不等于需求完成；测试后校准需求说明和手册。

需求完成表示真实功能已接入且局部测试通过；检查主要功能、相关边界异常、接口/数据一致性，以及涉及的权限和数据完整性。功能 Phase 完成还需跨需求场景、组合行为和受影响回归通过；Phase0 按设计校核目标判断。Mock 不证明真实联合验证通过。

### 现有系统与迁移

当前系统仅支持需求归属的工作项和模板，Phase 尚未纳入独立验证条件，也不自动校验接口基线和测试证据的一致性。依赖与里程碑表达执行约定，不等于系统已强制检查。自动里程碑只检查直接前置；当前设计模板的直接前置为 MPS、MDS，UX/数据通过 MDS 前置表达。保留这组依赖，不自动补回冗余连线，设计证据由执行者按 MDS 完成说明核对。特性/Phase 直接工作是目标能力，不发送不存在的 MCP 字段，不自动创建“设计需求”“测试需求”绕过限制。

用户明确迁移范围内，可复用已有 DES 等设计承接记录；保留原 ID、工作执行进度、历史、负责人和日期，只调整适用的剩余工作、设计引用与依赖。新增范围后允许系统重算派生汇总，不为维持旧百分比改写执行事实。功能需求保留原 Phase 归属，不因前移公共设计而一起搬到 Phase0；复用已有原型等实际成果，不创建重复工作，也不把流程更新写成设计完成。

模板工期强制正整数时，允许明确标注的 1 日占位，应用前按真实范围重估，不当成交付承诺；真实新增工作无估算或排期依据时保持未知，不自动改既有计划。新增/更新 V3 模板不自动替换存量、切换项目默认或分派人员，迁移按用户明确范围执行。旧实例保留旧标题、并行依赖或里程碑四项直连时，分别说明模板规范和实例现状；用户仅要求同步文档/skills 时不回写项目管理配置。

不新增跨特性 Phase。联合验证只建一个可多次执行的工作项，目标归属牵头特性的 Phase，其他特性引用同一成果；当前未支持直接归属时明确限制。依赖连接所需具体工作或需求，不默认等待整个 Phase。有独立演示、发布或交付目标时复用项目独立里程碑；里程碑不替代验证工作，取消验证不等于通过。上游范围/版本变化或返工时定向复核受影响证据；复用返工、重开工作项及 `milestone_command(reopen)`，保留历史。已达成的独立里程碑不会自动撤销，不把旧标记当成本轮通过。
