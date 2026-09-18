# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal持续active，没有预设完成点。

## 基线与恢复

- 工作目录D:\tools\project-manage-improve，分支codex/continuous-improvement，起点bd19fa1。当前产品3571ea1（JL），前一产品c0059d1（JK）、06146c4（JG）、c6ca4f3（JC）；README修正c36e4f9。
- 原目录D:\tools\project-manage的dev不改。JL后检查仍只有用户修改skills/project-manage-intake/SKILL.md、未跟踪docs/dcim-ai-workflow-v3-gaps.md。未部署、未推送。
- 临时数据库和独立构建；浏览器使用3296，串行运行；性能独占。3210/3295不改。HZ漏设端口，用默认3291的独立临时服务完成，后续已恢复3296。
- JG组合验收06146c4：983业务/119文件、10性能、26浏览器，运行时/429边界/Lint/类型/构建/预算全通过，verify首轮退出0（exec49747已结束）。主JS940.24KB、CSS342.55KB、ELK1595.33KB；stages-iz-jg-verify.log及performance/build-budget.json。另15目标浏览器及真实传输探针通过，所有句柄已回收。前IX组合基线dc98ee2：982业务/10性能/26浏览器，stages-is-iv-verify.log。
- IQ组合验收：980业务/119文件、10性能、26浏览器，运行时/429边界/Lint/类型/构建/预算均通过。首轮新增边界期望2项错误后补验domain35项和剩余流水线，退出0；不是首轮verify一次通过。stages-im-iq-verify/rest.log；主JS939.62KB、CSS342.57KB、ELK1595.33KB。
- 前IL完整验收ab3e713：974业务/118文件、9性能、26浏览器，运行时、429模块边界、Lint、类型、构建、预算全通过，verify退出0。主JS939.62KB、CSS342.52KB、ELK1595.33KB；stages-ib-ik-verify.log。前全量HZ见stages-hr-hw-verify.log。
- IB：7项不同浏览器、3项加强字段断言的重验，Lint/类型/测试构建通过；现已随IL合并验收。当时无待验收产品修改；后续运行状态见当前阶段。
- IF：12项不同配置/启动检查通过（初轮11通过，1测试替身模块加载问题修正后补验3项），当前pwsh手动夹具也通过，修改测试ESLint和diff检查通过；无需重跑应用全量。
- IH：26既有业务、16既有浏览器旅程及Lint通过；最终会话身份保护调整后补验3项多标签旅程。50项目前后测和5项目回访探针通过，类型/测试构建通过。无运行进程，临时探针已归档。
- IJ：2条真实日志探针、2条既有日志浏览器通过，日期/每页条数/项目条件保持、查询零写入、390px可选；截图已检查。目标ESLint、类型/测试构建、diff通过；探针归档，无永久测试增加。
- IK：31业务/4文件、目标ESLint、类型、diff通过。加强既有样板清理旅程，新增1条历史引用删除回归；无临时探针。
- IL之后IM：99项不同业务（64+37，重叠2项）、最终范围调整后13项重验、3浏览器及五类独立探针通过；ESLint/类型/测试构建/diff通过。新增2项断开恢复回归；无运行进程或未归档浏览器探针。
- IO：11条既有浏览器及1条50项目专项通过；1280/390px、中文同前缀及200字符英文名称完整可见，键盘/鼠标切换正确、完整项目DTO不变、查询零写入、无页面异常；ESLint/类型/测试构建/diff通过，截图已检查，探针已归档。
- 证据在.preview/qa/continuous-goal/，不进版本库。恢复先看当前阶段和git状态，不重跑已通过检查。

详细历史在本文件Git版本：A—DO fd512b7；DP—EV 41a4ed0；FE—HL d35957a；HE—IE 67250e9。后者保留HP/HS探针修正、完整测量、截图及各专项数量。按主题取读，不重新开始。

## 近期成果

