# 持续改进工作记录

长期目标：保持功能范围稳定，持续提高正确性、易用性、性能和可维护性。没有预设完成点；阶段验收后继续选题。

## 基线与恢复入口

- 工作目录：D:\tools\project-manage-improve；分支：codex/continuous-improvement；起点：bd19fa1；最近统一验收覆盖 A—DL；当前提交由 git log -1 查看。
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

| AD / 8890853 | 账号停用后仍能新分派问题，已有问题也不提示交接。问题分派检查有效账号，两个页面入口复用人员筛选，待处理沿用“负责人不可用”原因 | API 三处先失败后通过，界面 6 个候选收至 3 个；61 项业务、11 项浏览器、类型及 Lint，交接保留进度/历史，已解决问题历史归属仍可更正；issue-owner-*.log、stage-ad-lint.log |

| AF / 4ee10d8 | 风险分布切换为完成偏差时，保留风险分组却选中指标卡，预览返回 400。现在从指标与分组都支持的图表类型中选择 | 真实接口先失败后通过，保存/刷新保持配置，失效分组自动去除；4 项浏览器、类型及 Lint；analytics-metric-validation-before/after.log、stage-af-lint.log |

| AG / d7660f1 | 品牌图片未读完就能保存；恢复默认、移除或重新选择后旧读取会覆盖当前选择。保存等待读取完成，过期读取不再更新草稿 | 两处真实读取先失败后通过；4 项品牌浏览器与连续替换/移除补充旅程、类型及 Lint；branding-read-before/after/complete.log、stage-ag-lint-final.log |

| AH / 3ee1521 | 输入法 keyCode 229 的 Escape 被外层处理：画布恢复旧名称，详情操作框意外关闭。两处外层处理沿用输入法保护 | 两条既有旅程扩展后先失败再通过；8 项浏览器覆盖普通取消、保存与焦点返回，类型及 Lint；canvas/detail-composition-before.log、composition-boundaries-after.log、stage-ah-lint.log |

| AJ / 无需修改 | 直接需求完成 30% 后拆成两项；完成一项达 65%，取消另一项达 100%，重开回到 65%，再次完成达 100%。清单、进展表加载数据和历史一致，390px 可读 | 真实操作与四条工作项事件、单条需求返工、拆分前说明核对通过，截图已复核；split-cancel-complete.log、split-cancel-review.pw.ts。最初两次实验断言误将阶段状态当作总百分比，未改产品 |

| AK / 37ac3c2 | 搜索每个字段反复做中文区域小写转换。改用通用转换；3,000 条的评分、匹配、排序合计中位数：中文 98.23→10.45ms，拼音 109.67→65.92ms | 三种规模各五次，21 组完整分数/匹配/排序摘要相同；1,112,064 个 Unicode 字符与组合文本一致。25 项业务、5 项浏览器含390px、类型及 Lint；search-case-*、stage-ak-lint.log |

| AL / 683b3f4 | 200 字符 Token 名称在列表及撤销框被裁切；旧响应式规则被后载基础样式覆盖，窄屏摘要和接入区拥挤。名称/确认文字换行，响应式规则移至所属样式并调整窄屏布局 | 30 个真实 Token 的分页、准确撤销及刷新通过；1280/390px 前后截图复核，3 项浏览器含复制/到期、类型及 Lint；token-long-before/after.log、token-long-review.pw.ts、stage-al-lint.log；实验不加入长期测试 |

| AM / 4b15189 | GapTimeline 唯一调用页未启用旧预测编辑器，原弹窗与编辑分支已无可到达入口。移除重复实现，实际预测仍由关系图草稿维护 | 全仓调用检查、4 项浏览器覆盖预测冲突/跨页同步及成员执行/取消、类型与 Lint；forecast-unused-before/after.log、stage-am-lint.log |

| AO / 2ad0deb | 人力分析切换视图后丢失岗位、人员筛选。复用页面筛选保存，使用独立参数避免覆盖人员矩阵搜索 | 往返先失败后通过；3 项浏览器含刷新、离开返回、清空及390px，类型和 Lint；people-filter-before/after.log、stage-ao-lint.log |

| AP / 无需修改 | 同一人参与两项目；甲的问题未解决时禁止移出，解决后可移出，乙的在办需求和成员关系保持。重新作为观察者加入后保留历史且禁止写入，分析筛选按项目恢复 | 双账号真实接口与页面旅程通过；member-cross-project-complete.log、member-cross-project-review.pw.ts。前两次实验修正账号在办计数随解决变化及资源拒绝返回404的断言，未改产品 |

| AQ / 无需修改 | 进行中的需求先跨 Phase，再跨特性安排；清单、进展表、关系图均显示原测试进度70%，原范围移除，工作事实和全部既有进展保留 | 真实两次调整与六次跨视图读取、刷新通过；placement-review.log、placement-review.pw.ts |

| AR / 8f634d4 | 特性关系图在同一请求内重复读取路径数据和总览。现在复用本次请求的数据；1,000 条混合需求的总图 247.75→171.74ms，单特性图243.22→171.39ms | 三种规模、三类视图交替五次，9组完整响应摘要一致；70项接口/业务含权限、MCP和SVG，3项浏览器含390px、类型及Lint；graph-read-before/after.json、graph-read-unit/access-export/browser.log、stage-ar-lint.log |

