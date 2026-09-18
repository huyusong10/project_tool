# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal持续active，没有预设完成点。

## 基线与恢复

- 工作目录D:\tools\project-manage-improve，分支codex/continuous-improvement，起点bd19fa1。最新产品b099f36（KM）；前一产品7e0f43e（KG）、0451f2e（KF）、d15deab（JZ），测试工具5ab83f5（KC）。更早成果见下表与历史版本。
- 原目录D:\tools\project-manage的dev不改，仅保留用户自己的skill修改和未跟踪文档。未部署、未推送。独立数据库/构建，浏览器端口3296，测试串行、性能独占；3210/3295不改。
- 最新全量KH：996业务/120文件、11性能、26浏览器冒烟，运行时/428边界/完整Lint/类型/生产构建/预算全部通过，stage-kh-verify.log，7808退出0已回收。覆盖JZ/KC/KF/KG；本次首轮完整通过，早期失败及修复证据仍保留。
- KH生产构建：主JS931.92KB、CSS339.16KB、ELK1595.33KB，预算通过，按JR规则清理输出。不将JT旧产物哈希当成KH复验。浏览器临时目录正常清理；无运行句柄、未归档临时浏览器测试或未验收产品修改。
- 证据在.preview/qa/continuous-goal/，不进版本库。恢复先看当前阶段和git状态，不重跑已通过检查。

详细历史在本文件Git版本：A—DO fd512b7；DP—EV 41a4ed0；FE—HL d35957a；HE—IE 67250e9。JG至JL详验见1ce7589；JP—JZ详验见dc53ed7。按主题取读，不重新开始。

## 近期成果

| 阶段 / 提交 | 结果 / 证据 |
|---|---|
| KM / b099f36 | 草稿对象被他人删除后，冲突标题与摘要显示ID，即使基线有名称。3行产品修改优先使用已知名称，无名称时冲突提示具体对象类型；合并规则不变。新增1回归原版失败，16业务、4不同浏览器、类型/测试构建/目标Lint/diff通过；真实核对0写、最后仅1批保存其他修改，删除对象不恢复，刷新DTO一致，1280/390截图已检查。stage-km-*、deleted-draft-km-*；KH全量尚未包含KM，当前目标验证已完成 |
| KH / 组合验收 | JZ/KC/KF/KG目标验证后执行一次完整verify：996业务/120文件、11性能、26冒烟及全部静态/生产构建/预算通过。stage-kh-verify.log，7808退出0已回收。无额外产品修改、未部署或推送 |
| KG / 7e0f43e | 候选姓名/说明单行省略，末尾区分信息在1280/390不可见；2行CSS允许换行并按内容取行高，列表保持限高滚动。同时修复菜单项消失后弹窗无法返回焦点：关闭前只在焦点仍位于菜单内时还给入口。新增1条菜单真实回归原版失败；6个不同浏览器、目标Lint/类型/测试构建/diff通过，12处文字末尾实际可见、取消0写/最终仅1人1写、来源成员及刷新DTO保持，1280/390截图已检查。stage-kg-*、topbar-modal-focus-before.log、member-labels-* |
| KF / 0451f2e | 5000人候选查询为每人扫描整张账号表，默认742ms、拼音1136ms。1行SQL指定现有人员唯一索引后降至6.33/46.51ms；100/1000/5000规模9类查询共27组内容/顺序/hash完全一致且只读。新增1条性能回归原版失败；11性能、22业务、真实5000候选跨搜索/角色竞争旅程、类型/测试构建/目标Lint/diff通过。member-candidate-*、stage-kf-*；390px截图已检查，临时探针归档且临时数据库已自动清理 |
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

- KJ：JS之后仅读17份日志新增379B：02:00自动备份开始/完成（33ms），无警告/错误/解析异常，02:16健康200。新备份3112960B，独立只读副本integrity_check=ok、外键违规0、33表；源文件大小/时间/SHA保持，临时副本已清理。runtime-log-review-kj、runtime-backup-kj.mjs/json、stage-kj-backup.log。首个内存反序列化因WAL格式报SQLITE_CANTOPEN，未误判备份损坏；未恢复或修改原服务。新日志游标以KJ为准。
- KI：人员目录0/100/1000/5000人×全局/项目×含/不含归档，共16组合完整结果与独立预期一致，48次读取保持零写入。5000人中位6.93—7.94ms；三处账号子查询均自然使用idx_accounts_person，没有KF的逐人扫描，无需修改。people-account-lookup.ts/json、stage-ki-directory-query.log；不新增永久测试。
- KD：密码重置恢复已有CB真实双账号验收，password-session-accepted.log确为1通过（11.9s）。旧提交401且DTO不变、临时登录强制改密、返回原需求后仅1次新进度、旧历史保持。当前reset/changeOwnPassword仍递增会话版本，授权逐请求检查，改密/写锁回归已随JY通过。无新缺口，不重复运行。
- KE：需求历史已有100/1000/5000条真实桌面/390px验收，requirement-history-browser-after.log 1通过；browser.json记录5000条首开约953ms、末页约49ms、零写入/异常。EC跨需求页码独立、往返及刷新已有9通过的position-after.log；当前WorkItemHistory沿用按工作项独立分页。只读复核，无修改或重复测量。
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
- JR独立启动探针.preview/qa/continuous-goal/启动 验证 [JR] & LgWieM包含指向当前依赖的node_modules junction，不递归删除该目录。
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

## KC验收：浏览器验证临时资料

旧配置只用PID命名且没有清理入口；实际943组数据库/WAL/SHM共2563910064B，另13个JSON4095B及2035个备份目录，备份内容未计量。只读统计保留于playwright-temp-before.json，未删除旧资料。两条原版退出回归失败，playwright-storage-before.log。

