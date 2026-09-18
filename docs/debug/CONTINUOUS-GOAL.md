# 持续改进工作记录

长期目标：功能范围保持稳定，持续提高正确性、易用性、性能与可维护性。没有预设完成点；阶段验收后继续选题。

## 基线与恢复

- 工作目录 D:\tools\project-manage-improve，分支 codex/continuous-improvement，起点 bd19fa1；当前产品提交fc73dcc。
- 原目录 D:\tools\project-manage 的 dev 保持原样，最后检查仍仅用户修改 skills/project-manage-intake/SKILL.md、未跟踪 docs/dcim-ai-workflow-v3-gaps.md。
- 独立构建、临时数据库、浏览器端口3296；3210/3295不动。未部署、未推送。单个Playwright服务串行运行；性能测量独占运行。
- EY完整验收基线fc73dcc：969项业务（117文件）、8项性能、26项浏览器，运行时、428模块边界、Lint、类型、构建和预算通过。主JS937.89KB、CSS342.24KB、ELK1595.33KB。stages-es-ew-verify.log。
- ES/ET/EV/EW专项及EY集成均通过。之前EQ基线5e31e67仍可查stages-ek-ep-verify.log。当前无运行测试、无临时测试留在tests/responsive。
- 证据在.preview/qa/continuous-goal/，不进版本库；原日志、探针、截图保留。恢复先读本记录、git status及差异，不重跑已验收事项。

详细历史按需定位：A—DO在fd512b7的本文件；DP—EV在41a4ed0的本文件，更早记录为CONTINUOUS-DEBUG.md。

```powershell
git show 41a4ed0:docs/debug/CONTINUOUS-GOAL.md | rg '阶段名或主题'
```

## 近期成果

| 阶段 / 提交 | 结果与验收入口 |
|---|---|
| EG / 1013ffe | 批量归档核对显示已归档/未归档；未知结果、冲突、整批回滚及窄屏4项。batch-archive-state-* |
| EI / 0a2ad1c | 待处理里程碑直达图形属性；项目里程碑使用项目范围，不依赖“其他需求”存在。11项专项，EJ全量通过。action-milestone-* |
| EK / b553f9e、EL / a189d32 | 已保存项目里程碑的空名称校验和草稿摘要定位回到原字段；复用editorFieldLocation。milestone-draft/summary-location-* |
| EN / 09ca901 | 品牌输入原maxLength把“🤖监控台”截短；改原生pattern按完整码点限制20/4字，超限保留输入。4项真实保存/恢复/并发专项、390px。branding-character-boundary-* |
| EP / 5e31e67 | 新增依赖摘要复用dependencyWorkspaceLocation；关系ID直接读URL，项目摘要用navigationData并关闭弹窗。当前画布/项目总图/清单均可定位修改保存，9项专项；扩展3项永久回归。draft-relation-location-* |
| ES / 65a2aa1 | 项目里程碑图面板识别navigationData中的未保存对象；摘要定位、空值校验、390px保存一次及刷新通过。新增1项回归；new-project-milestone-*。初次探针在blur后画布外按Ctrl+S超时，改用明确保存按钮 |
| ET / ef6837f | Modal首次渲染记录原焦点，避免autoFocus抢先导致取消失焦；ConfirmDialog透传returnFocus。流程归档成功/核对成功回“新建流程”，取消回原按钮。真实2旅程及10项相邻专项、原事实保持，扩展2项既有测试；template-archive-focus-* |
| EW / fc73dcc | 特性画布新建未连接的项目里程碑原来立即消失；创建后转到现有项目图并打开属性，正式归属不变。扩展ES回归，立即改名、摘要定位、空值校验、390px、保存一次与刷新通过；需求内里程碑/视口/模板需求共5项通过，Lint/类型通过。new-milestone-immediate-before/after.log |
| EV / 41a4ed0 | 归档人员/需求后不自动清除问题筛选，两个下拉保留当前值/名称或失效提示；防止无提示扩大范围。真实归档、刷新、切换/清空、未知负责人、状态分页和新建分派4项通过，新增2项回归；historical-issue-filters-final.log及archived-issue-*-filter-* |

最近无需修改：

- EH：模拟24分析面板，导航至全部图表约504ms，响应到绘制86ms，时间切换90ms；末项/提示/1280及390px正确。analytics-scale-*；不是实际网络耗时。
- EM：品牌设置的版本检查、背景刷新保留草稿、迟到响应保护已有完整实现和测试，不改“使用最新设置”整体重载。
- EO：其他项目增至200个、2万需求/10万工作/1万问题，当前40需求项目读取约20.6ms不变；管理员/成员5场景×7筛选×4档结果及顺序一致，零写入。actions-project-isolation-*。
- ER：减少动态效果已有统一CSS、GraphScene、Chart处理和实时切换专项；未重复测试。
- EX：真实双项目同人执行，经理仅看到外部数量2→工作完成后1→项目归档后0，普通成员没有外部数量/明细，读取外部项目403。本项目事实不变；加载后续日期、切换空闲人员和390px通过。concurrency-cross-project-verified.log。首次探针未指定工作负责人、第二次使用已退役block接口，均修正探针；不恢复旧工作流。无产品修改。
- EU：真实问题挂起/刷新/恢复保留35%进度、旧历史和核对日期；挂起清目标日期，核对日期改到未来后提醒消失。取消输入保留、三次明确写入、390px及原需求/依赖保持；issue-defer-review-date-final.log。无产品修改。

