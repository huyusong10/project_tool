# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal持续active，没有预设完成点。

## 基线与恢复

- 工作目录D:\tools\project-manage-improve，分支codex/continuous-improvement，起点bd19fa1。最新测试工具5ab83f5（KC），最新产品d15deab（JZ），前一产品bd5f0ba（JW）、169a78a（JV）、1896b57（JU）、25c1658（JT）；更早成果见下表与历史版本。README修正c36e4f9。
- 原目录D:\tools\project-manage的dev不改，仅保留用户自己的skill修改和未跟踪文档。未部署、未推送。独立数据库/构建，浏览器端口3296，测试串行、性能独占；3210/3295不改。
- 最新全量JY：993业务/119文件、10性能、26浏览器冒烟，运行时/428边界/完整Lint/类型/生产构建/预算全部通过，stage-jy-verify.log，23980退出0已回收。覆盖JU/JV/JW；JZ/KC在此后仅做目标验收。本次首轮全量通过；JT更早的失败与修复记录仍保留。
- JY生产构建：主JS931.87KB、CSS339.15KB、ELK1595.33KB，预算通过。构建按JR规则清理输出。JT服务端产物的具体字节及引用核对见server-build-artifacts-jt.json，不将旧哈希结果当成JY复验。无运行进程、未归档临时浏览器测试或未验收产品修改。
- 证据在.preview/qa/continuous-goal/，不进版本库。恢复先看当前阶段和git状态，不重跑已通过检查。

详细历史在本文件Git版本：A—DO fd512b7；DP—EV 41a4ed0；FE—HL d35957a；HE—IE 67250e9。JG全量及至JL详细验收、旧基线和探针修正见1ce7589。按主题取读，不重新开始。

## 近期成果