| 阶段 / 提交 | 结果 / 证据 |
|---|---|
| JL / 3571ea1 | 两份自动启动脚本的四条中文提示被PowerShell5.1实际读成乱码。仅补UTF-8 BOM；去掉3字节BOM后的SHA256与原文件相同，5.1/当前PowerShell解析和中文值一致，diff通过。autostart-literals-before/after.json、encoding-change.json。Parser首稿探针管道语法错误已修正（parse-before/baseline.json）；原脚本无语法错误，问题仅为乱码。未调用计划任务命令、不增加永久测试 |
| JK / c0059d1 | 补选窗口选A后，他人将负责人设为B；刷新后选框消失但开始仍发送A，原代码真实回归返回400“负责人已指定”。改为已有效分派时省略ownerId，窗口显示当前B。1条新增回归核对只写一次、B保持、版本和刷新状态正确；9浏览器、类型/测试构建/Lint/diff通过。start-assignment-refreshed-before.log/context/png、stage-jk-*，89271失败已回收、63147通过已回收，无运行进程 |
| JI / c36e4f9 | README常用命令修正两处：build只做类型/前后端构建，skill同步独立；浏览器测试默认3291。对照package.json、Vite和两份Playwright配置确认，diff通过；仅文档，不重复测试 |
| JG / 06146c4 | 仅两条path-analysis GET按客户端编码压缩，完整字节、权限、no-store和其它接口保持。500/1000/2000跨需求链真实传输、浏览器解析、三次断开恢复通过；2000样本169.6MB→br1.63MB，普通HTTP浏览器仅接受gzip，另一样本169.6MB→79.3MB。压缩增加CPU，未减少解压后JSON内存。983业务/10性能/26冒烟及15目标浏览器通过，官方运行依赖audit0公告。analysis-compression-http/insecure-http.ts/json/log、stage-jg-*、stages-iz-jg-verify.log；细节见JG验收 |
| JF / 测量，无产品修改 | 同需求/跨需求两种长链，100/500/1000/2000规模各3次，末项日期、全链关键性、循环拒绝、输入不变和结果hash通过。2000跨需求=4000实体、1999依赖，符合现有上限；计算中位765ms，JSON167MB。同规模随机UUID真实HTTP返回169635625B，Accept-Encoding仍无压缩，回环请求2229ms。原字节本地压缩并解压hash一致：br质量4为1626731B/414ms，gzip1为79524524B/2304ms，gzip6为77051770B/4130ms。500/1000真实规模也核对只读、末项日期。dependency-chain*.ts/json/log；HTTP首稿漏依赖created_at，已保存fixture-error并修正。压缩仅是本地试验，尚未接入服务 |
| JC / c6ca4f3 | 4个仅末尾不同的合法长名称在1280/390均被截断，2289—2473px文字挤入315—332px，没有完整名称提示。仅将候选名称/说明改为换行并允许无空格词断行，列表继续限高滚动。6布局及1真实专项通过，8次末尾坐标均在候选内；四项键盘选择、无结果/末尾搜索、仅1次创建、刷新完整Issue DTO一致、零页面异常。类型/测试构建/Lint/diff通过，截图已检查，无新增永久测试。issue-picker-names-before/after.json/png、stage-jc-*；首轮专项在搜索框RAF聚焦前直接focus选项而失败，等待实际焦点后通过，6布局首轮已通过；探针已归档 |
| JA / 891273d | 问题表单的关联需求/负责人/提出人浮层初帧隐藏，autoFocus无效；原代码强化后的既有回归失败。改为显示后RAF聚焦，关闭清理待执行回调。3功能/真实旅程与6种桌面布局通过；真实1280/390键盘搜索、Esc、Tab/Enter选择，取消零写入、仅1次创建、重新打开字段和完整Issue DTO一致，无页面异常。Lint/类型/测试构建/diff通过，截图已检查。既有布局夹具修正people查询匹配，14选项原始布局在搜索前断言；无新增永久测试。issue-picker-focus-before/context/png、keyboard.json、stage-ja-*；真实探针已归档，所有句柄结束 |
| IZ / 6f36dd1 | 协作选择初帧隐藏使autoFocus失效，焦点留在入口按钮，键盘输入zhangsan后搜索仍为空。显示后RAF聚焦搜索或首个复选框，关闭时取消待执行聚焦。两个既有小列表/搜索旅程在原代码失败；修改后7浏览器、ESLint、类型/测试构建、diff通过。1000选项读取夹具打开45—47ms、搜索11—19ms，无需性能改造；实际保存用3个真实目标，隐藏已选保留、Esc零写入、Space/Tab/Enter仅1次保存、刷新一致，1280/390截图已检查。collaborator-picker-focus-before/typing、regression-before、scale.json、stage-iz-*；强化2个既有旅程，无新增永久测试，探针已归档 |
| IV / dc98ee2 | SVG把英文都按窄字符计算，特性/需求/Phase共16行越界，宽标题309—502px挤出280px卡片、Phase名与状态重叠。按字符类别估宽并为省略号留空间，产品净增5行，无字体依赖。25业务、3不同浏览器及1次扩大字符集补验通过；空图、长英文/数字/中文/emoji、XML、完整标题、Phase不重叠、全量分析/需求DTO保持；类型/构建/Lint/diff通过，截图已检查。graph-export-text-before/after/characters、stage-iv-*、graph-font-width。前三次探针夹具分别误用overview、缺overview必填项、未解包features，已记录修正；正式复现和验收日志独立保存。探针已归档，无新增永久测试 |
| IU链接 / 7d70e7b | 需求合并遗漏来源新版referenceLinks，旧实现两个单元场景失败；合并双方新链接并按URL去重、目标名称优先，保留目标旧来源，超20条不截断。7单元、2真实浏览器（正常/超限修正）、Lint/类型/构建通过；完整原文、链接、工作、依赖重映射和刷新后保存核对。intake-merge-links-before、stage-iu-links-*、intake-merge-links-browser.log |
| IT / eee9d38 | 折叠4500工作控件仍创建77446 DOM；事件到两次动画帧计时：整理440ms、标题修改787ms。只在展开时创建工作控件，后测DOM928—946，整理35ms、修改13ms；输入仍存原pkg。17既有浏览器通过，强化原拆分合并旅程：编辑/添加移除/收起重开/刷新后保存保留标题。Lint/类型/构建/diff通过。intake-editor-9-500-before/after、stage-it-*；早先13476ms包含自动化定位成本，不当纯绘制指标 |
| IS / d473f2e | 超过既有4000总对象上限时返回英文JSON；复用导出常量，在导入预览给出本批数量、上限和分批提示。36业务、Lint/类型/构建、1真实浏览器通过；4509对象跳过2需求后3507可预览，全部原文保持、零写入、1280/390截图已检查。三个有效大批次及失败末项/重试全表快照核对通过：1000需求提交1960ms，100需求×10工作2096ms，4000对象边界9220ms。intake-scale-before、intake-boundary、intake-limit-*、stage-is-*；无永久测试增加 |
| IQ / e53c666 | 逐日扫描使100个五年计划真实需求读取中位1000ms、最慢1447ms；二分定位进度日期后24ms/27ms。1808组完整计算结果与原实现一致，产品净增3行，无缓存。980业务/10性能/26浏览器组合验收通过；新增1性能和4日期回归。schedule-variance-*、stages-im-iq-*；首次新增2测试期望错误（负零及周末对齐后偏移）已修正，原产品规则保持 |
| IO / 6348240 | 项目菜单240px单行省略，50个同前缀项目末尾编号不可见；改为320px并按视口收缩、名称完整换行、选中图标不压缩。12不同浏览器通过，project-choice-before/after、project-choice-visibility、stage-io-*及1280/390截图。专项初次End按键早于菜单RAF焦点转入，改为等待实际焦点后通过；无产品键盘修改，无永久测试增加 |
| IM / 6c6d772 | 响应途中断开不触发onResponse/onError，活动计数残留，之后恢复等待10秒并取消；真实4000需求备份下载复现。仅数据库路由在处理函数finally清理计数，未结束写入仍等待且只执行一次。99不同业务、3真实浏览器、五类探针通过。maintenance-abort-baseline/after、maintenance-real-before、stage-im-*。首次探针钩子参数错误修正；初稿包装静态路由破坏回调发送，浏览器3项失败后限定数据库路由，三项全部重验通过 |
| IK / ab3e713 | 迁移保留旧acceptance_owner_id，但归档引用检查遗漏；样板归档会误停用外部旧验收人，普通永久删除报500。两个既有查询纳入旧验收人，同一需求只计一次；样板删除成功且历史人员/账号保留，无引用者仍清除；普通删除409并保留资料。31业务通过，legacy-acceptor-before/sample-before、stage-ik-*。首次样板夹具用无账号旧actor创建需求失败，改为直接构造迁移保留资料后复现 |
| IJ / 906a0a0 | 日志缺少当前业务动作/对象筛选，提测与分析布局显示英文，自动记录误显示“已删除用户”。仅补现有标签表及系统来源选项/名称。真实提测、返工、分析布局重置和系统记录可筛选；4浏览器通过。audit-actions-before/observed、stage-ij-*、audit-actions-narrow/audit-layout-filter截图；当前记录原样保留 |
| IH / 0064a41 | 浏览50项目、每项目100需求的模拟分析响应后，查询缓存过期并GC，未编辑画布会话50→0，堆51.93→12.16MB；5/20项目后测10.85/11.69MB，DOM稳定。卸载后等待存储队列，再释放无编辑/字段/错误且无保存中的会话，旧会话不能释放新会话租约。26业务、16恢复/访客/接管旅程通过；加强既有存储失败测试的跨页输入保留。5项目回访视口/布局完全相同。multi-project-memory-baseline/after/recovery、stage-ih-*；首次空项目缺“其他需求”的夹具失败后补最小需求，不改业务行为 |
| IF / f301ff2 | start.bat调用Windows PowerShell 5.1，configure.ps1无BOM中文先解析失败，补BOM后又因-AsPlainText参数不支持失败。改用NetworkCredential读取SecureString、保存UTF-8 BOM，并将安装依赖放到配置之前。5.1/当前pwsh密码与部署参数保留、指定测试库账号更新通过；冷/热启动顺序用npm/配置/服务替身验证，未下载依赖或操作原账号。configure-powershell51-before/bom-only/after、startup-order-before、stage-if-*、configure-pwsh-*；保留2项启动回归。初测试Read-Host替身依赖Security模块而加载失败，改为直接构造SecureString后通过 |
| IB / 7b6dbaf | 未知创建误认工作阶段或协作人员不同的同名项并清掉草稿。补齐阶段、里程碑名、参与人集合比较；不同资料保留输入，一致资料仍能确认。两条防丢失回归、7浏览器通过；work-create-identity-before、stage-ib-*。仅凭相同资料不能证明并发操作来源 |
| HW / 1c1708b | 工作项名称规范化后无法核对已成功创建；比较复用canonicalizeLabel。混合全角/组合字符/空白旅程通过，零重提、完整DTO不变；5浏览器及Lint/类型/构建，work-title-recheck-before、stage-hw-*。人员/特性规则已一致 |
| IA / baf3208 | README校正人员权限、人力分析、归档、Token/密码入口及独立skill同步命令，删除重复首次配置，净减5行；对照实际路由和脚本验收 |
| HU / c84c5cf | 图表复制为“副本”预留60字符上限；11浏览器、2既有业务通过；analytics-long-copy-before、stage-hu-* |
| HS / 71f888c | 画布/流程长标题复制预留后缀，不切断emoji；卡片标题限制两行并显示完整悬停文字。63不同业务、8不同浏览器及窄屏补拍；canvas-long-copy-*、stage-hs-* |
| HR / 7276541 | 导入格式/类型/长度错误显示中文字段和项次，保留原文；5浏览器通过；intake-error-feedback-*、stage-hr-* |
| HP / 9e6f7b8 | 200字符流程复制超限修复，连续12副本唯一；需求流程选择换行显示完整长名称。50业务、20不同浏览器；template-long-copy-*、stage-hp-* |
| HO / 54a7571 | 人力矩阵仅向右接近末端才自动加周，纵向和过滤复位不加载。1000人923可见服务39ms，模拟完整响应后绘制251—276ms；非真实网络传输。4既有浏览器及规模/窄屏通过；people-scale-*、stage-ho-* |
| HM / 624110c | Phase聚合按组读取，1000 Phase/9000需求由92—116ms降到18—22ms；同库9场景完整DTO一致，无缓存/索引；phase-summary-scale-* |
| HE/HF | 链接核对按服务端规范化规则比较，覆盖需求/工作项/特性/Phase；84c5c72、23ca8fa，stage-he/hf-* |

