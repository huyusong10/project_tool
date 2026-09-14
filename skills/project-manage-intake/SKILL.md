---
name: project-manage-intake
description: 通过 MCP 将原始需求直接录入 project-manage，按需拆分或合并需求、添加工作项、套用模板、建立依赖及安排计划。用于需求录入和计划安排；人员由人类确定。
---

# 需求录入与计划

原始需求直接形成系统需求。保留原文、原编号和出处；只在实际需要独立安排与完成时拆成多个需求。多人协作时添加工作项或套用模板，无工作项时直接推进需求。

## 录入

1. 用 query_requirements、list_work_items 查询已有记录，详情用 get_requirement、get_work_item。分页读完相关结果，不按相似标题直接覆盖。
2. 需求说明 background 保留原始内容，referenceUrl 保存真实来源地址，acceptanceCriteria 写可观察的完成标准。来源未知可留空；不编造人员、日期或原文。
3. 小批量用 create_requirement；批量用 preview_requirement_import → apply_requirement_import。导入格式为 formatVersion=3，仅包含 requirements 和可选 dependencies；工作项放在需求的 workItems 中。示例见 assets/log-intake.json、assets/org-intake.json。
4. 更新已有需求使用 action=update、真实 existingId 和读取的 expectedVersion。省略的字段保持原值；已结束需求使用详情纠错。重复内容选择跳过或更新，只有明确是另一件事时才确认另建。

创建和编辑需求使用 featureId，导入使用 feature；先读取已有特性并复用，不根据章节另造多层计划。

负责人和协作者按用户给定的人选填写；未给人选则新增留空、已有分配保留。未分配和未排期不阻断录入。

## 工作与依赖

- create_work_item 直接添加工作项，不需要切换执行模式。已开始的需求只拆剩余工作，系统保留已有进度基线。
- 复用流程用 list_templates、apply_template；按模板排期用 preview_requirement_plan → apply_requirement_plan。
- 依赖表示提供成果的工作完成后，下游可以开始。优先连接具体工作项；等待上游整体完成时才连接需求完成端点。路径标识 acceptance:需求ID 为兼容已有布局保留，含义是工作完成。
- 同一文档、模块或章节顺序不自动构成依赖。共享成果只安排一次，不为连成一张图而加线。
- 实体、依赖和布局可通过 preview_dependency_changes → apply_dependency_changes 一批保存。临时实体 ID 可在同批次互相引用。
- get_path_analysis 检查完整网络、循环和下游影响；get_path_graph 查看局部拓扑或导出 SVG。按依赖排期用 preview_dependency_plan → apply_dependency_plan。

没有工期或日期依据时保留未知，可给出标明假设的建议。缺少计划会影响项目整体预测；不把部分已排期工作当成整个项目的完成日期。

## 特性规划与总体进展

用户要求查看大特性是否大体符合预期时，用 get_feature_overview 读取特性总体进展。系统计数和最近进展提供依据，人工判断独立保存；不根据需求完成比例自动填写判断。

用户明确要求更新总体预期或判断时，先读取特性最新 id/name/sortOrder/version，再用 save_feature 携带 expectedVersion 和完整 overview：expectation、progressSummary、assessment、note。文字可为空；assessment 为 pending（待评估）、on_track（基本符合）、off_track（有偏差）、needs_adjustment（需要调整）。保留用户未要求修改的内容，不编造评估。仅整理名称或顺序时省略 overview，保留原评估时间。

提交结果未知或发生版本冲突时，先读取 get_feature_overview 核对，避免重复保存。原始需求录入的授权不包含代替人类判断是否符合预期。

特性长期目标使用 save_feature 的 description，排序使用 sortOrder。空特性可以先记录目标，不自动创建占位需求。查看关系用 get_path_graph：view=features 为顶层，view=feature 加 featureId 为特性内需求图，新建未指定特性或归属传 null 时归入普通的“其他特性”。unassigned 仅保留历史查询入口；旧 view=project/requirement 保持原义。

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

用户明确确认实际交付时使用 deliver_feature_phase，先核对有效需求均完成；空 Phase 或全部取消不能交付。已交付范围修改前先用 reopen_feature_phase 填写原因，保留原交付记录；再按已有流程返工需求。未完成内容先移出当前 Phase。

记录实际提测使用 record_test_submission，填写 actualDate、expectedVersion 及可选 content。提测就绪不是已提测，不自动补提测事实。测试已经开始可直接显示测试阶段。结果未知先核对原请求与最新记录，不重复提交。

项目交付工作区共用表格与关系图。get_path_graph 在 view=feature 时可用 phaseId（或 unassigned）筛选，phaseRegions 表达交付区域；区域顺序不代表执行依赖。布局范围 feature-phase:<featureId>:<phaseId|unassigned> 保存区域内相对坐标，修改前读取完整布局并携带版本。