| 阶段 / 提交 | 结果 / 证据 |
|---|---|
| KC / 5ab83f5 | 浏览器验证遗留943组数据库/WAL/SHM共约2.56GB，另2035个备份目录。改用每轮唯一目录，进程正常退出后只清理自身原位目录，失败截图/trace保留。3回归覆盖成功/失败退出、同PID旧资料保留及junction替换拒绝；真实服务两路径、类型/目标Lint/diff通过。playwright-temp-before.json、playwright-storage-real-results.json、stage-kc-*；旧资料未删除，强制终止进程不保证清理 |
| JZ / d15deab | 新建问题所选负责人停用/移出后显示UUID并误称历史负责人，真实2场景原版失败。共用选择控件改为失效提示，仅已保存的原负责人保留历史名称；7行产品差异，强化1个既有回归保护负责人/关联需求失效后改选。2需求、4问题浏览器场景、类型/测试构建/目标Lint/diff通过，390px截图已检查。stage-jz-*、issue-owner-*.json/png；无新增永久测试 |
| JY / 组合验收 | JU/JV/JW目标验证后执行一次全量verify，993业务/119文件、10性能、26冒烟及全部静态/生产构建/预算通过。stage-jy-verify.log，23980退出0已回收。无额外产品修改、未部署或推送 |
| JW / bd5f0ba | 周六使7个既有浏览器场景在建样本时失败；8份测试夹具统一业务工作日并补创建响应检查。继续验收发现实际日期点高8px、标签按16px定位，中心差4px；1行CSS使用既有高度变量，日期及点宽不变。新增固定周末回归原版失败，四层/日周月/390px通过。13个不同浏览器、类型/测试构建/目标Lint/diff通过，截图已检查。weekend-browser-fixtures-before、weekend-point-regression-before、stage-jw-*、weekend-progress-point-before.json/png |
| JV / 169a78a | 旧首次/最近承诺对比都转换成按期完成率后被重复指标校验拒绝，整份个人看板退回默认。仅旧指标转换时去掉重复对比，保留卡片/顺序/筛选；删除统计中已不可达的旧指标计算。新增1真实API回归覆盖6组合、实际完成样本、归档排除、读取及相同保存不改历史，原版失败。36不同业务、2分析性能、2浏览器、428边界、目标Lint/类型/测试构建/diff通过；取消0写/保存1写/刷新完整资料一致，1280/390已检查。stage-jv-*、analytics-legacy-comparison-valid-before.log、analytics-legacy-*.png |
| JU / 1896b57 | 真实历史纠错将前置完成改到09-13、后续开始改到09-12，原系统因工作日坐标折叠而漏报。完成前置按实际日期核对，其他排期保持；3新增回归原代码均失败。163业务、10性能、3浏览器、类型/测试构建/目标Lint/diff通过；真实取消0写、两次保存2写、三视角及刷新提示一致、历史保持，1280/390截图已检查。stage-ju-*、correction-dependency-*、correction-warning-*；无运行进程 |
| JT / 25c1658 | 进入周六后的组合验收暴露3个日期失败。两处夹具改用最近工作日后，实际已完成对象仍出现开始09-20/结束09-18，实际均为09-19。保留工作/直接执行、需求完成节点、已达成里程碑的实际日期，工作日坐标继续用于依赖排期。6确定日期回归原代码全失败，修复后通过；强化既有真实API为日期精确等于存储。完整989业务/10性能/26冒烟及全部静态/构建检查通过；path-completed-nonworking-before、stage-jt-*、stages-jt-verify-final.log |
| JR / d8d7b25 | 两条tsup命令补--clean，生产44文件26.37MB→6文件984482B，测试66文件40.89MB→相同6文件；去掉38+60个未引用旧块，合计65297436B。生产/测试构建（含类型）和预算首轮0、当前引用完整、6文件字节及SHA一致、diff通过。实际start.bat从中文/空格/方括号/&目录启动，健康/资源931873B/登录/创建项目入独立SQLite/重复启动0通过，12037测试树已停止。stage-jr-*、server-build-artifacts-before/after.json、output-match.json、startup-path-*；61506/10503均已回收，无新永久测试 |
| JP / f2e458d | 需求被他人移出当前Phase后，隐藏选择仍用最新版本加入后续真实移动，覆盖他人归属。按当前范围计算批量对象并清理选择，折叠后代仍保留。新增1回归原代码失败；修改后7个不同浏览器场景通过，取消零写入、仅当前需求提交、外部归属/版本保持、未知移动响应刷新后可核对且不重发。类型/测试构建/目标Lint/diff通过；outline-scope-selection-before、stage-jp-*。首轮修复后仅测试误要求项目预测revision不变，已改为核对其余完整DTO；5个既有场景通过后不重复，新增回归及临时状态探针补验2通过，探针已归档 |
| JO / 2bc92fb | 删除被统一清单替代的两套表格、专用选择组件和38个专用CSS选择器；旧mode=table解析保留。JS940395→931808B、CSS342552→339058B，合计减少12081B。31浏览器、类型/完整Lint/428边界/生产构建/预算通过，1280/390截图已检查；stage-jo-*、retired-table-*。无新增测试；CSS初稿误删现用Phase容器，在浏览器验收前复核恢复，保留声明比对通过 |
| JN / 906437a | 选中特性被他人归档后，数量排除但ID仍保留；恢复后自动重选，真实后续批量归档误含甲乙。新增1条真实回归在原代码失败，修复按刷新后的非系统/非归档对象清理选择；仅乙提交、甲完整资料保持、刷新一致。9目标浏览器（含145行、折叠/窄屏、排序/移动/未知写入）、类型/测试构建/Lint/diff通过；outline-archived-selection-before.log/context/png、stage-jn-*。97971失败、42629通过均已回收 |
| JL / 3571ea1 | 两份自动启动脚本的四条中文提示被PowerShell5.1实际读成乱码。仅补UTF-8 BOM；去掉3字节BOM后的SHA256与原文件相同，5.1/当前PowerShell解析和中文值一致，diff通过。autostart-literals-before/after.json、encoding-change.json。Parser首稿探针管道语法错误已修正（parse-before/baseline.json）；原脚本无语法错误，问题仅为乱码。未调用计划任务命令、不增加永久测试 |
| JK / c0059d1 | 补选窗口选A后，他人将负责人设为B；刷新后选框消失但开始仍发送A，原代码真实回归返回400“负责人已指定”。改为已有效分派时省略ownerId，窗口显示当前B。1条新增回归核对只写一次、B保持、版本和刷新状态正确；9浏览器、类型/测试构建/Lint/diff通过。start-assignment-refreshed-before.log/context/png、stage-jk-*，89271失败已回收、63147通过已回收，无运行进程 |
| JI / c36e4f9 | README常用命令修正两处：build只做类型/前后端构建，skill同步独立；浏览器测试默认3291。对照package.json、Vite和两份Playwright配置确认，diff通过；仅文档，不重复测试 |
| JG / 06146c4 | 仅两条path-analysis GET按客户端编码压缩，完整字节、权限、no-store和其它接口保持。500/1000/2000跨需求链真实传输、浏览器解析、三次断开恢复通过；2000样本169.6MB→br1.63MB，普通HTTP浏览器仅接受gzip，另一样本169.6MB→79.3MB。压缩增加CPU，未减少解压后JSON内存。983业务/10性能/26冒烟及15目标浏览器通过，官方运行依赖audit0公告。analysis-compression-http/insecure-http.ts/json/log、stage-jg-*、stages-iz-jg-verify.log；细节见JG验收 |
| JF / 测量，无产品修改 | 同需求/跨需求两种长链，100/500/1000/2000规模各3次，末项日期、全链关键性、循环拒绝、输入不变和结果hash通过。2000跨需求=4000实体、1999依赖，符合现有上限；计算中位765ms，JSON167MB。同规模随机UUID真实HTTP返回169635625B，Accept-Encoding仍无压缩，回环请求2229ms。原字节本地压缩并解压hash一致：br质量4为1626731B/414ms，gzip1为79524524B/2304ms，gzip6为77051770B/4130ms。500/1000真实规模也核对只读、末项日期。dependency-chain*.ts/json/log；HTTP首稿漏依赖created_at，已保存fixture-error并修正。压缩仅是本地试验，尚未接入服务 |
| JC / c6ca4f3 | 4个仅末尾不同的合法长名称在1280/390均被截断，2289—2473px文字挤入315—332px，没有完整名称提示。仅将候选名称/说明改为换行并允许无空格词断行，列表继续限高滚动。6布局及1真实专项通过，8次末尾坐标均在候选内；四项键盘选择、无结果/末尾搜索、仅1次创建、刷新完整Issue DTO一致、零页面异常。类型/测试构建/Lint/diff通过，截图已检查，无新增永久测试。issue-picker-names-before/after.json/png、stage-jc-*；首轮专项在搜索框RAF聚焦前直接focus选项而失败，等待实际焦点后通过，6布局首轮已通过；探针已归档 |
| JA / 891273d | 问题表单的关联需求/负责人/提出人浮层初帧隐藏，autoFocus无效；原代码强化后的既有回归失败。改为显示后RAF聚焦，关闭清理待执行回调。3功能/真实旅程与6种桌面布局通过；真实1280/390键盘搜索、Esc、Tab/Enter选择，取消零写入、仅1次创建、重新打开字段和完整Issue DTO一致，无页面异常。Lint/类型/测试构建/diff通过，截图已检查。既有布局夹具修正people查询匹配，14选项原始布局在搜索前断言；无新增永久测试。issue-picker-focus-before/context/png、keyboard.json、stage-ja-*；真实探针已归档，所有句柄结束 |
| IZ / 6f36dd1 | 协作选择初帧隐藏使autoFocus失效，焦点留在入口按钮，键盘输入zhangsan后搜索仍为空。显示后RAF聚焦搜索或首个复选框，关闭时取消待执行聚焦。两个既有小列表/搜索旅程在原代码失败；修改后7浏览器、ESLint、类型/测试构建、diff通过。1000选项读取夹具打开45—47ms、搜索11—19ms，无需性能改造；实际保存用3个真实目标，隐藏已选保留、Esc零写入、Space/Tab/Enter仅1次保存、刷新一致，1280/390截图已检查。collaborator-picker-focus-before/typing、regression-before、scale.json、stage-iz-*；强化2个既有旅程，无新增永久测试，探针已归档 |