## 近期无需修改

- JM：统计空结果与跨项目已有真实验收：analytics-empty-review.log的空样本→完成→返工、保存筛选/布局不变通过；analytics-account-scope-checked.log的个人布局跨项目、账号切换、无权项目403、恢复默认独立通过。现有queryKey含项目/范围/面板，范围用页面参数。只读核对记录，不重复运行已通过旅程。

- JH：旧预测核对已退役，workflow-contracts明确剔除reviewForecast，delivery-commitments.test.ts第32行保护旧批次返回400和承诺查询410，migration清空旧值；这些已随JG组合验收通过。残留内部函数不代表存在当前业务入口，不增加复核界面或重复测试。

- IY：真实管理员与两名成员，六状态（初始、替换、移除、完成、归档、恢复）的我的工作、人力分析和详情一致；负责人只计一次，恢复保留工作项全部资料（交付预测revision随归档恢复递增）。旧协作者填写63%和说明后被移除，刷新即禁用提交、原输入保留，强制表单submit零请求且完整需求DTO不变。1浏览器通过（12.9s），collaborator-consistency.log/json及探针已归档；原历史逐条保持，刷新恢复正确、无页面异常。探针首次类型缺失阻止启动；后续修正三个夹具断言/操作：矩阵只显示有安排者、先关闭需求弹窗再导航、不能要求归档恢复后的派生revision不变。无产品修改或新增永久测试，不重跑全量。

