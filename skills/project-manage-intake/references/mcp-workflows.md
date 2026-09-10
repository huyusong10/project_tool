# MCP 操作参考

先以当前连接的 tools/list 和输入 schema 确认工具是否存在。下面是业务工具名，不含连接器前缀。本文与仓库中的 MCP 实现一同维护，覆盖需求导入、分页查询及拓扑导出；连接旧部署时按实际可用工具处理。

## 环境与响应

使用已配置的 MCP 连接及当前账号权限。不要在 skill 或导入文件中保存 Token，不按示例端口切换环境。

成功响应读 structuredContent.result；兼容封装可读 content[].text 中的 JSON。HTTP 200 不等于业务成功，检查 isError、structuredContent.error/statusCode。认证失败不能当成“没有记录”。

## 选择读取工具

| 要知道什么 | 工具及读取重点 |
|---|---|
| 项目及真实成员 | list_projects、list_project_members、list_people；成员资格和有效状态，不按岗位造账号 |
| 定位已有交付 | query_requirements 分页筛选，默认不带工作项；get_requirement 读取详情、工作项、完整进展、指标和版本 |
| 定位执行工作 | list_work_items 分页筛选；get_work_item 读取执行、分工、计划、阻塞、预测依据、未满足前置及版本 |
| 核对历史 | list_progress_updates 按条件分页并带 snapshot；get_my_work 只代表当前账号，近期进展仅其最近 8 条 |
| 分组、标签、来源和范围 | get_requirement_intake；list_requirement_groups 返回数组；list_requirement_sources 返回含 documents 的目录对象 |
| 已有流程 | list_templates；核对实际工作、偏移、工期和依赖是否适用 |
| 完整交付预测 | get_path_analysis({projectId,target:"project"})；读取 revision、未知项、关键路径、风险和余量 |
| 拆分与上下游图 | get_path_graph 返回 cards/links、省略范围和可见布局，可附自动布局或 SVG；get_diagram_layouts 读取完整共享坐标 |
| 刷新与开工条件 | get_project_change_version 检查刷新；get_requirement_start_conditions 读取直接需求前置，工作项前置读 get_work_item |
| 当前负载 | people_concurrency({projectId,from,to})；日期仅按本次真实安排填写 |
| 异常及未决问题 | list_action_items、list_issues、get_issue、dashboard_summary |
| 承诺历史 | list_delivery_commitments、get_delivery_commitment、get_delivery_commitment_summary |
| 业务统计口径 | 先 get_analytics_catalog，再按实际目录调用 query_analytics |

旧 list_requirements 保持完整数组及 workItems，不接受全部新查询参数。查询日期、参与人、分页快照、拓扑范围和布局版本的具体用法见 [查询与拓扑](queries-and-graphs.md)。版本字段各有用途，不能互换。

## 小需求与分组标签

直接创建：`create_requirement({projectId,title,executionMode:"direct",deliveryScope:"candidate",acceptanceCriteria,...})`。显式传 candidate；旧创建工具的缺省交付范围不能代替录入决策。更新传 id/expectedVersion，可用 groupId/tags；终态使用 correct_requirement 并填写纠错原因。

| 工具 | 参数重点 |
|---|---|
| save_requirement_group | 新建：projectId/name/sortOrder；更新增加 id/expectedVersion，排序会移动相邻分组，随后回读版本 |
| delete_requirement_group | projectId/groupId/expectedVersion；需求保留并移入未分组 |
| update_requirement_organization | projectId/requirements:[{id,expectedVersion}]；增加 groupId、tags 至少一项 |
| list_requirements | projectId/groupId/tag；该版本用 groupId:"" 查未分组，省略则不筛分组 |

groupId:null 移入未分组；tags:[] 清空；省略字段保持原值。批量 tags 是替换，不是追加。需要保留不同需求的原标签时，先各自求并集，再按相同结果分批或逐个保存。

## 导入包