## 近期无需修改

- KA：双项目真实经理日志旅程通过。甲末页21条固定快照；甲乙新增后切乙不带旧快照、显示乙新增；返回甲恢复原页2/21条，刷新才看到22条。降为观察者后甲及平台审计403、旧表格清空，乙仍可查看/刷新；24条问题完整DTO不变、浏览器业务零写入、无页面异常。stage-ka-audit-scope.log 1通过（64588退出0已回收），audit-role-scope.json，390px无权页截图已检查。临时探针已归档，无产品修改或新增永久测试。

- KB：跨项目流程复制已有BH完整真实验收，template-copy-complete.log确为1通过（10.3s）；探针覆盖两份副本的引用/分类/人工确认/晚做锚点、编辑后来源35%执行事实和已有实例保持、新实例采用新内容。当前copyTemplate新建独立项，saveTemplateGraph映射副本ID，更新校验项归属；JY已通过template-copy/path-api/feature-phases/写锁回归。无需修改，不重复运行。copyLabel与现有来源读取规则保持。

- JX：真实11条问题，末页取消改关联零写；甲→乙后页码2→1、筛选10/总数11，浏览器返回保留查询/负责人/优先级/范围/每页数；乙→公共后原范围为空，刷新公共筛选仍1条。两条需求汇总同步、目标完整DTO仅归属/版本/更新时间变化、总共2写、无页面异常，390px截图已检查。stage-jx-issue-scope.log 1通过（86387退出0已回收），issue-scope-return.json/png，临时探针已归档；前两次失败均为探针选择器（同名候选未限定弹层、误写内联标签），selector-fixture及inline-label-fixture日志保留，43349/41209退出1已回收。产品无需修改，不增加永久测试。

