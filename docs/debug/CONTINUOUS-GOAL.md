# 持续改进工作记录

长期目标：保持功能范围稳定，持续提高正确性、易用性、性能和可维护性。没有预设完成点；阶段验收后继续选题。

## 基线与恢复入口

- 工作目录：D:\tools\project-manage-improve；分支：codex/continuous-improvement；起点：bd19fa1；最近统一验收覆盖 A—Y；当前提交由 git log -1 查看。
- 原目录 D:\tools\project-manage 的 dev 未改动。保留用户修改的 skills/project-manage-intake/SKILL.md 和未跟踪的 docs/dcim-ai-workflow-v3-gaps.md。
- 使用独立依赖、构建及临时数据库，浏览器检查端口 3296。未部署、未推送，3210 正式服务保持原样。
- 证据目录：.preview/qa/continuous-goal/。恢复先读本记录及 Git 差异，从当前阶段继续；不要重复已验收修改。
- 更早成果见 CONTINUOUS-DEBUG.md。本记录压缩前的阶段细节可从 e44a89b 提交读取。

## 已验收成果

所有修改都有修复前证据。表中浏览器检查同时完成类型检查和独立测试构建，各代码阶段 Lint 均通过。

| 阶段 / 提交 | 问题与结果 | 验证与证据文件 |
|---|---|---|
| A / 264fe86 | 中文自然排序复用 Collator。2,000 条中位数 114.1→2.5ms；10,000 条 665.4→14.3ms，顺序不变 | 34 项模型/接口、3 项浏览器；sort-before/after.log、sort-regressions.log、stage-a-*.log |
| B / ca1117e | 人员并发页首次读取失败后，恢复尺寸监听；修复 390px 摘要裁切、日期竖排和长名称 | 11 项浏览器，含 1920→1366px、五人摘要及失败恢复；people-before/after.log 与截图、stage-b-lint.log |
| C / ab7f29a | 工作日加减越过 0100—9999 年会无界循环。现在及时拒绝，REST/MCP 返回 400；合法年末短查询可用 | 948 项业务、8 项性能、4 项浏览器；date-boundary-before/after.log、stage-c-*.log、date-browser.log；事务无半成品 |
| D / 530d69a | 日志支持 Phase 名称及筛选、原地展开长内容；显示日期与北京时间筛选一致 | 4 项旅程及长 URL/窄屏复验；audit-before/after/final.log、audit-final/ 截图、stage-d-lint.log |
| E / cb600a4 | 其他账号改动后，“我的工作”不会更新。启用现有查询库的可见时刷新及 60 秒轮询 | 双账号复现；15 项浏览器含草稿和失权清理；my-work-before/return-before/after.log、stage-e-lint.log |
| F / 7c23429 | 先选链接类型再粘贴地址会覆盖手动选择。保留选择，并保持默认自动识别 | 4 项浏览器含四类对象、草稿、排序、未知写入、390px 全主题；links-before/after.log、stage-f-lint.log |
| G / 91a37cd | 导入“其他需求”预览成功但保存失败；特殊合法标识从回执消失。复用系统归类，回执使用无原型映射 | 19 项相关测试、10 项浏览器；新旧系统名称、新项目、重试及回执；intake-before/after/browser.log、stage-g-lint.log |
| H / 35d27db | 进展说明的换行丢失，长工作项名称撑出记录。两条样式保留换行并按容器宽度显示 | 5 项浏览器，1280/390px 截图复核；history-before/after.log 与截图、stage-h-lint.log |
| I / 3558e18 | 图形批次特殊标识导致依赖/特性关系漏回执，创建需求及子工作项返回 500。修正三处映射 | 110 项接口/契约测试含重试、最终网络和回滚；mapping-before/after.log、stage-i-types/lint.log |
| J / 74ca049 | 降级复制移除临时文本框后丢失焦点。恢复原按钮焦点和滚动位置 | 2 项浏览器；完整复制内容、成功反馈、Tab 后确认关闭；clipboard-before/after.log、stage-j-lint.log。测试未写系统剪贴板 |
| K / e44a89b | 业务日期复用固定上海时区格式器。趋势汇总 100/1,000/10,000 条中位数 3.57/37.3/386.89→0.09/0.88/8.4ms | 每组五次与独立基准逐项一致；39 项日期/趋势测试、5 项日期页面检查；business-date-before/after.log、date-format-regressions/browser.log、stage-k-lint.log |
| M / 42052e4 | 创建 Token 后表单移除，焦点未进入结果操作。结果出现时聚焦“复制 Token” | 既有键盘旅程先失败后通过；2 项浏览器、类型、独立构建和 Lint；token-focus-before/after.log、stage-m-lint.log |
| N / 817f552 | 图表长名称提示左侧超出屏幕 1,600px 以上，仅末尾可见。提示限制宽度、换行并留在图表范围内 | 3 项浏览器，1280/390px 前后截图复核，主题切换与原图表正常；chart-label-before/after.log、stage-n-lint.log |
| O / 681f043 | 结果弹窗重复复制实现也丢失焦点，失败后同时显示“已复制”。复用公共复制函数，成功/失败改为单一状态，删除重复代码 | 既有账号旅程先失败后通过；4 项浏览器、类型、独立构建、Lint 和 433 模块边界；result-copy-before/after.log、stage-o-lint/boundaries.log |
| P / 2fdbee3 | 面板拖动失去指针捕获后，普通悬停仍改变高度（520→538px）。捕获结束或按键松开时清理拖动 | 2 项浏览器：捕获生效前后中断、正常拖动、刷新恢复、双击/键盘重置、甘特失焦；resize-before/after/final.log、stage-p-lint.log |
| Q / 无需修改 | 数据库文件操作现有处理符合预期：导出文件有效、预览取消不替换数据、恢复后重启并重新登录，无效文件后可重新选择 | 3 项真实浏览器旅程，仅使用临时数据库；database-review.log |
| R / 373f578 | CPU 采样定位需求汇总与偏差重复计算计划进度，现在复用本次结果并保留加权后取整。1,000 需求/10,000 工作项首屏中位数 926→791ms、495→452ms | 各五次采样，四种查询完整结果摘要一致；2,000 组确定性样本全部指标与旧实现一致；query-before/final.log、metrics-compare.log；集成验收通过 |
| S / 64bfe35 | 输入法确认候选词触发行内负责人保存，普通下拉也会误选；两类选择器忽略 composition/229 按键。人员搜索框补齐可访问名称 | 既有旅程先失败后通过，4 项浏览器含 390px、键盘及表单创建，类型和 Lint；ime-before/inline-before/after.log、stage-s-lint.log |
| T / 29ec583 | 删除每条需求重复计算、随后丢弃的 pathEnabled 列。主 SQL 在 100/1,000/3,000 条时中位数 0.96/61.23/541.59→0.36/2.17/6.37ms；完整需求首屏约 708ms | 同数据库交替五次，保留字段逐项一致；四种完整查询摘要不变，57 项接口/业务、8 项性能、类型及 Lint 通过；unused-query-probe.log、query-trimmed*.log、stage-t-*.log |
| U / 1c8d722 | 问题进展里的长令牌地址撑宽内部段落，390px 正文右边界达 2,261px，被卡片裁切。增加一条换行样式 | 3 项浏览器、类型及 Lint；1280/390px 前后截图已目视复核；issue-history-overflow-before.log、issue-history-after.log、stage-u-lint.log。保留换行和纠错对应关系 |
| V / 无需修改 | 页面修改流程名称、4 天工期和里程碑后，重新打开并创建需求，实例保持两项工作和一个里程碑，两条前置关系及排期正确 | 隔离真实接口与页面旅程通过，实验用例留在证据目录；template-instance-final.log、template-instance-review.pw.ts |
| W / 526c2bd | 合法客户端标识 __template_finish__ 与内部结束节点冲突，使开始偏移 0/2 变为 5/2。内部节点现在选择未被占用的标识 | 创建接口先失败后通过，覆盖连续两个候选名冲突、复制、实例化；40 项路径/后置安排/接口测试、类型及 Lint；template-key-before/api-before/after.log、stage-w-*.log |
| X / 无需修改 | 145 条清单跨位置选择后，打开详情再返回保持选择；筛选清空批量操作，清除筛选后旧选择不恢复。结构清单按当前卡片限制提交对象 | 源码核对与真实浏览器检查通过；selection-review.log、selection-review.pw.ts，仅保留实验副本 |