5ab83f5只改配置及新增3条子进程回归：0/1退出码保持，旧同PID资料不覆盖，junction替换后拒绝清理并保留两处数据。实际Windows服务成功1通过、故意断言失败1失败，均曾写真实DB/WAL/SHM/备份，退出后目录消失；失败截图和trace已另存证据目录。playwright-storage-real-results.json、stage-kc-browser-success/intended-failure.log。首稿仅页面标题定位错误，heading-fixture.log保留；错误路径同样清理成功。最后3回归、目标Lint、类型/diff通过，临时探针已归档，3296无监听。正常退出清理不能涵盖操作系统强制终止；失败时报告保留路径并返回非零，不增加后台扫描。

KC补验：普通/性能配置分别执行--list，check:browser-matrix通过（753功能、183布局、2性能；普通矩阵1851实例），stage-kc-matrix.log；只列清单，未重复执行浏览器场景。

## KF验收：候选人员查询

原查询计划为SCAN a LEFT-JOIN，5000人九类查询中位742—1171ms；指定已有idx_accounts_person后变为按person_id单次查找，中位6.33—46.51ms，无新索引/缓存。永久回归在原版默认查询769.8ms而失败，修复后默认6.19ms、拼音27.34ms，所有样本低于250ms，归档/停用/现有成员、已删除账号/无账号及只读断言通过。member-candidate-regression-before.log、scale-before.json、comparison.json、queries-before.json、stage-kf-performance-samples.json；不同夹具的时间不混用。

stage-kf-performance.log 11通过（9525退出0）；business.log 22通过；lint及浏览器自带类型/测试构建通过。真实服务装入5000人员/账号，现有上限仍50候选；打开操作约34ms、搜索到选中约126ms（含自动化交互，不称纯渲染耗时）。取消未改变成员；跨搜索两选择保持，甲已被他人加入为经理，提交仅2次，甲角色保持、乙添加为成员；原项目成员和需求完整DTO保持，零页面异常。stage-kf-browser.log 1通过（88274退出0已回收），browser.json、scale-390.png；重载后的network为空，不据此声称网络耗时。所有探针已结束归档。

## KG验收补充

原版候选文字574—1169px，桌面仅435px/窄屏182px，末尾不可见；labels-before-final.log复现全部文字裁切及窄屏取消焦点丢失，操作仍准确只写1次。新增永久菜单回归原版也失败（97744退出1已回收），修复后添加成员/修改密码两种弹窗均能连续键盘打开、Escape/关闭返回且业务0写。

首稿探针错误点击窄屏已移入更多菜单的按钮，toolbar-fixture.log保留，修正为既有headerAction；首次组合5通过/1失败因其他测试留下候选，改为核对本探针两条姓名。只改换行的初稿仍压缩网格行导致内容重叠，labels-after.log、grid-shrink.json/png保留；补grid-auto-rows后最终labels-final.log 1通过（47805退出0）。最终三人×两字段×两宽度均不裁切，且12处末尾能滚动至真实可见位置。390/1280截图已查看，所有临时探针已归档，无运行句柄。

## KK验收：游客登录普通成员

真实3296旅程通过：游客甲登录仅加入私有乙的普通成员，URL保持；甲人员资料去除账号字段、无编辑入口、写入403；乙仅1次进度写入42%、版本+1和1条说明，刷新完整DTO一致。返回甲仍只读，撤回公开后旧详情/工作区清空、接口404；乙仍可编辑，双方成员及甲业务资料保持。甲预测revision随项目设置+1，其余完整资料不变。1280/390截图已检查，无溢出或页面异常。

stage-kk-browser-final.log 1通过（89622退出0已回收），guest-member-kk.json/png、探针已归档。首轮7732失败是误要求预测revision不变；第二轮73867失败是网络记录漏查询参数，不能把/dashboard?projectId=甲的预期404归入甲；修正后通过，初始日志/资料/trace保留。无产品修改、无新增永久测试，3296已停止。

## KL验收：MCP只读开销，无需修改

独立真实HTTP服务预热15次后测量129次：项目/变更版本REST各30次中位1.41/1.60ms，对应MCP8.27/8.72ms；107项工具清单9次中位13.89ms、101176B。各次结果与REST一致，MCP正文与结构资料一致；31张表hash保持（仅排除Token最近使用时间），每轮连接归零，临时库已清理。三轮GC后heap58.21→58.70MB、external保持7.47MB，没有据此宣称不存在长期泄漏。mcp-read-cost-kl.ts/json、stage-kl-mcp-cost.log，退出0，无产品修改或永久测试。

## KM验收补充

原版真实工作项删除后有2条冲突，当前步骤和撤销步骤标题均为UUID；stage-km-browser-before.log，57254退出1已回收。探针同时误要求点选一项立即移除该行，实际保留全部行直到全部核对；已改为逐项选择。新增单位回归原版失败，修复后同时验证实体/估算、无基线提示、不得保留失效对象及其他修改不丢失。

stage-km-unit.log 16通过；browser-after.log 1通过（15774退出0）、browser-regression.log 3通过（58705退出0），均已回收。预览不计业务写入；外部删除单独发出，页面核对0写、最终apply1写，无页面异常。目标Lint、浏览器自带类型/测试构建通过；临时探针已归档，新临时目录全部清理，3296无监听。没有重复执行KH全量。

## 当前阶段 KN

KM真实操作发现多条冲突时，选择一项后仍展示相同按钮，缺少已选反馈。检查这是否妨碍逐项核对，以及最后一项触发重新计算时能否保留先前选择；用有两种处理选择的真实字段冲突确认。若复现，仅补选择反馈，不改变自动合并、写入或撤销规则。候选基于本次新证据，不重新检查已验收的删除名称。