| AT / 无需修改 | 1280×480、844×390窗口新增长名称工作项，选择负责人、填写两条链接并开始/完成；选择器、滚动保存和确认弹窗均可操作，数据落库一致 | 真实浏览器两组操作通过，截图已目视复核；short-window-review.log、short-window-review.pw.ts；实验不加入长期测试 |

| AU / caef915 | 入口扫描确认旧进展页及两处旧转导出文件没有消费者；实际路由已使用当前工作区。删除3个文件、64行遗留代码 | 261个客户端模块均从入口可达；4项浏览器覆盖进展恢复/筛选、行内编辑冲突和排期表单，428模块边界、类型与Lint；client-reachability*.log、unused-client-*、stage-au-lint.log |

| AV / 无需修改 | 本项目主负责、协作、直接执行各1项，当天实际数3；未来计划3，完成一项后未来降至2而当天投入保留；外部两项完成一项后降至1，普通成员不显示外部数量 | 双账号真实浏览器与逐项ID核对通过；concurrency-roles-review.log、concurrency-roles-review.pw.ts；实验不加入长期测试 |

| AW / 未采用试验 | 单人并发查询3,000需求约20.14ms；SQL提前过滤可降至6.15ms，但改变每日任务顺序。数量与任务成员一致，未达到完整响应一致要求；收益较小，撤回两行试验 | 三种规模、六类条件交替五次；concurrency-filter-before/after.json、concurrency-filter-diff/membership.log，完整差异已保留。当前代码保持已验收实现 |

| AX / 2153805 | 已开始工作增加未完成前置后，接口有提示，当前详情入口却未显示。概况现在复用关系图分析原因，清单、关系图、进展表一致 | 真实操作先失败后通过；撤销/重做不改正式关系，保存保留42%与历史，前置完成后提示消失。4项浏览器含390px、类型及Lint；dependency-started-review/after.log、stage-ax-lint.log，截图已复核 |

| AY / 无需修改 | 项目归档前已有独立归档需求；项目恢复后该需求继续归档，27%执行进度、历史、关联问题保留。归档后切至另一项目，恢复后可从切换器返回 | 真实浏览器旅程通过；project-restore-after.log、project-restore-review.pw.ts。首次试验更正取消API的reason参数，未改产品；实验不加入长期测试 |

| AZ / aefcc04 | 详情依赖区域逐边扫描全项目节点，并反复扫描已有关系。现在本次渲染复用节点Map和关系Set；1,000需求×10工作项的工作详情区域生成中位数483.79→2.41ms，旧流程782.40→3.84ms | 三种规模18组完整HTML、19组重复/里程碑/空上下文输出一致；3项浏览器含分组端点返回、草稿和390px、类型与Lint；dependency-detail-before/after.json、dependency-detail-overlap/browser.log、stage-az-lint.log。耗时不含网络和整页渲染 |

| BB / a3f2c7a | SVG长标题省略按UTF-16单元删末尾，截断生僻字或符号的代理对，导出显示替换字符。改为按完整码点删末尾，原完整标题保留 | 真实MCP导出先失败后通过；生僻字与符号两种证据，2条浏览器导出、15项接口、类型及Lint；svg-unicode-before/after.*、svg-unicode-browser-before/after.log、svg-unicode-unit.log、stage-bb-lint.log；前后截图已复核 |

| BC / 无需修改 | 无完成样本时按期完成率为“—”；保存只看完成需求的统计表，完成后显示1条/100%，返工后回到空数据与“—”，配置和筛选保留 | 真实页面保存、刷新、完成及返工通过；analytics-empty-review.log、analytics-empty-review.pw.ts；实验不加入长期测试 |

| BD / 无需修改 | 检查客户端入口、TS导入和CSS的@import；71个样式文件全部可达，无可直接删除的文件 | style-reachability.log/json保留引用清单；未按名称猜测废弃选择器，未修改代码 |

| BE / 620a0ce | 项目图每条依赖线反复查找图边，全量图还逐卡片计算恒为0的隐藏关系数。改为本次生成按依赖ID查找，全量图直接使用0；1,000需求/5,832依赖的总图152.54→100.18ms，关注图159.53→113.74ms | 三种规模四类视图交替五次，12组完整卡片/连线摘要一致；38项业务及接口、3项浏览器、类型和Lint；graph-projection-before/after.json、graph-projection-unit/browser.log、stage-be-lint.log；仅衡量图生成，不含网络和布局 |

| BF / 3e279c9 | 人员转岗后旧筛选仍生效，人力分析、人员矩阵及人员与权限的下拉框却显示“全部”。三个入口保留当前筛选选项；人员选项仍显示已选姓名，无法读取时说明不在列表 | 三处真实转岗先失败后通过；直接清空、选择新岗位、刷新、原筛选恢复及390px共5条浏览器、类型和Lint；person-filter-changed-before、person-filter-adjacent-before、person-filter-all-after.log、stage-bf-lint-final.log |

| BH / 无需修改 | 带阶段、依赖、人工里程碑和晚做锚点的流程跨项目复制两份；副本ID及引用独立，改名后来源35%执行事实和既有实例保持，新实例采用修改后的内容 | 真实复制、画布修改与实例检查通过；template-copy-complete.log、template-copy-review.pw.ts。首次试验更正锚点读取来源至path-analysis，未改产品；实验不加入长期测试 |