- IW：复核问题在项目/需求归档后的列表与汇总。REST/MCP list_issues和dashboard都要求projectId并先校验活动项目；详情也先校验项目。listIssues条目、总数、汇总采用相同的父需求归档条件；恢复沿用原问题资料。integration覆盖汇总/归档分析，deep-regressions及versioned-write-integrity覆盖归档后写入和写锁竞争。未发现不一致，不加重复校验或重复执行已通过测试。接口无全局问题列表入口，不能把服务函数的可选参数认作权限缺口。

- IR：真实IssuesPage资源中断后错误页仍可导航，返回首页后再次进入并重新加载可恢复；当前项目、完整项目DTO保持，实际问题API仍限定原项目，业务零写入。1浏览器通过，失败/恢复截图已检查，page-chunk-recovery.*及探针已归档。初探针误认为侧栏导航必带projectId查询参数，实际使用已记住的项目；改为核对真正发出的问题API范围后通过，无产品修改。

- IP：requirement-cancellation的REST/MCP三种状态旅程已比对存储、详情、看板、行动、取消事件及归档恢复；work-item-deletion保护说明/执行历史，deep-regressions保护父对象终态后的子资源写入。汇总共享deriveRequirementMetrics并排除取消工作项，未发现新偏差；这些既有测试已随IL通过，本轮只读复核，不重复执行。