## 覆盖与降低优先级的领域

| 领域 | 已覆盖 |
|---|---|
| 执行/历史 | 转拆分、返工、取消再开、并行最终完成、日期纠正、提测未知及新返工周期（AJ/CT/CV/CY/CM）；各需求历史页码独立（EC） |
| 协作/恢复 | 人员停用、项目/Phase/问题/需求/特性冲突、未知写入、身份切换、跨页接管、背景503/403、删除对象（BJ/CB/CL/CP/CR/DD/DG/DW/DC/EA） |
| 规划/归属 | 排序/撤销、Phase聚合/历史快照、增加前置、流程跨项目复制/归档、里程碑入口、草稿跨范围定位（AX/BH/CD/DH/DK/EI/EK/EL/EP/ES） |
| 导入/字符 | 原文备份与重导入、输入未整理恢复、异步读取竞争、回执、不部分写入、代理对截断（AA/AB/BW/DS/DT/EN） |
| 查询/规模 | 搜索大小写、日志10万、我的工作复用分析、清单500需求2500工作、特性旧来源5000条款、10万历史、分析24面板、跨项目干扰（AK/BQ/BT/CK/CE/DB/DJ/DN/EH/EO） |
| 界面/往返 | 长文本/空数据/390px/低高度、项目切换、筛选焦点、复制降级、输入法、强制颜色、甘特边界和位置、双标签项目隔离（AL/BB/BU/CI/CQ/CX/CZ/DL/EE/ET/EV） |
| 运维/身份 | 备份有效性/恢复重启/无效文件/下载失败/同毫秒并发、Token撤销复用连接、密码重置清会话、原服务日志（Q/CF/BO/CB/DQ/DR） |

充分检查的领域只在新证据出现时深入。探针若仅验证现有行为则归档，不堆永久测试。

## 稳定决定

- 不扩功能，不增加跨请求缓存或布局体系。只对具体问题修改；允许无需修改。
- 未知写入先核对原结果，不重复提交。身份切换清未提交草稿是既定行为。
- Feature/Phase/Issue/需求纠错重读仅合并原基线未改字段；ProjectForm与品牌设置的“使用最新设置”整体重载，不套字段合并。
- 需求info/correction/plan/schedule的“已核对并关闭”只有版本变化证据，应保留输入；不能套用DW已确认成功的草稿清理。
- Asia/Shanghai统一业务日期。计划日期0100—9999；Phase允许0001—0099。甘特显示限制36,600自然日，不改业务日期范围。
- 需求标题仍限200 UTF-16单元，截断时去掉末尾高代理项（DT）；品牌按现有服务端20/4码点，不放宽禁止换行的规则。
- 正式对象用detailId；里程碑/图属性用pathNode+graphInspector=open+pathInspector=closed。项目里程碑属于项目范围。“其他需求”可能不存在，不为只读导航创建它。
- 批量归档后行仍保留“已归档”并禁用选择；不要误以为应该隐藏。
- 项目归档/恢复保留此前独立归档的需求；Phase历史交付按快照原样返回。旧来源条款复核不恢复成产品入口。
- 性能测量独立运行，分开记录服务计算、网络和浏览器成本；不得把Playwright扫描标签时间算作渲染耗时。
- 临时浏览器探针验收后移回证据目录；新增永久回归只覆盖会破坏数据、恢复或交互的重要路径。

## 候选与受阻

- 初始1000节点/3000边Worker布局约8—13秒；DO搜索已从511降至288ms。没有明确方案不改算法或加缓存。
- 日志无匹配10万约0.64秒，暂不引入索引体系。单人并发SQL过滤曾改变顺序，已放弃。
- DU一次迁移测试启动15秒超时、输出为空；单项与同并发重验通过，EB/EJ/EQ全量未再发生。不直接放宽超时。
- 无用户决策事项、无外部阻塞。Goal保持active。

## 当前阶段 EZ：关联链接上限与重复纠正

检查20项关联链接、重复规范化地址的错误反馈、纠正和清空；优先检查已完成工作项，确认修改链接不改变完成事实和旧历史。

验收：错误用可读信息说明，原输入保留；达到20项禁止继续添加，纠正/删除后可保存，空列表不恢复旧链接。390px表单可操作。

EY验收已完成，原工作目录仍仅用户原改动。下一步实际浏览器复现；WorkItemLinks直接显示normalizeReferenceLinks抛出的错误message，重复地址可能暴露Zod JSON，尚未标为缺陷。