- JS：按IE记录的16个日志字节偏移只读检查，至2026-09-18 23:59:57无新增字节/事件，无解析错误；健康200。runtime-log-review-js.mjs/json保留新恢复入口，不重读旧事件或推断无法定位的历史404。无产品修改。

- JQ：导出与重新上传已有intake-export-final.log及stage-it-browser.log验收，不重复。另实际上传UTF-16LE文本/UTF-16BE JSON，中文、𠮷、emoji和组合字符读取/导出UTF-8 JSON/重传/保存通过；正式提交前零apply，最终仅2写/2需求，刷新一致。Edge原生File.text实读BOM正确，无产品修改或新增永久测试。intake-utf16-checked.log（33745退出0）、intake-utf16-probe.pw.ts；首轮仅误要求数据库不做既定NFC规范化而失败（85628退出1），修正断言后通过。临时测试已归档，原文件hash与HEAD相同。

- JM：统计空结果与跨项目已有真实验收：analytics-empty-review.log的空样本→完成→返工、保存筛选/布局不变通过；analytics-account-scope-checked.log的个人布局跨项目、账号切换、无权项目403、恢复默认独立通过。现有queryKey含项目/范围/面板，范围用页面参数。只读核对记录，不重复运行已通过旅程。

- JH：旧预测核对已退役，workflow-contracts明确剔除reviewForecast，delivery-commitments.test.ts第32行保护旧批次返回400和承诺查询410，migration清空预测核对字段，保留承诺历史；这些已随JG组合验收通过。残留内部函数不代表存在当前业务入口，不增加复核界面或重复测试。

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