| BI / 404de6c | 删除成功后工作项详情仍显示对象失效；明确成功且原窗口仍在时关闭该详情，回到当前工作区。删除最后项后0%/30%需求保留日期、历史并可继续直接执行 | last-work-stale-before.log、last-work-complete.log（9项浏览器，含冲突、未知结果、重复提交）、stage-bi-lint.log；新增work-item-deletion.pw.ts。初次探测修正清单无进度列及规则冲突返回409的断言 |

| BJ / 756ebbc | 撤权刷新后恢复的执行草稿仍可提交；按当前权限锁定提交并保留输入。ownerValid统一输出布尔值，避免只读历史负责人仍看到返工入口 | 63项接口/契约、5项浏览器及完整verify通过；live-role-before.log、live-role-complete.log（数字/布尔差异）、live-role-final.log、live-role-unit.log。恢复权限可继续提交，另一项目不变；初次实验修正自动恢复表单的选择器 |

| BK / c1902b3 | 707个源码/测试/脚本引用检查确认旧FeatureDetails和IssueFactForm无入口；连同其专用FeatureRequirementList、PhaseRows及独占导入，净减155行 | 7项现行特性/Phase/问题纠错及状态浏览器检查、Lint、类型、构建、428模块边界通过；unused-export-review.mjs/log/json、unused-views-browser.log、unused-views-status.log、stage-bk-lint.log；未新增测试，不宣称运行时提速 |

| BL / 无需修改 | 两个真实项目分别填写新建问题草稿，关闭后切换并刷新；标题、正文、负责人和关联需求各自恢复，提交后各创建一条，新表单清空 | issue-project-drafts.log、issue-project-drafts.pw.ts；试验已移到证据目录，不增加长期测试 |

| BM / 无需修改 | 100/1000/5000条模拟需求选项、真实登录与项目；标题输入、拼音搜索及末尾需求精确选择均正确。5000条时首次拼音19.6ms、后续中位19.5ms、标题中位1ms | issue-intake-measured.log、issue-intake-timings.json、issue-intake-performance.pw.ts；输入事件到下一RAF，含渲染和帧调度、不含网络，未作缓存或重构。首次探测修正重复选项的定位范围 |

| BN / e02410d | 问题选项搜索因始终保留固定选项而不显示无匹配提示；按实际搜索命中显示提示，保留固定项及当前选择，命中固定项时不误报 | issue-empty-before/after.log、截图；3项浏览器及Lint/类型/构建通过。中文、拼音、清空关联、Esc焦点和布局保持；低影响提示修改不增加长期测试 |

| BO / 无需修改 | 无状态MCP每次请求检查Token；通过页面撤销后，复用同一HTTP连接的读写均401，没有新增项目。另一Token同连接成功，账号会话与页面刷新保持 | token-revocation.log、token-revocation.pw.ts；隔离实例实际UI撤销、复用连接读写与凭据独立性检查通过，不增加长期测试 |

| BP / 无需修改 | 未解决问题阻止需求归档且需求完整回滚；解决后归档会隐藏并锁定问题。旧页面重开409，恢复需求后问题完整DTO及历史保持，重新核对保留的草稿后可继续处理 | archived-issues-final.log、archived-issues.pw.ts；真实浏览器通过。首次实验更正新建问题后的需求计数基线及恢复后既有重读步骤，不增加长期测试 |

| BQ / 1c39642 | 无关键词日志查询先分页后关联人员/项目，总数查询去掉无用关联；10万条默认页中位134.24→2.88ms，末页227.13→17.39ms | audit-scale-before/after.json/log、audit-query-before/after.json、audit-scale-probe.ts；34组完整JSON哈希含顺序/快照一致。31项接口、2项日志浏览器、Lint/类型/构建通过；不新增缓存/索引/永久测试 |

| BR / 8445c93 | 里程碑确认被前置条件拒绝后，错误只在弹窗外工具栏；现在按里程碑ID将失败原因显示在当前操作旁。重开自动/人工里程碑保留工作100%及实际日期，原历史保留并追加两条说明；读取不重达成 | milestone-reopen-complete.log（缺少反馈）、milestone-reopen-after.log、截图及milestone-reopen.pw.ts；5项浏览器、Lint/类型/构建通过，按前置顺序再次确认成功。低影响反馈修改不增加永久测试 |

| BT / 409a4fb | 日志关键词先按账号/Token匹配ID，日志筛选后统一分页再关联名称，去掉逐日志重复拼音匹配及查询分支。10万日志、200账号、50Token：账号拼音3841.56→270.03ms，Token名称4248.32→265.95ms，无匹配3360.76→639.13ms | audit-scale-keyword-after.json/log、audit-search-edges-before/after.json、audit-search-team.json/log及脚本；34组规模、91组历史身份/改名/撤销/拼音完整结果一致，多人测量交替前后各5次。43项接口/搜索、2项浏览器、Lint/类型/构建通过；无缓存/新索引/永久测试 |

| BU / 7498800 | 长项目名将240px切换菜单内选项撑至945px；限制网格列最小宽度，菜单内宽238px保持无溢出，触发器及选项提供完整名称提示 | project-picker-bounds/after.log、前后截图、project-picker.pw.ts；200项目在390/1280px下键盘定位当前项、首尾/循环、选择与刷新、Esc回焦通过，连同现有项目切换共4项浏览器及Lint/类型/构建通过；不增加永久测试 |

