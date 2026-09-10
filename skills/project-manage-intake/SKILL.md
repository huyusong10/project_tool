---
name: project-manage-intake
description: 通过 MCP 把可验证原始需求整理为 project-manage 个人草稿，按需拆分合并、分解工作项或套用工作流、建立依赖拓扑并预览计划，交本人在“我的工作”审核发布。人员由人类确定。
---

# 需求整理、拓扑与个人草稿

默认保存到 MCP Token 对应账号的个人空间，必须选择目标项目。草稿发布前不影响正式项目；同账号不同 Token 可接续。完成后交本人在“我的工作 → 个人草稿”编辑和发布，MCP 没有发布工具。

## 如何组织

| 原始要求 | 系统中的安排 |
|---|---|
| 范围明确、可单独验证 | 尽量一条原始要求对应一个需求 |
| 包含多个分别验收的成果 | 拆成需求，分别说明来源落实范围 |
| 多条要求共同定义一个成果 | 可以合并、重组，保留全部来源映射 |
| 同一成果需要多个实施步骤 | 在需求下拆工作项，或展开已有工作流 |
| 小成果可以直接交付 | 直接执行，不建同名工作项 |

需求写交付边界和可观察的验收结果；工作项写实际产出。分组表达模块，标签表达阶段或部署侧。保留原文、章节、编号和已提供版本；原编号可重复，稳定标识必须区分。来源地址和版本未提供时留空，正文仍可保存。选摘保持 complete=false。

## 操作顺序

1. 查询目标项目、已有需求、工作项、来源、里程碑和工作流。query_requirements、list_work_items 分页读完相关结果；需要工作项时带 includeWorkItems=true。get_requirement_intake 查询来源与分组。核对真实 ID 和范围，不按相似标题覆盖。
2. 用 create_requirement_draft 保存方案。content.entities 只放新增对象，references 放已有成果系统 ID；已有成果只读。无工作项的需求自动直接执行，有工作项则分解执行。新需求默认 candidate，人类可在发布前明确纳入本期。
3. 补齐需求、验收条件和 links 落实范围，再细分工作。工作流用 preview_requirement_draft_template，核对返回的 entities、dependencies、template 后并入 content；template 放入 templates。保存展开结果和版本，不因模板变化覆盖人工调整。
4. 把真实前置写入 dependencies，不只写在描述里。用 preview_requirement_draft 校验完整执行网络；草稿可暂存业务问题，发布前必须解决标题、验收、引用、日期和环路问题。
5. 用 preview_requirement_draft_plan 查看“完整正式项目＋本草稿”的计划影响，其他草稿不参与。工期与日期来自已知条件或明确标注的估算；未知留空、疑问写 questions。计划保存在新增实体的 data，私人坐标保存在 positions，均不写正式项目。
6. update_requirement_draft 保存最后方案，再校验。返回草稿标题、ID、目标项目及“我的工作 → 个人草稿”位置，说明拓扑、估算和待人类确认项，等待本人网页发布。

新增负责人、协作者和验收人留空，不替人类选人。缺人选不阻断整理、拓扑和计划预览。发布不等于开工、验收或交付承诺。

## 拓扑规则

- 连线表示“完成后才能开始”。优先连接提供成果的具体工作项；只有必须等待整项验收时，才用需求整体端点。里程碑可作为阶段端点。
- 文档顺序、同一来源或同一模块不自动产生依赖。可并行就保留并行；未知关系写待确认。
- 共享成果只安排一次，其他需求引用它并连线。跨需求可分阶段协作，是否成环以完整执行网络为准。
- 拆分、合并、移动或删除对象后核对受影响的来源和连线。保留前置条件，明确改接或删除；不能静默丢失关系。

## MCP 契约

以当前工具 schema 为准。content 使用 formatVersion=1：documents、entities、references、links、dependencies、templates、questions、positions。工作项和归属里程碑通过 requirementId 指向新需求；独立里程碑不填归属。依赖使用具体 source/targetRequirementId、WorkItemId 或 MilestoneId；独立里程碑对应 RequirementId 为空字符串。

创建／保存带 requestId；保存带 expectedVersion。版本冲突先 get_requirement_draft，按字段合并后用新请求 ID 保存，不能整包覆盖新版。list_requirement_drafts 只列本人草稿，close_requirement_draft 关闭但保留内容。

保存响应未知时复用原请求 ID 和原内容重试，再读取最新版本。网页发布响应未知时用 get_requirement_draft_publish_receipt 查询原 batchId，不另建需求或新批次。

原有正式写入工具保持兼容。只有用户明确要求直接修改正式项目时才使用；个人草稿首版不修改已有成果的资料、计划和执行事实。

## 案例包

本地 references/examples.md 解释 LOG／ORG 的粒度、共享成果与拓扑。assets/log-draft.json、assets/org-draft.json 可直接作为 create_requirement_draft 的 content；它们是建议拆分，人员和排期留空。案例正文已足够，不另行查找原文。

旧 assets/log-intake.json、assets/org-intake.json 保留为兼容导入示例，不能直接当作草稿 content。所有案例均无原文链接。