## 旧阶段详细证据

JG/JN/JO的协议协商、普通HTTP压缩、CSS删除复核及早期启动脚本核对详见本文件Git版本13eb56a；成果表保留结论。压缩稳定决定：只给两条分析GET配置compress编码与级别，插件global:false；不能用compress:true或依赖空路由对象继承全局设置。普通HTTP不假设支持br。

## JP验收：选择对象被移出当前范围

原代码实际复现：在Phase 2选择两需求，他人将其中一条移到Phase 3；重连刷新后该行消失但仍选2条，再次移动实际请求含两条，覆盖外部归属。取消操作原本零写入。outline-scope-selection-before.log及截图/context，45967退出1已回收。

WorkspaceOutline改为当前范围scoped计算picked/清理ID，共11行调整；memo保留范围树引用，折叠行不排除。原请求pending/moving仍独立。新增1条回归保留；5个既有回归（归档恢复、移动撤销、未知排序、冲突、拖拽）通过。首轮新回归仅因派生deliveryForecast.revision由51→55而失败，产品归属/版本已保持；修正为除此项目修订号外完整DTO比较，stage-jp-browser-forecast-assertion.log。37361退出1已回收。

追加2项通过：修正回归、临时实际折叠/展开保留选择→进入Phase清空→移动已生效但响应丢失→重连对象移出→刷新后原请求/原因/正式Phase仍可核对→仅1写且版本+1。stage-jp-browser-final.log（39459退出0已回收）、stage-jp-state-probe.pw.ts已归档，零页面异常；目标Lint、类型/测试构建、diff通过。无运行进程。

## JR验收：构建输出与特殊目录启动

package.json仅两行添加已安装tsup帮助中确认的--clean。执行前确认两个输出目录为工作区内普通目录，未通过链接指向其他位置。清理98个无当前引用的旧块，不改部署/迁移/启动规则。两种构建与预算、产物相等检查和真实Windows启动均通过，详见成果表。

独立部署探针保留在.preview/qa/continuous-goal/启动 验证 [JR] & LgWieM；配置/数据库/日志仅测试使用，node_modules为指向当前依赖的junction，不要递归清除此目录。实际端口12037，已停止。原dev目录仍只有用户的skill修改和未跟踪文档，无部署或推送。

## JT验收：已完成对象的实际日期

首次verify在2026-09-19凌晨退出1（54503已回收）：980业务通过，3项在工作项排期返回400，后续性能/冒烟/构建尚未执行。两处测试直接用周六todayIso当计划开始；按现有工作日约束改为addBusinessDays(todayIso(),0)，业务断言不放宽。stage-jt-weekend-fixtures.log：25通过后，path-api的已完成日期起止顺序仍失败，暴露产品问题。

实际完成日期被工作日坐标取整：2026-09-19开始/完成的工作显示09-20开始、09-18完成。新增直接执行/工作项两种模式×周六、调休周日、节假日共6确定日期回归，原代码全失败；path-completed-nonworking-before.log。最初口头推测“周一”不准确，现有业务日历09-20为调休工作日，以确定日期测试为准。

已提交4文件：paths保留已完成工作/直接需求、需求完成节点和已达成里程碑的原始日期，仅工作日偏移用于依赖计算。18条paths最终通过；此前另26条API/行动旅程通过。首轮确定日期测试对09-20后续工作的期望误按当日，改为实际下一工作日09-21后通过，产品调度算法不变（stage-jt-paths-after/final.log）。既有真实API断言强化为起止/排期日期精确等于存储事实。

完整verify退出0：989业务/119文件、10性能、26冒烟及全部静态/构建/预算通过；62874已回收。首次54503失败也已回收，所有探针均已结束。

## JU验收：历史日期纠正与依赖核对

