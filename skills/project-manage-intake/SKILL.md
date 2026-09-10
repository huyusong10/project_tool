---
name: project-manage-intake
description: 通过 MCP 将原始需求直接录入 project-manage，按需拆分或合并需求、添加工作项、套用模板、建立依赖及安排计划。用于需求录入和计划安排；人员由人类确定。
---

# 需求录入与计划

原始需求直接形成系统需求。保留原文、原编号和出处；只在实际需要独立安排与完成时拆成多个需求。多人协作时添加工作项或套用模板，无工作项时直接推进需求。

## 录入

1. 用 query_requirements、list_work_items 查询已有记录，详情用 get_requirement、get_work_item。分页读完相关结果，不按相似标题直接覆盖。
2. 需求说明 background 保留原始内容，referenceUrl 保存真实来源地址，acceptanceCriteria 写可观察的完成标准。来源未知可留空；不编造人员、日期或原文。
3. 小批量用 create_requirement；批量用 preview_requirement_import → apply_requirement_import。导入格式为 formatVersion=2，仅包含 requirements 和可选 dependencies；工作项放在需求的 workItems 中。示例见 assets/log-intake.json、assets/org-intake.json。
4. 更新已有需求使用 action=update、真实 existingId 和读取的 expectedVersion。省略的字段保持原值；已结束需求使用详情纠错。重复内容选择跳过或更新，只有明确是另一件事时才确认另建。

使用分组整理需求，不使用标签。创建和编辑使用 groupId，导入使用 group；先读取已有分组并复用。

负责人和协作者按用户给定的人选填写；未给人选则新增留空、已有分配保留。未分配和未排期不阻断录入。

## 工作与依赖

- create_work_item 直接添加工作项，不需要切换执行模式。已开始的需求只拆剩余工作，系统保留已有进度基线。
- 复用流程用 list_templates、apply_template；按模板排期用 preview_requirement_plan → apply_requirement_plan。
- 依赖表示提供成果的工作完成后，下游可以开始。优先连接具体工作项；等待上游整体完成时才连接需求完成端点。路径标识 acceptance:需求ID 为兼容已有布局保留，含义是工作完成。
- 同一文档、模块或章节顺序不自动构成依赖。共享成果只安排一次，不为连成一张图而加线。
- 实体、依赖和布局可通过 preview_dependency_changes → apply_dependency_changes 一批保存。临时实体 ID 可在同批次互相引用。
- get_path_analysis 检查完整网络、循环和下游影响；get_path_graph 查看局部拓扑或导出 SVG。按依赖排期用 preview_dependency_plan → apply_dependency_plan。

没有工期或日期依据时保留未知，可给出标明假设的建议。缺少计划会影响项目整体预测；不把部分已排期工作当成整个项目的完成日期。

## 执行与保存

需求和工作项统一使用未开始、进行中、已完成；取消保留为退出操作。全部有效工作项完成后需求自动完成，不再提交或确认验收。实际需要的验证、验收可作为有负责人和计划的工作项。

无工作项时用 start_requirement、add_progress（requirementPercent）、complete_requirement；有工作项时用 start_work_item、add_progress（workItemId/workItemPercent）、complete_work_item。遇到困难写进展或问题，不标记阻塞。

MCP 不再使用条款关联、落实范围、交付范围、执行模式切换、阻塞协调、预测核对或承诺确认工具。参数以当前工具 schema 为准。

核对预览、版本及影响后保存。用户已授权录入或安排时继续保存；只要求方案时保留草稿。提交保存 batchId 和原请求；结果未知先查 get_requirement_import_receipt 或 get_dependency_change_receipt，重试复用原批次及内容。

需要拆分案例时读取 [案例说明](references/examples.md)。完成后简要列出已保存的需求、工作和依赖、计划假设，以及仍需人类决定的事项。