| BV / 无需修改 | 三条需求中混入缺少特性的Phase归属，预览按需求标题说明错误且不写入；界面修正后其它原文、工作项及跨需求依赖保持，保存与预览一致且刷新不重复创建 | import-correction-review.log、截图、import-correction.pw.ts；隔离实例真实流程通过，不增加永久测试 |

| BW / 0a350e8 | 慢文件覆盖后选文件/手动输入，旧无效文件显示迟到错误；跨页批次完成也会被旧读取覆盖。输入变更和接收跨页批次时使旧读取失效，离开页面后不应用结果 | intake-file-before.log（三项复现）、intake-file-cross-before.log、intake-file-after.log（14项）、intake-file-final.log（7项）；新增intake-file-reading.pw.ts四项有实际数据覆盖风险的回归。最终Lint/类型通过；移除清理函数中冗余计数递增，沿用mounted检查，消除Lint警告 |

| BX / 无需修改 | 普通成员两项目24个工作项，从未开始筛选第二页进入另一项目工作详情；两轮后退/前进保持对象归属、个人范围、筛选、页码、列表内容和滚动位置，导航未产生写请求 | my-work-navigation-review.log、my-work-navigation.pw.ts；隔离实例真实账号及页面往返通过，不增加永久测试 |

| BY / 4832b64 | 删除BK旧视图独占的19个类名、75个选择器分支，4个CSS文件减少5670字节；两个混合规则保留现行选择器 | unused-view-styles/unused-view-selectors.json、删除脚本与原CSS副本；7项浏览器含特性评估、Phase编辑、问题纠错及390px布局通过，截图复核、Lint/类型/测试构建通过；不增加永久测试 |

| CA / 无需修改 | 100/1000/5000问题×10次进展，42组查询结果、归档隐藏、筛选总数、分页及全局摘要正确；最后两条同时间进展仍选后写入内容。5000问题默认页17.8ms、末页27ms、历史159ms、人员拼音245ms | issue-scale-probe.ts、issue-scale-before/checks.json/log、issue-query-*.json；单独测量各5次，无需性能改动；补齐最终同时间样本后只做正确性核对，42组完整结果哈希一致，不增加永久测试 |

| CB / 无需修改 | 管理员重置密码后，成员旧提交401且业务DTO不变；旧密码失效，临时密码登录后必须改密，完成后回到原项目/需求，可提交一次新进度且原历史保持 | password-session-accepted.log、password-session-review.pw.ts、截图；真实双账号通过。沿用身份切换清除草稿的既有规则，不把它改为网络中断恢复；首次实验修正创建接口字段、草稿恢复假设及完成度读取位置，不增加永久测试 |

| CC / 4168107 | 直接执行需求的概况未显示已保存完成度，必须打开编辑才能查看；现在在执行状态旁显示已有数值及计算说明 | direct-progress-before/after.log、direct-progress-overview-review.pw.ts、1280/390px截图；0→52→100、刷新、只读账号及分解需求仍显示阶段70%通过，连同既有执行和概况共9项浏览器及Lint/类型/测试构建通过；一行展示修改，不增加永久测试 |

| CD / 无需修改 | 非默认流程归档后，旧新建草稿提交400且没有半成品；背景、标准、日期保留，改选有效流程后只创建一次。旧实例40%及完整数据保持，之后可完成工作，原计划及历史保留 | archived-template-draft-facts.log、archived-template-draft-review.pw.ts、截图；真实旅程通过。实验更正菜单入口、折叠字段与已填textarea的定位；新建其它需求会更新预测revision，比较排除该派生版本，执行事实不排除；不增加永久测试 |

| CE / 48acfd3 | 清单生成按需求反复扫描所有图节点，改为本次计算中按需求分组一次；1000需求、8872节点的已保存投影61.07→3.21ms，结构草稿32.35→3.24ms | workspace-rows-probe.ts、workspace-rows-baseline.ts、前后JSON/log；27组完整树哈希相同，含正式数据、三种排序、取消工作、归档贡献与临时对象。13项模型、5项浏览器、Lint/类型/测试构建通过；同轮交替7次，仅测函数，未引入跨调用缓存或永久测试 |

| CF / 无需修改 | 数据库导出已生成备份但下载503时，错误与备份结果分别显示；从同一行重下成功且不再创建备份。下载SQLite完整性为ok，中文、多行和补充字符保留，备份后新增需求不在快照内 | backup-download-final.log、backup-download-review.pw.ts、截图；隔离实例真实备份/下载及只读SQLite核验通过，刷新仍一份；首次实验改为匹配备份元数据子集，列表额外含恢复校验结果。不重复导入恢复，不增加永久测试 |

| CG / a299628 | 接口接受0000年，但浏览器编辑日期框为空，保存其它字段仍保留隐藏日期；共享Phase日期校验只拒绝零年份，保留0001—9999年 | phase-date-boundary.log/trace记录零年回显空串，phase-date-api-before/after.log及phase-date-after.log；41项模型/接口、3项浏览器、Lint/类型/测试构建通过。五个有效边界创建/编辑/图表正常，非法日期不落库；补一项接口回归。首次实验补齐工作项预测revision的排除，仅派生版本变化，业务事实不变 |