| Y / c22fd51 | 删除已退出路由且没有调用的 RequirementsPage.tsx，减少 249 行重复筛选、选择及整理实现 | 全仓引用检查与集成验收通过；unused-page-before.log、stages-s-y-verify.log |

| Z / 无需修改 | 真实三个账号依次追加说明、更新至 60%、确认解决；成员与负责人重新按关联需求筛选时看到 100% 和正确的三条历史，权限入口一致 | 页面与接口、作者与版本核对通过；issue-roles-final/visual.log、issue-roles-review.pw.ts 与禁用动画后的截图已复核 |

| AA / d47aa38 | 编辑导入原文后导出的是旧内容，未整理时也没有备份入口。现在原文按文本导出，已整理内容仍为 JSON，存储失败提示与入口一致 | 实际下载先失败后通过；文本/JSON 重导入、示例逐项一致，5 项浏览器含原批次重试，类型及 Lint；intake-export-before/after/final.log、stage-aa-lint.log |

| AB / b8bd867 | 已整理草稿继续编辑原文后刷新，页面隐藏新输入并允许预览旧内容。草稿现在保存并恢复原文编辑状态，跨标签接管时同步状态 | 刷新旅程先失败后通过；12 项导入浏览器旅程含拆合、原批次、390px 和旧草稿，类型及 Lint；intake-resume-before/after.log、stage-ab-lint.log |