| 字段 | 内容 |
|---|---|
| formatVersion | 1 |
| documents[] | key/title/url/version/clauses；version 是字符串，url 为 HTTP(S)，complete 默认 false |
| clauses[] | key/title 必填；section/externalId/content/priority 保存原文信息，原编号允许重复 |
| deferredReason | 省略保留旧原因；非空暂缓；明确空字符串恢复安排 |
| requirements[] | key/title/action；action 为 create、link、skip，默认 create |
| 新需求资料 | background/acceptanceCriteria/group/tags/ownerId/deliveryScope/workItems；group 是名称，单条编辑时的 groupId 是系统 ID |
| workItems[] | key/title，可选真实 ownerId/durationDays；不支持凭空增加计划字段 |
| links[] | requirement/document/clause/scope；引用包内需求 key 和文档／条款 key，后两者也可引用系统已保存的来源 key；可选 workItem 作为实施出处 |
| dependencies[] | source、target 各有 requirement 和可选 workItem；只表达完成后开始 |

默认新增候选，没有工作项则直接执行。导入 schema 不接收任意额外字段；验收人、协作者和正式排期按后续业务工具的 schema 补充。单包最多 10 MB；大输入按可独立预览的业务批次整理，每批事务独立，不能把分批称为全量原子提交。

关联已有需求用 action=link/existingId，workItems 留空，不会覆盖旧资料。该行的 key 是包内别名；它的 links 或依赖若引用已有工作项，workItem 必须为真实工作项 ID。action=skip 保留来源，不新增该交付；相关依赖被跳过。

重复导入发现来源已有交付时，先核对系统 ID 和落实范围。需要额外交付才给 create 行设置 confirmAdditional=true。同名无来源的旧交付也应核对业务事实，不能因为自动匹配为空就认定没有重复。

## 预览、提交与回执

1. preview_requirement_import({projectId,package})。返回规范化 package、字符串 expectedRevision、previewToken、errors、warnings、existingMatches、sourceChanges 和依赖影响。
2. errors 为空后核对 warnings 和差异。修改任意包内容重新预览，预览本身不写正式数据。
3. 持久保存请求 `{projectId,package:preview.package,expectedRevision:preview.expectedRevision,previewToken:preview.previewToken,batchId:新UUID}`，再调用 apply_requirement_import。
4. 结果不明时调用 get_requirement_import_receipt({projectId,batchId})。applied 使用 requirementIds 映射并回读；not_found 可按原请求重试。网络持续失败保留原请求并停止重发，报告结果待核对。不能从界面出现同名需求推断本次提交成功。
5. 明确版本冲突或校验拒绝后，读取最新记录，保留草稿，重新预览。新预览作为新逻辑提交保存新批次；已有结果尚未核清时不进入此步骤。

回执只属于提交账号和项目。导入回执映射需求 ID；需要工作项 ID 时读取正式需求的 workItems，不推测导入 key 就是系统 ID。

## 来源范围和修订

save_requirement_sources({projectId,expectedRevision,documents}) 使用来源目录返回的字符串 revision；稳定 key 复用条款，追加变更版本，未包含的旧条款保留。

save_requirement_source_link 传 projectId/requirementId/clauseId/scope/expectedVersion，可选同需求 workItemId。先读当前内容再传 reviewedRevisionId=clause.current.id 表示核对本次修订，不能把文档字符串版本填进这个字段。需求版本过期时重新读取，不能只替换版本号后盲目重试。

delete_requirement_source_link 传 projectId/linkId/requirementId/expectedVersion。结束需求新增、修改或删除关联需经理权限及 reason。批量导入不会替用户自动确认旧关联的新版本。

defer_requirement_source_clause({projectId,clauseId,expectedRevision,reason}) 以非空原因暂缓，空字符串恢复。目录中 current 是当前条款，link.reviewed 是采用的修订，needsReview 表示待核对。

安排缺口按有效需求整体关联统计；工作项出处不替代需求范围。归档和取消关联不算当前有效交付。已关联候选、已纳入交付、已验收分别报告；有一个关联需求验收并不证明条款全部范围已交付。