- IN：Token页面使用useMinuteClock，每分钟及focus/visibilitychange校准；既有personal-experience到期旅程验证“有效”→“已过期”、计数归零、撤销入口消失。服务端每次认证和更新最近使用时均复核到期/撤销/账号；对应MCP/账号测试随IM通过。仅复核覆盖，不重复浏览器测试。偏好存储初查：项目选择、侧栏、主题、分页均有失败容错，未发现必须修改的证据。
- IG：备份清理的失效文件不占有效份数、中断文件24小时保留、清理前同名文件变化跳过、每日失败重试且成功后不重复，已有backup-retention/system/integration测试覆盖并随HZ通过。日期按严格早于保留界限清理，最大份数只统计可恢复文件；只读复核，无新修改或重复测试。
- IC：已存草稿的4次写事务abort，原记录不变、输入保留、正式apply为0；恢复后只apply一次，刷新正确，无页面异常。draft-abort-recovery.log/json/探针/截图；首次打开失败已有回归。
- HX：实际页面往返30轮，GC后设置页3022 DOM节点/373监听器/2实际尺寸观察器/0 Worker/2定时器稳定。堆内存第10轮15.27MB、第30轮16.16MB，不能归因为泄漏。初计数漏算GC，WeakRef已澄清；resource-release-*。
- HY/ID：特殊字符使用字面匹配；MCP分页复用REST且覆盖筛选、空页、越界、历史snapshot，既有测试已在HZ通过，无需重复。
- IE：19:45原服务新增1次成功登录、10次未匹配GET/404，均info，健康200。游客首页48响应/42静态资源全成功，无页面异常；原404缺路径，暂不能定位。runtime-log-review-ie、runtime-assets-ie.*。报告首次误用原cwd未能写入，已在improve保存，原目录未变。
- HT：解决筛选第2页最后一个问题后返回，自动回第1页，筛选及剩余10项DTO保持，仅1写；action-last-page-*。
- HN/HL：跨午夜日期刷新、2026中秋/国庆调休与正倒排一致；holiday-schedule-*。HH：53 Token分页撤销身份正确；token-pagination-*。HI：5001项目六角色查询0.72—3.73ms，无优化必要。HJ：官方npm运行依赖审计0公告，未升级。