| AC / 7784cf9 | 成员可见范围按需求反复扫描全部工作项。现随已有遍历记录参与需求；1,000/3,000 需求的数据加载后计算中位数 66.54/460.12→14.95/49.97ms | 三种规模、两个角色各五次；12 组完整响应摘要一致。46 项业务、8 项性能、3 项浏览器、类型及 Lint；action-scale-before/after.json、action-scope-*.log、stage-ac-*.log |

| AD / 本次提交 | 账号停用后仍能新分派问题，已有问题也不提示交接。问题分派检查有效账号，两个页面入口复用人员筛选，待处理沿用“负责人不可用”原因 | API 三处先失败后通过，界面 6 个候选收至 3 个；61 项业务、11 项浏览器、类型及 Lint，交接保留进度/历史，已解决问题历史归属仍可更正；issue-owner-*.log、stage-ad-lint.log |

## 集成验收与业务覆盖

- A—E：npm run verify 通过，948 项业务、8 项性能、26 项浏览器冒烟，运行环境、433 模块依赖边界、Lint、类型、构建及体积预算通过。证据：stages-a-e-verify.log。
- F—K（阶段 L）：npm run verify 通过，954 项业务、8 项性能、26 项浏览器冒烟，其余同上。主 JS 934.37 KB、CSS 344.61 KB，均在现有预算内。证据：stages-f-k-verify.log。
- M—R：npm run verify 通过，954 项业务、8 项性能、26 项浏览器冒烟，运行环境、433 模块边界、Lint、类型、构建及预算通过。主 JS 934.46 KB、CSS 344.61 KB。证据：stages-m-r-verify.log。
- S—Y：npm run verify 通过，955 项业务、8 项性能、26 项浏览器冒烟，运行环境、432 模块边界、Lint、类型、构建及预算通过。主 JS 934.55 KB、CSS 344.63 KB。证据：stages-s-y-verify.log。
- 规模：100/500/1,000 个需求，每项 10 个工作项和 10 条进展。分页总量及 50 条页长符合预期，越界空页正常；1,000 需求时中位数需求查询 977ms、工作项查询 742ms、进展查询 13ms。本轮未重构查询。证据：scale-probe.log。
- 已覆盖：双账号状态同步、日期越界及跨日、批量录入/图形提交的事务和回执、长文本/空数据/窄屏、日志与历史阅读、复制降级。
- 降低重复检查优先级：历史搜索与归档、未知写入核对、已验收日期规则及排序。新证据出现后再深入。
- 无需修改：跨项目页面已有 navigationKey 重挂载；同时间进展顺序已有回归；外观存储读写已有异常降级和 appearance.pw.ts 专项用例；资源读取拒绝后会清空旧缓存。

## 稳定决定

沿用现有业务规则、接口和组件；不引入跨请求结果缓存，不重做已验收方案。每次修改对应具体问题或测量收益；不为持续执行增加功能、架构或无收益测试。
长文本检查同时比较正文与父容器边界，并复核截图；仅检查页面宽度或段落自身 scrollWidth 会漏掉内部段落撑宽后被裁切。

## 当前阶段 AE：近期改动的集成验收

范围：对 Z—AD 的工作执行 npm run verify；集成验收后更新统一基线，继续选择其他业务流程。

验收：运行时、依赖边界、Lint、全部业务与性能测试、浏览器冒烟、类型、构建和体积预算通过。证据写入 stages-z-ad-verify.log。

候选：尚未充分覆盖的界面流程与业务状态恢复；近期导入、负责人交接与待处理性能降低优先级。

阻塞事项：暂无。恢复时先检查正在运行的集成验收与 Git 状态，不重新开始。