## 依赖、拆分、里程碑与承诺

复杂修改统一用 preview_dependency_changes → apply_dependency_changes → get_dependency_change_receipt，避免逐项成功一半。expectedRevision 是 get_path_analysis.revision 的数值，实体 expectedVersion 来自最新详情。

输入骨架：`{projectId,expectedRevision,target:"project",changes:{entities:[],add:[],remove:[],estimates:[]}}`。

- entities：`{entity:"requirement"|"work"|"milestone",op:"create"|"update"|"delete",id,requirementId?,expectedVersion?,data}`。新实体用临时唯一 ID，更新／删除用真实 ID 和版本；保存后用回执 addedIds 替换临时 ID。
- 直接执行转拆分：同批更新需求 executionMode=work_items、reason 并创建剩余 work。基线由服务端保留，不手写进度或补造“已完成”工作项。
- add：每条有 clientId、sourceRequirementId、targetRequirementId，按需加 sourceWorkItemId／targetWorkItemId。项目里程碑端点的需求 ID 为空字符串，对应 ID 放入 sourceMilestoneId／targetMilestoneId。不要把需求整体端点误当成“前期工作已就绪”。
- estimates：每项带真实 workItemId，按 schema 填 durationDays、earliestStart、unblockEstimate 或预测。已有工作项工期估计通过 estimates／update_path_estimate 修改，不把 durationDays 塞进不接受它的普通工作项更新。
- 里程碑实体用 title、targetDate、confirmationMode；独立项目里程碑不挂需求。自动／人工确认按真实阶段出口选择，人工推进用 milestone_command。
- layouts：保存共享坐标。先读 get_diagram_layouts 的完整位置和版本再合并修改；scope 为 global 或 requirement:需求ID，direction 为 right/down，positions 会替换该范围和方向的原集合。局部图返回的坐标不够用于整份替换。
- 用户确认基线时增加 changes.commitment:{reason,milestoneId?}。milestoneId 选择有效项目里程碑；不要理解为只给该里程碑的局部需求记承诺。快照反映项目当前交付范围，核对整个 differences.commitment。

单个真实依赖也可用 add_dependency/remove_dependency。review_dependencies 仅在实际核对前置后使用。按网络排期用 preview_dependency_plan/apply_dependency_plan；适用模板时用 preview_requirement_plan/apply_requirement_plan。模板更换和排期会影响下游，先核对预览；有执行历史后不能用换模板代替剩余工作拆分。

## 执行与异常

| 对象 | 常用命令 |
|---|---|
| 直接执行需求 | start_requirement → add_progress（requirementPercent）→ submit_acceptance_requirement → accept_requirement；阻塞／解阻用 block_requirement／unblock_requirement |
| 工作项 | start_work_item → add_progress（workItemId、workItemPercent）→ complete_work_item；阻塞、解阻、重开用对应工作项命令 |
| 退回与历史纠错 | return_requirement、reopen_work_item、correct_requirement、correct_work_item，按权限和实际理由执行 |
| 问题 | create_issue、add_issue_update、resolve_issue，需要时挂起／恢复；问题解决后也要核对执行对象是否具备解阻条件 |

add_progress 的 expectedVersion：更新直接需求完成度时用需求版本，更新工作项完成度时用工作项版本。百分比不超过 99；不要同时传两种百分比。100% 由完成／提交验收命令产生。历史只追加，不调用 update_progress/delete_progress 覆盖旧记录。

开始直接需求前用 get_requirement_start_conditions({id})，开始工作项前用 get_work_item({id}) 核对未满足前置；旧连接缺少工具时从完整路径和需求详情核对。只有用户已授权例外开工时，才按实际 schema 传 reason 和最新 expectedDependencyRevision；不要删除依赖绕过检查。

用户报告实际完成且授权更新时才写执行结果。计划不等于实际发生；complete_*_as_planned 是有约束的历史补录，不能用于让新导入的数据显得已完成。