真实API已复现：顺序完成前置并开始后续，再用correct接口将前置纠正为09-11开始/09-13完成、后续09-12开始。两次200、原历史完整保留、startAcknowledged=false，但ownReasons/unknownReasons为空。correction-dependency-probe.ts及api-before.log/before.json，使用独立数据库，无原系统写入。

1896b57已提交paths.ts与paths.test.ts，共24增/6删：内部保留actualStartDate（输出时移除），已完成前置用forecastEnd实际日期比较，工作日坐标用于其他计算。新增3个回归分别保护工作项/需求/直接执行依赖，原代码均失败；早于前置提示、同日不误报、已确认例外和输入不变。44路径/API、119关联业务（6文件）、类型/测试构建/目标Lint通过；stage-ju-paths/related/lint.log。真实API复验提示已出现、事实与历史保持，api-after.log/result.json。

3浏览器通过（82653退出0已回收）：现有依赖草稿/撤销和同日完成、连续历史引用、临时真实页面纠错。后者取消0写/两次保存2写，清单/进展/关系图和刷新均显示提示、完整需求资料保持、零页面异常，1280/390截图已检查。stage-ju-browser.log、stage-ju-correction-probe.pw.ts已归档、correction-warning-*.png。5775关联业务句柄已回收。10性能全部通过（14.41s，89700退出0已回收），stage-ju-performance.log；本阶段合计163项不同业务回归、10性能、3浏览器及目标Lint/类型/测试构建/diff通过。所有句柄结束、探针已归档。最新全量仍为JT，未把JU目标验证写作全量验收。Goal保持active，下一阶段切换到其他业务领域。

## JV验收：旧统计布局兼容

统计兼容修复仅2文件（35增/18删）。测试直接写入独立SQLite旧布局，再通过实际REST读/查询/相同保存；6种有效旧组合保留7张卡片及原配置，仅去掉转换后相同的对比。按实际09-09/09-11完成计算50%/2样本，旧验收日期08-15不参与，归档样本排除。原始布局、需求和审计逐条保持；当前重复指标仍400。analytics-legacy-comparison-valid-before.log在修正夹具后再次运行原版，明确返回default而非personal；产品修改已恢复并验收。

最初新增测试遇到样本缺失：原fixture用周六todayIso创建需求返回400却未校验，旧2测试仍通过。已改最近工作日并检查200；中间尝试只改完成状态/工作项没有解决创建失败，相关日志保留在stage-jv-legacy-fixture/missing-fixture/business.log。最终stage-jv-legacy-final.log 3通过；business.log其余4文件33通过，合计36个不同业务通过，不重复已通过项目。没有把首轮写成全通过。

stage-jv-browser.log 2通过（80713退出0已回收），包括原图表切换/真实预览保存与临时旧指标页面旅程；后者通过当前REST提交旧配置（原存储读取由API回归覆盖），原卡片/指标100%/1样本正确，取消0写/保存1写，刷新完整需求及布局保持、零页面异常。探针已归档。分析默认/24面板及各时间策略性能2通过（其余8跳过），stage-jv-performance.log；无性能提升幅度声明。所有句柄已结束，原dev仍只有用户两项改动。

## JW验收：周末夹具与进度日期点

原版7场景周六建样本失败，weekend-browser-fixtures-before.log（69868退出1已回收）。8份测试将合法排期样本改为最近业务工作日，包含3处UTC当天及2处里程碑目标日期；补3处缺少的创建成功检查，保留既有业务断言。首轮8通过/2失败，后续补验2+2通过，stage-jw-browser/browser-final/point-after.log。没有重跑已通过场景。

对齐断言原先把非工作日日期点当作有长度时间条，改为比较点中心，精度仍小于2px。继续失败后实测产品差异：标签中心y348、日期点中心y344（点高8px、标签按16px定位）。初步“仅测试问题”判断已纠正。1行CSS让workspace内实际日期点使用既有--gantt-actual-height（默认16、特性10），保持5px点宽和实际日期；weekend-progress-point-before.json/png及stage-jw-point-diagnostic.log。