| CI / 7cef000 | 进展筛选键盘打开后焦点留在外部，面板内Esc无效，关闭/选预设后焦点落到正文；两种筛选局部补齐进入和返回焦点、Esc处理，已进入面板时不再抢焦点 | filter-keyboard-before.log在1280/390px各复现5处，filter-keyboard-final.log共3项浏览器通过；嵌套下拉分层关闭、输入法、外部点击、刷新筛选及窄屏通过，Lint/类型/测试构建通过。初次扩展实验将搜索框角色改为searchbox；不改变共享弹层，不增加永久测试 |

| CJ / 无需修改 | 同账号跨项目共享姓名/岗位，更新后两边同步且用户名不变；甲项目经理改成员不改变乙项目成员记录/权限，两边工作负责人、协作者、40%进度、日期及原历史保持，成员可各提交一次45% | people-project-boundary-complete.log、people-project-boundary-review.pw.ts及截图；真实双账号/两项目界面和完整业务DTO核对通过，仅归一资料名称与预测revision。首次实验将协作者设置移至工作项编辑接口，开始接口不接受该字段；不增加永久测试 |

| CK / e504ced | 我的工作重复计算同一项目预测；复用本次需求查询已有快照，未覆盖项目仍单独计算。1000需求样本中两个账号聚合函数467.09→317.45ms、614.91→473.68ms，SQL各减少24次 | my-work-scale-probe.ts、before/after/paired.json/log、my-work-queries-*.json及旧实现副本；12组完整响应哈希相同，同轮交替7次；负责人/协作、无权/归档项目、零工作及无关联人员范围与统计正确。12项接口/业务、5项浏览器、Lint/类型/测试构建通过；既有协作旅程覆盖无负责需求的回退路径，无跨请求缓存/永久测试 |

| CL / a30f889 | Phase冲突重读只更新版本，随后保存会把另一处的名称、范围、日期、顺序和参考链接覆盖回旧值；现在保留本地有变化的字段，未修改字段取最新资料 | phase-conflict-before.log复现五项覆盖；phase-conflict-after.log共3项浏览器，phase-conflict-facts.log补验完整执行事实；两次冲突/重读、关闭刷新恢复、日期与链接清空、本地同字段修改及旧未知结果核对通过，Lint/类型/测试构建通过。新增phase-conflict-recovery.pw.ts防止数据覆盖 |

| CM / 8836a1a | 纠错后再次打开仍用旧历史，无法引用刚保存的纠错；执行和进展共用较新需求快照，缺少完整历史时补读。工作项记录补齐“更正”引用，与需求详情复用现有历史格式函数 | correction-chain-records.log复现旧列表，correction-chain-history.log复现引用缺失；correction-chain-after.log共12项浏览器、8项模型、Lint/类型/测试构建通过，1280/390px截图复核。两次纠错仅追加记录，原说明在第二页可读且执行事实不变；新增work-item-correction-history.pw.ts。首个实验改从概况页打开纠错，操作不在记录页 |

| CO / 无需修改 | 普通成员在进行中第2页完成唯一工作，列表自动回到第1页20项；已完成筛选及刷新准确保留该项，历史仅一条完成记录，其余20项事实不变 | my-work-last-page-final.log、my-work-last-page-review.pw.ts及390px截图；真实操作仅一次POST，汇总21/20/1正确。前两次实验误把单页分页的隐藏按钮理解为禁用按钮或隐藏整个导航，按实际控件结构修正断言；不增加永久测试 |

| CP / 1a39a6a | 问题基本信息冲突重读后会把他人更新的8项资料恢复为旧值；重读时按原基线合并，保留本地修改，未修改字段使用最新资料，提示同步说明 | issue-field-conflict-before.log证实保存覆盖；issue-field-conflict-final.log共14项浏览器、issue-field-conflict-unit.log共17项业务，Lint及类型/测试构建通过。连续两次冲突、跳出/刷新恢复、远端清空、本地同字段修改、进度42与原历史、旧未知结果和失权路径均通过；新增issue-field-conflict.pw.ts |

| CQ / 52ec5d4 | 我的工作360/390px概览标签逐字换行，四位数字越出卡片；窄屏数字改为独占下一行，仅增加三条样式 | my-work-summary-before/after.log、my-work-summary-review.pw.ts及截图；360/390/760/1280px × 零/四位计数共8种布局，标签单行、数字及文字在卡片内，无重叠/页面横向溢出；6项浏览器、Lint/类型/测试构建通过，360/1280px截图复核。不增加永久测试 |

| CR / 338c336 | 已完成需求只纠错标题，冲突重读后的保存会覆盖远端背景、完成标准、负责人、Phase和链接；按原基线保留本地修改，未改字段取最新资料，Feature/Phase成组保留，沿用旧链接转换 | requirement-correction-conflict-before.log证实覆盖；after/final.log共3项浏览器、unit.log共82项业务，Lint/类型/测试构建通过。两次冲突/远端清空、关闭刷新恢复、同字段本地修改、原执行事实和旧历史保留，仅追加一条本地纠错；旧未知结果跨导航核对锁通过。新增requirement-correction-conflict.pw.ts |

| CT / 8fd7f50 | 提测未保存后需求完成，核对无法结束；返工刷新后旧输入会配新版本继续提交。草稿保存执行轮次，跨轮次或终态变更后仅可明确结束核对；旧格式草稿版本变化时同样先核对，沿用现有提交锁 | test-submission-recovery-before.log复现2条；after/final.log共7种浏览器场景、unit.log共15项业务，Lint/类型/测试构建通过。已保存仅核对、未保存正常重试、完成、返工、旧草稿恢复、新轮次新提测均验证；390px截图复核。新增test-submission-recovery.pw.ts共5例 |