## 覆盖与降低优先级的领域

- JD：来源链接无需修改。reference-links.pw.ts已有4对象保存/草稿恢复、完成项补充、键盘排序/删除/窄屏、写响应丢失后刷新核对；mcp-partial-updates保护改名、完成/纠错和省略字段。旧reference-links-scale.log已验证20项长资料1280/390，状态SQL不写链接，本轮只读复核，不重复测试。
- JE：人员姓名按normalizeSearchText去重，恢复也复核同名。person-rename-journey-facts.log既有真实改名旅程通过，账户/会话、未提交进度、成员/问题/工作显示均核对。归档项目保留未结束分配是当前三类计数的一致行为；未发现可直接判定的身份缺陷，不更改停用规则。既有archives-scale已覆盖5000需求，查询中位8.82ms，避免重复规模探针。

- JB：只读核对模板变更。integration约894行保护旧工作项事实；editor-contract-consistency约89行、plan-preview约122行保护旧预览拒绝及新实例；versioned-write-integrity约872行保护默认流程/归档并发和最后有效流程。这些已随IX通过，服务只更新模板表，未发现新问题，不重复运行。既有真实模板保存template-instance-final和归档后改选archived-template-draft-facts均1通过；后者其余命名final/accepted/pass日志仍是早期失败，不能按文件名判断。

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
- 协调阻塞流程已退役，0026迁移清空协调人并将blocked转为现有状态；不能仅凭残留函数认定入口可达。旧验收人字段迁移仍保留，历史引用必须保护（IK）。

## 候选与受阻

- FE已将1000节点/3000边固定路由降至约3.75秒，ELK约4.9秒；首次布局仍约8.8秒，返回后就绪0.8—3.6秒。先降低此领域优先级；无新证据不改算法或加缓存。DO搜索511→288ms保持。
- 日志无匹配10万约0.64秒，暂不引入索引体系。单人并发SQL过滤曾改变顺序，已放弃。
- DU一次迁移测试启动15秒超时、输出为空；单项与同并发重验通过，EB/EJ/EQ全量未再发生。不直接放宽超时。
- 画布与统计面板复制长标题候选分别在HS/HU解决；降低此领域优先级。
- 名称长度并不统一：requireLabel按码点计200，部分创建schema按UTF-16计200；现有copyLabel保守按UTF-16截断。发现代码差异，尚无必须调整的业务证据，暂不统一限制或改已验收方案。
- IE的10次未匹配GET无请求路径；当前游客首页48请求全成功。需原请求路径或复现场景才可定位，暂不改路由/日志隐私规则。
- GT待查项已在GZ完成独立输入节奏对照和实际页面验收，见近期成果。无用户决策事项、无外部阻塞，Goal保持active。

## IU选项试验：未采用

100需求无工作项整理204ms、标题修改53ms、DOM15688/option10403；300需求整理1269.5ms、修改442.3ms、DOM106288/option91203。每条合并select包含其余需求，选项平方增长。intake-editor-100-0-before、300-0-before、cost-before，计时为页面事件到两次动画帧。