新增1条固定09-12周末真实完成/纠错回归，覆盖特性/Phase/需求/工作、日周月及390px，完整需求DTO不变。原版删除1行CSS后明确失败（weekend-point-regression-before.log，47226退出1已回收），恢复后通过。初稿行选择器漏feature:/phase:前缀，已修正；窄屏附加定位误用了隐藏的日期输入，已换真实横向滚动，未改产品导航。stage-jw-point-alignment/narrow-navigation-fixture/final.log，81601/52366/5130均已回收，最终5130退出0。1280/390截图已查看，标签中心能命中，无固定列遮挡。

累计13个不同浏览器场景、类型/测试构建、8份测试目标Lint与最终补验Lint、diff全部通过。9文件41增/15删已提交bd5f0ba；产品只增1行CSS，其余为测试。全部句柄结束，无临时测试或未验收修改。最新全量仍为JT；JU/JV/JW为各自目标验收，不声称已完成新全量。

## JZ验收：创建期间负责人失效

需求表单原行为正常：实际停用/移出后提示失效，400不创建且保留标题/背景/标准，改选后200仅1条，刷新DTO保持；2通过，stage-jz-create-owner.log，14919退出0已回收。初稿空项目有两个“新建需求”入口，限定到已打开菜单后修正，create-entry-fixture.log 2失败，85608退出1已回收。

问题表单相同旅程原版显示UUID，两种状态均未提示不可用；stage-jz-issue-owner-before.log 2失败（83176已回收），before-label.json/png保留原证据。服务器均正确400、改选可创建，缺陷只在显示。最终复用SearchSelectField失效标签，不新增缓存；ownerOptions只补已保存的原负责人。强化既有经理创建回归，包含关联需求消失、负责人停用/移出、保留标题、改选、只提交1次；普通成员入口保持。

最终stage-jz-issue-owner-final.log 4通过（85703退出0已回收）：两真实问题旅程各1次拒绝、1次创建，完整DTO/输入保持；已保存的接手人再停用仍显示姓名与历史标识，取消零额外问题写入。首版字段专用提示的4通过只作中间记录after.log（65294已回收），最终已简化为共用回退。390px原版及最终截图已查看、提示完整可读。两轮合计6个不同浏览器场景，目标Lint/类型/测试构建/diff通过；d15deab已提交2文件29增/7删，临时探针全部归档，无运行进程。未因显示修改重跑JY全量。

## KC验收：浏览器验证临时资料

旧配置只用PID命名且没有清理入口；实际943组数据库/WAL/SHM共2563910064B，另13个JSON4095B及2035个备份目录，备份内容未计量。只读统计保留于playwright-temp-before.json，未删除旧资料。两条原版退出回归失败，playwright-storage-before.log。

5ab83f5只改配置及新增3条子进程回归：0/1退出码保持，旧同PID资料不覆盖，junction替换后拒绝清理并保留两处数据。实际Windows服务成功1通过、故意断言失败1失败，均曾写真实DB/WAL/SHM/备份，退出后目录消失；失败截图和trace已另存证据目录。playwright-storage-real-results.json、stage-kc-browser-success/intended-failure.log。首稿仅页面标题定位错误，heading-fixture.log保留；错误路径同样清理成功。最后3回归、目标Lint、类型/diff通过，临时探针已归档，3296无监听。正常退出清理不能涵盖操作系统强制终止；失败时报告保留路径并返回非零，不增加后台扫描。

## 当前阶段 KD

检查账号密码变更后的会话与页面恢复：先核对现有真实旅程和服务测试，仅补查未覆盖的多会话状态变化、重新登录与输入处理。验收要求旧会话按现有规则失效、没有越权写入，重新登录后业务资料一致；无证据不修改。Goal保持active，没有预设完成点。