| CU / 无需修改 | 100/500/1000流程×20项，分两个项目及空项目，18组含/不含归档查询的对象、项顺序、前置项及布局正确；只读取right布局。200流程4000项约10.05ms，800流程16000项约105.10ms | template-list-scale-probe.ts、before.json/log、queries-before.json；每组7次且完整响应一致。800流程803条SQL，SQL约22.82ms；正常规模未见性能阻碍，暂不为极大流程目录修改查询。HTTP/MCP要求项目范围；不增加永久测试 |

| CV / 9fe2138 | 凌晨返工时间取UTC日期，错误接受北京时间前一天的提测；改用现有businessDateFromDateTime转换日期下限 | test-submission-business-date-before.log两条200/400失败，after.log共48项业务、browser.log共3项恢复用例，Lint/类型/测试构建通过。北京时间23:59:59.999、00:00、07:59:59.999、08:00四边界均验证非法日期无写入、同日可提交；无其他服务端时间截断匹配。新增4项既有feature-phases测试 |

| CX / 13d40e6 | 个人Token表格只声明table/row，缺少表头与单元格语义；补齐5个columnheader及各行cell，不改变DOM结构或样式 | token-table-before.log复现0表头/0单元格；final.log、token-table-review.pw.ts与1280/390px截图通过。200字中文/连续英文完整换行，25项分页及刷新保留，状态与查看顺序正确且零写入；Lint/类型/测试构建通过。不加永久测试；初次实验补足滚动到行，窄屏页码按URL核对（数字按钮在此宽度隐藏） |

| CY / 无需修改 | 两名成员各完成最后一个并行工作：甲先写入但延迟响应，乙完成后需求已100%完成，再返回甲响应，两端不回退；两个完成事件各一次，原历史、开始时间、负责人/协作者保持 | parallel-work-completion-final.log、parallel-work-completion-review.pw.ts；真实双成员/双浏览器、各一次POST200，两端完成筛选及刷新稳定，完整最终DTO不变。初次实验修正DTO字段collaborators；不另造需求手工完成事件，不增加永久测试 |

| CZ / 8239fdf | 甘特外扩不再越过0100—9999年；视图最多36,600个自然日，极端跨度按日期查看并提示。定位完成即保存位置，修复滚动像素相同导致刷新回到旧日期；大跨度窄屏显示日期输入与完整提示 | gantt-range-before.json、boundaries-before/after.log（29项）、browser-final.log（9项）、browser-layout.log（4项复验）及390px截图；零业务写入。新增3项算法和1项浏览器回归。30年范围仍沿用至少1像素/工作日，可横向浏览；夹具分析边界另交DA核对 |

| DA / ad0b58c | 最早合法计划因进度偏差预先计算前一工作日被拒绝409；先查进度对应日期，只有首日进度不足时才计算前日。参考日期越界时省略日期，保留准确的工作日偏差；真实两端单日计划均可创建和查询 | path-date-api-earliest/latest-before.log与boundaries-before.log复现3项失败；after.log57项专项、all-tests.log967项业务及8项性能、api-browser.log2项真实浏览器、Lint/类型/测试构建通过。版本、计划及历史不变；新增2项日期及1项接口回归。窄屏初次截图取于重排瞬间，layout-before.log复测稳定后无重叠，截图已复核；无需样式修改 |

| DB / 无需修改 | 50/200/500需求各5工作项，独立浏览器每档3轮。200需求展开/筛选/清空中位299/76/291ms；500需求724/145/682ms。首次打开约1.05/1.11/1.38秒，分析16/40/84ms；当前不增加虚拟列表或缓存 | progress-scale-before.log、progress-scale-50/200/500-before.json、progress-scale-review.pw.ts。使用预先生成的模拟查询结果，分开记录分析与浏览器耗时；节点数7578/28128/69228，全部条目与唯一命中正确，无异常或写入；不作为真实HTTP延迟结论，不增加永久测试 |

| DC / 63f1fbe | 工作区报表/关系数据后台失败时仅保留旧数据，没有提示或重试；在工作区复用RefreshNotice，重试两项读取，等待时禁用按钮，恢复后移除提示 | workspace-refresh-before.log两条缺少提示失败；after.log3项浏览器含既有特性编辑恢复，Lint/类型/测试构建通过。未提交说明、展开状态保留，清单/进展与390px可用，403→503仍不恢复旧数据，零写入；新增workspace-refresh.pw.ts两条恢复回归，截图已复核 |

| DD / 无需修改 | 项目编辑固定baseProject，后台变化禁用保存；只有明确点击“使用最新设置”才整体载入新资料，不会悄悄拿新版本提交旧字段 | ManagementForms.tsx及form-submission.pw.ts既有“编辑项目后台刷新后不携带新版本覆盖旧草稿”；该用例已在CZ集成通过，不重复运行或改写已验收行为 |
| DE / 无需修改 | 问题逾期标签、SQL筛选/摘要、报表与待处理项均使用相同businessDayDelta规则；SQL函数直接调用共享函数，问题列表同次使用固定asOfDate | issues.ts、database.ts、reporting.ts、requirements.ts、actions.ts；issue-lifecycle.test.ts既有查询日期一致性及domain.test.ts节假日/调休规则已在DA通过，不新增重复测试 |