仅给当前交互控件创建选项的两稿均为键盘/鼠标通过、触摸无法打开；去掉onBlur清空仍失败。原静态版本同探针触摸成功，确认产品回归。未跑优化后性能，不改全局helper或降低交互断言。两个原型已撤回并归档；exec93921退出1（2通过1失败），全部进程结束。intake-merge-choice-first/no-blur、touch-debug/static、no-blur-context及截图；探针和两个源码版本在证据目录。后续只有更简单且保持原生交互的方案才重启本候选，当前降低优先级。

该轮另发现的合并来源链接遗漏已独立修复7d70e7b；验收见近期成果。工作区无未提交产品修改。周末无工作日计划候选同样降级：当前新建排期明确限制工作日，未发现当前入口证据。

## JG验收：大分析响应的传输压缩

产品06146c4已提交：精确依赖@fastify/compress 9.2.0（新增12个依赖）、path-routes两条分析GET、1项协议回归。插件限定path路由子域，global:false，仅两条GET开启br/gzip；br默认质量4、gzip级别1。普通API、MCP流、备份及请求解压保持原行为。不要用compress:true；每路由须显式编码/级别，本库空对象会用默认值覆盖全局配置。

真实TCP+Edge探针通过：500/1000/2000跨需求链，identity分别13155524/45812143/169635643B，br为209622/540661/1625482B，gzip1为2034262/13147432/79541386B；解压原字节hash全部相同。2000规模回环identity3497ms、br3393ms、gzip6043ms；Edge完整JSON解析3887ms，encoded/decoded大小一致。三次中断响应后维护等待均低于0.1ms、读取hash保持、SQLite零写入。证据analysis-compression-http.ts/json/log。只证明传输缩小，未减少JSON解析内存或验证6001节点完整布局。

协议协商与权限测试通过，identity/q=0/deflate回退、br/gzip优先级、完整字节、no-store、普通API范围均核对。首轮误期望identity也有Vary、未登录401，实际插件仅压缩时加Vary、现有私有项目返回404；修正测试后通过。4文件46项先通过，新回归独立补验1通过，共47不同业务。15浏览器全通过（stage-jg-browser.log）。首次镜像audit接口404（stage-jg-audit.json），官方registry复验0公告（stage-jg-audit-official.json），不改npm设置。

完整验收首轮退出0：983业务/119文件、10性能、26冒烟，所有检查通过，exec49747已回收。普通HTTP补验98023也退出0：域名映射127.0.0.1、isSecureContext=false、实际Accept-Encoding=gzip, deflate，169634533B→79325896B，浏览器解析5119ms；同库回环identity2299ms、gzip4137ms。不能将localhost的br收益当作所有内网部署效果。analysis-compression-insecure-http.ts/json/log，当前无运行进程。

已读官方https://github.com/fastify/fastify-compress及安装的源码，>=8支持Fastify5。不自建紧凑JSON协议、删除affectedRequirementIds、加缓存或重做图布局；后台完整风险列表参与排序及服务查询，不能仅凭前端少用就删字段。

Date的原因输入和IssueStatusControl的折叠说明出现时机不同，暂不认定同类聚焦缺陷。“搜索需求编号”没有独立编号字段，名称内业务编号本来可搜，不因UUID未参与搜索增加功能。Goal保持active。

## 当前阶段 JN：项目空间的批量选择

JG全量通过后，JK另9浏览器/类型/构建/Lint通过；JL仅编码修正并独立验证；JI仅文档。所有成果已提交，无运行进程或临时浏览器测试。JG全量不含后来的JK/JL，不能把它称为最新HEAD完整verify。

下一步核对批量选择在过滤、翻页、对象归档后的选择集与页面计数。先查既有测试和证据，只对未覆盖的真实操作做探针；验收为操作目标与用户看到的选择一致，取消零写入、刷新结果一致。已覆盖的归档权限/写锁、归档行保留并禁用选择不重复检查；无证据不改变选择规则。

JL附带只读核对：startup.test.ts已保护重启75、其他服务占端口64、重复启动不开数据库，随JG全量通过；不重跑。run-server.ps1用LiteralPath及参数调用Node、start.bat引用目录；未实际验证含空格目录的完整启动，不能宣称该场景通过。Goal继续active。