| DF / 40277f6 | 需求/工作项查询多次读取今天，跨午夜可能把前日结果标为次日；现在每次读取固定asOfDate，传给筛选、详情和路径预测 | query-business-date-before.log复现REST/MCP日期不一致，after.log65项通过；新增2条协议回归覆盖未筛选/逾期列表、单项与需求分页，预测和标签口径一致，计划/工作/进展/审计事实不变；stages-da-df-verify.log全量通过 |

| DG / 无需修改 | 活跃问题由甲转乙后，甲已填的60%提交返回403且历史不变；说明保留，重读后明确只记说明，显式再提交成为note且不改40%；乙随后更新70%，原历史保留 | issue-handoff-first.log、issue-handoff-review.pw.ts、390px截图；真实管理员和双成员会话，转交后仅新增note/progress各一条，甲刷新仍可读和记录说明。类型/测试构建通过，不增加永久测试 |

| DH / 无需修改 | 归属调整只写feature/phase/sort_order及Phase版本，历史交付快照当前只有读取入口，按存储JSON原样返回；现行聚合独立从需求事实计算 | intake-metadata.ts persistOrganization、feature-phases.ts；feature-phases.test.ts既有批量版本冲突整体回滚及历史交付保留，phase-completion.test.ts覆盖范围变更后的聚合，均已在DF集成通过，不重复运行 |

| DJ / 48eccde | 读取特性原先加载完整旧来源后丢弃；抽出带原权限检查的 readIntakeFeatures，REST/MCP 直接读取版本和特性，完整目录的现有调用仍复用该入口 | intake-legacy-scale-before/after.json/log：0/100/1000/5000条款各5版本，7次中位数；5000条款293.49→0.10ms，8→4查询，来源查询4→0；四档结果和历史事实哈希一致。35项导入/迁移/Phase及19项协议/游客访问测试通过，Lint/类型通过；既有MCP测试补1条REST一致性断言，无新用例 |

## 集成验收与业务覆盖

- DN：10/50/100特性、各5 Phase与10需求、每需求100条进展；独立5次中位14.87/83.13/177.03ms，查询数均20。10万历史的最近进展SQL约115.85ms，当前无需优化。feature-history-scale.log/json及三个queries.json保留结果；最近三条按时间/行顺序、取消/归档排除、每个Phase范围与空项目符合独立预期，读取前后完整业务表哈希一致。不新增永久测试。

- DM（4c96999）：npm run verify通过，969项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS936.99KB、CSS342.24KB；覆盖 DJ 的读取简化和 DL 的强制颜色修复。证据：stages-dj-dl-verify.log。

- DL：强制颜色模式下视图按钮和侧栏当前页面失去选中差异，侧栏键盘焦点也不可见；仅在该模式给选中视图加粗下划线、当前页面实线框、焦点虚线框。forced-colors-before.json/截图复现选中差异消失，second.log复现焦点outline为none；final.log 3项浏览器通过，含1280/390px、键盘切换/打开/关闭回焦、零业务写入、退出强制颜色及既有七主题检查。截图已复核，Lint/类型/测试构建通过。初次视图规则被控件层覆盖，已移入button.css的controls层；不增加永久测试。

- DK：workspace-outline.test.ts 已覆盖完整同级版本核对、漏项整批回滚、移动撤销恢复原顺序及后续编辑拒绝撤销；DF 集成通过。unified-workspace.pw.ts 另有真实移动/撤销、键盘排序、筛选停用拖拽、响应未知核对和冲突保留输入用例。实现与覆盖一致，无需修改，本轮未重跑。

- DI：来源条款复核已无 REST/MCP/界面入口；现行导入只显式更新核对字段，旧来源通过迁移保留到历史摘录。intake-api.ts 与 requirement-intake.test.ts 已有旧格式拒绝和保留执行事实覆盖，workflow-migration.test.ts 验证原始数据及摘录保留，均已在 DF 集成通过。无需恢复旧功能；发现的只读额外加载交 DJ 测量。

- DA—DF：npm run verify通过，969项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS936.99KB、CSS342.06KB。原目录仍仅两项用户改动。证据：stages-da-df-verify.log。

- CX—CZ：npm run verify通过，964项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS936.82KB、CSS342.00KB。原目录仍仅两项用户改动。证据：stages-cx-cz-verify.log。

- A—E：npm run verify 通过，948 项业务、8 项性能、26 项浏览器冒烟，运行环境、433 模块依赖边界、Lint、类型、构建及体积预算通过。证据：stages-a-e-verify.log。
- F—K（阶段 L）：npm run verify 通过，954 项业务、8 项性能、26 项浏览器冒烟，其余同上。主 JS 934.37 KB、CSS 344.61 KB，均在现有预算内。证据：stages-f-k-verify.log。
- M—R：npm run verify 通过，954 项业务、8 项性能、26 项浏览器冒烟，运行环境、433 模块边界、Lint、类型、构建及预算通过。主 JS 934.46 KB、CSS 344.61 KB。证据：stages-m-r-verify.log。
- S—Y：npm run verify 通过，955 项业务、8 项性能、26 项浏览器冒烟，运行环境、432 模块边界、Lint、类型、构建及预算通过。主 JS 934.55 KB、CSS 344.63 KB。证据：stages-s-y-verify.log。
- Z—AD（阶段 AE）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、432 模块边界、Lint、类型、构建及预算通过。主 JS 934.82 KB、CSS 344.63 KB。原目录仍仅保留原有两项用户改动。证据：stages-z-ad-verify.log。
- AF—AH（阶段 AI）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、432 模块边界、Lint、类型、构建及预算通过。主 JS 934.86 KB、CSS 344.63 KB。原目录仍仅两项用户改动。证据：stages-af-ah-verify.log。
- AK—AM（阶段 AN）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、431 模块边界、Lint、类型、构建及预算通过。主 JS 934.86 KB、CSS 345.28 KB。原目录仍仅两项用户改动。证据：stages-ak-am-verify.log。
- AO—AR（阶段 AS）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、431 模块边界、Lint、类型、构建及预算通过。主 JS 934.86 KB、CSS 345.28 KB。原目录仍仅两项用户改动。证据：stages-ao-ar-verify.log。
- AU—AZ（阶段 BA）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、428 模块边界、Lint、类型、构建及预算通过。主 JS 935.12 KB、CSS 345.28 KB。原目录仍仅两项用户改动。证据：stages-au-az-verify.log。
- BB—BF（阶段 BG）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、428 模块边界、Lint、类型、构建及预算通过。主 JS 935.17 KB、CSS 345.28 KB。原目录仍仅两项用户改动。证据：stages-bb-bf-verify.log。
- BI—BJ：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、428 模块边界、Lint、类型、构建及预算通过。主 JS 935.24 KB、CSS 345.28 KB。原目录仍仅两项用户改动。证据：stages-bi-bj-verify.log。
- BK—BR（阶段 BS）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、428 模块边界、Lint、类型、构建及预算通过。主 JS 935.35 KB、CSS 345.28 KB。原目录仍仅两项用户改动。证据：stages-bk-br-verify.log。
- BT—BY（阶段 BZ）：npm run verify 通过，956 项业务、8 项性能、26 项浏览器冒烟，运行时、428 模块边界、Lint、类型、构建及预算通过。主 JS 935.59 KB、CSS 341.45 KB。原目录仍仅两项用户改动。证据：stages-bt-by-verify.log。
- CC—CG（阶段CH）：npm run verify通过，957项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS935.74KB、CSS341.45KB。原目录仍仅两项用户改动。证据：stages-cc-cg-verify.log。
- CI—CM（阶段CN）：npm run verify通过，957项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS935.45KB、CSS341.45KB。原目录仍仅两项用户改动。证据：stages-ci-cm-verify.log。
- CP—CR（阶段CS）：npm run verify通过，957项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS935.77KB、CSS341.61KB。原目录仍仅两项用户改动。证据：stages-cp-cr-verify.log。
- CT—CV（阶段CW）：npm run verify通过，961项业务、8项性能、26项浏览器冒烟，运行时、428模块边界、Lint、类型、构建及预算通过。主JS936.27KB、CSS341.61KB。原目录仍仅两项用户改动。证据：stages-ct-cv-verify.log。
- 规模：100/500/1,000 个需求，每项 10 个工作项和 10 条进展。分页总量及 50 条页长符合预期，越界空页正常；1,000 需求时中位数需求查询 977ms、工作项查询 742ms、进展查询 13ms。本轮未重构查询。证据：scale-probe.log。
- 已覆盖：双账号状态同步、日期越界及跨日、批量录入/图形提交的事务和回执、长文本/空数据/窄屏、日志与历史阅读、复制降级。
- 降低重复检查优先级：历史搜索与归档、未知写入核对、已验收日期规则及排序。新证据出现后再深入。
- 无需修改：跨项目页面已有 navigationKey 重挂载；同时间进展顺序已有回归；外观存储读写已有异常降级和 appearance.pw.ts 专项用例；资源读取拒绝后会清空旧缓存。

## 稳定决定

沿用现有业务规则、接口和组件；不引入跨请求结果缓存，不重做已验收方案。每次修改对应具体问题或测量收益；不为持续执行增加功能、架构或无收益测试。
长文本检查同时比较正文与父容器边界，并复核截图；仅检查页面宽度或段落自身 scrollWidth 会漏掉内部段落撑宽后被裁切。

## 当前阶段 DO：较大关系图的搜索定位

范围：在既有20/80/200节点测量之外，检查较大关系图中的搜索定位、查看资料和返回；沿用模拟图数据隔离渲染耗时，不据此推断真实HTTP延迟。

验收：目标节点可定位，详情关闭后继续当前操作，无异常和意外业务写入；耗时与瓶颈记录清楚，无问题则保留现状。

候选：关键词无匹配仍需扫描日志，10万条约0.64秒，暂不引入索引体系或缓存。单人并发SQL过滤试验因条目顺序变化未采用，只有出现更大规模或实际耗时证据时再深入。Phase日期保留0001—0099年支持，排期日期仍沿用0100—9999年范围。近期我的工作往返、文件读取竞争、混合导入错误修正、项目切换器、日志分页/关键词、里程碑重开、归档问题联动、Token撤销、问题搜索反馈、大型表单测量、跨项目草稿、旧界面清理、权限变化、删除工作项、流程复用、人员筛选、样式清理、统计、导出、归档恢复、依赖展示、执行提示、低高度布局、归类、预测与搜索降低优先级。

阻塞事项：暂无。DN测量通过，无需修改，无运行测试；DO准备较大关系图浏览器探针。
