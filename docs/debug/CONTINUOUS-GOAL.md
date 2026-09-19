# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal保持active，没有预设完成点。当前阶段验收后继续选择不同重点，不因清单清空结束。

## 恢复入口与当前阶段 OQ

1. 工作目录 `D:\tools\project-manage-improve`，分支 `codex/continuous-improvement`，起点 `bd19fa1`。先看本记录和 `git status --short`，按主题读代码与证据，不重新开始。
2. 当前阶段OQ：检查项目中心查看项目后进入项目空间的操作。当前项目名称是不可交互文本，列表无搜索；不新增搜索功能，先验证按项目ID直达空间能否减少再次选择，并检查分页返回、长名、键盘和390布局。OP完整验证通过并提交4985552。
3. OK已验收：旧版流程开始偏移复用EditorField，0–1830整数就地校验，错误输入保留、切换对象不串值，修正1830/0各一次PATCH200。10不同浏览器场景、目标Lint、类型/测试构建/diff通过，390截图已看；无新永久测试。OP完整verify已覆盖OK。
4. 最新产品 `4985552`（OP）、`7e375d0`（OK）、`5dca0b5`（OJ）、`a79fe72`（OD）、`fedbd45`（OC）。NN将记录约61KB/389行压为约20KB/121行，提交3aca1b2，详细历史保存在 `cac4ecd`。
5. 原目录 `D:\tools\project-manage` 的dev不改，仍仅用户的 `skills/project-manage-intake/SKILL.md` 修改和未跟踪 `docs/dcim-ai-workflow-v3-gaps.md`。未部署、推送或合并；3210/3295不改。
6. 浏览器端口3296，独立数据库/构建；浏览器串行，性能独占。每次浏览器命令设置 `$env:PLAYWRIGHT_PORT='3296'`。全部句柄已回收，探针归档；OP的92930退出0，无运行测试。OP结束3296监听0、当前浏览器临时目录0，原目录仍仅2处用户修改。

## 当前验收基线

| 范围 | 最终证据与边界 |
|---|---|
| OK专项验证 | 32623的stage-ok-after九个既有浏览器通过；58365的stage-ok-complete通过完整偏移探针。共10不同场景，类型/测试构建、目标Lint/diff通过；仅此后新增key限定偏移字段实例，由两对象切换探针覆盖。所有句柄已回收，无新永久测试 |
| OP完整验证 | `stage-op-verify.log`首轮退出0（92930已回收）：998业务/120文件、13性能、26浏览器冒烟（1.2min），运行时、428边界、完整Lint/按钮规范、类型、生产构建、预算均通过；覆盖OP/OK/OJ。此前OJ为12性能 |
| 生产体积 | 主JS934.28KB、CSS339.37KB、ELK1595.33KB，服务端6文件/app878.08KB；按JR清理旧产物。`stage-op-performance-samples.json`保存完整性能样本，源`coverage/performance/samples.json` |
| 浏览器清单 | 最新`stage-np-matrix.log`：771功能/183布局/2性能、普通1869实例；这是列举结果，未执行整个矩阵。NT结束3296监听0、当前测试临时目录0；原目录仍只有2处用户改动 |
| 原服务增量 | 最新游标OL：2026-09-19T04:07:02.773Z；较OA约67分钟，17日志新增0字节/0事件，无错误/读取失败，3210健康200。`runtime-log-review-ol.mjs/json`、`stage-ol-runtime.log`。只检查后续增量，不短间隔轮询 |
| 原备份 | KJ已验证 `project-manage-2026-09-19T02-00-10-969.db`，3112960字节，完整性ok/外键0/33表、源SHA保持；后续元数据未变，不重复完整性检查。`runtime-backup-kj.json` |
| 依赖证据 | JG官方生产依赖审计9月18日23:06为0公告，lock最后提交06146c4；LY只复核未变。这是旧证据，不代表当前安全快照 |

OP完整验证覆盖本轮全部产品修改。原目录仍仅2处用户修改。没有新增修改或验收疑点时不反复重跑已通过检查。证据在 `.preview/qa/continuous-goal/`，不进版本库。

## 近期产品成果

表内专项均已验收，OP完整验证覆盖本轮全部产品修改。NP以前的失败尝试、精确句柄和截图路径可从 `cac4ecd:docs/debug/CONTINUOUS-GOAL.md` 按阶段读取，不把文件名中的final/pass当作通过证据。

| 阶段 / 提交 | 问题、结果与证据入口 |
|---|---|
| OP / 4985552 | 图编辑/工作项多人分配校验逐人扫描accounts；两处SQL指定现有idx_accounts_person，不加索引/抽象。1/100/1000成员×0/5000/5万无关账号共18组，最重中位2372/2164→24.0/1.64ms；有效/重复/空输入、8类拒绝与409冲突规则保持，5表完整hash/0写，抽样前3个ID计划由SCAN变SEARCH。`assignee-validation-op-before/after/comparison.json`，43663前测及后测退出0；脚本.preview/assignee-validation-op.ts。新增1性能回归原版290ms违反150ms预算（退出1），完整验证998业务/13性能/26浏览器及所有构建检查通过。只代表服务校验耗时，不称整次保存或浏览器提速 |
| OK / 7e375d0 | 旧版流程的原开始偏移未参与字段校验，1831实际PATCH400；64810的stage-ok-before失败。复用EditorField/maxTemplateOffsetDays，字段提供明确错误文案和范围，key隔离不同工作项。1831/1.5/-1均0写，切另一项改5后返回仍保留原错误；刷新/390提示在视口，修正1830及0各仅1 PATCH200，第二项5/其他流程完整DTO保持、0异常。58365的stage-ok-complete通过，32623另9个既有场景通过；该轮探针已成功保存上限但误要求窄屏刷新自动打开属性，修正后重跑。探针归档，无新永久测试 |
| OJ / 5dca0b5 | 人员名最多200而自动登录名不截短，登录上限64；重名后缀亦可能变71。共享maxUsernameLength，生成时预留原6位ID后缀并清除截断尾部高代理，姓名/既有登录名不改。`generated-login-oj-before/after.json`六组由5次400变全部200，原64字符名不变、同前缀独立、首次改密码要求保持；82250账号25测试通过，新增1项回归。90576的`stage-oj-browser`真实UI创建同前缀长姓名两人、列表登录名均可首次登录/改密码/刷新；管理员仅2创建写/0页面异常。临时浏览器探针归档，完整验证通过 |
| OD / a79fe72 | 普通账号无可访问项目时误称“尚未创建项目”并要求选择；首页解释联系经理/管理员授权及刷新，顶部区分管理员。10855的`stage-od-stable-before`在完整登录/个人页/授权恢复后按文案失败，59885的`stage-od-after`17浏览器通过，1280/390截图已看；仅2身份写/0业务写、完整人员和另一项目需求/成员DTO保持、0页面异常。`stage-od-first-account.pw.ts`归档。首轮94446使用错误class，34099过早读取加载状态；均仅探针问题，句柄已回收。无新永久测试/样式/授权逻辑 |
| OC / fedbd45 | 流程预计工期输入max3660，实际模板上限1830；复用maxTemplateDurationDays并标明1–1830范围。75249的`stage-oc-before`实际1 PATCH400，27213的`stage-oc-after`1831就地提示/0写/刷新保留，390字段与提示可见、截图已看，改1830仅1 PATCH200，其他流程与刷新完整DTO保持。只改1产品文件，探针`stage-oc-template-duration.pw.ts`归档，不新增永久测试；完整验证已通过 |
| OB / 4e8888f | 流程不可用页提示回列表，却只提供项目空间；复用既有back，返回按钮带原项目ID。99774的`stage-ob-navigation-before`缺少入口失败；68640的`stage-ob-after`20浏览器、7导航单测/目标Lint/类型与测试构建通过，1280/390截图已看。真实经理草稿由另一管理员归档，进入错误页无写；返回列表/后退/恢复/核对后只有1 PATCH，名称/正在输入的说明与其他流程完整DTO保持。探针`stage-ob-template-availability.pw.ts`归档。初始26558误以为编辑器仍挂载，9000的原版恢复探针通过；没有修改不可达的模板保存分支 |
| NY / ebefd1f | REST/MCP特性需求分页原来每页计算整个项目；共享facts增加可选ID范围，当前页调用，默认全项目保持。5000其他需求/33330工作干扰下8种页从198—322ms降至0.10—1.98ms，3档规模共24组完整DTO hash一致/0写，空页少3查询；`feature-page-scope-ny-before/after.json`。新增1项5000需求/5万工作性能回归，最新普通页中位1.36/最慢1.46ms，空页0.18/0.23ms；原REST/MCP测试补非空与空页，完整验证全通过。当前UI不直接调用该分页，不称为界面提速；无新缓存/索引 |
| NS / 8b7cb73 | 长项目名称挤压状态，长英文名称被panel裁切。2行局部CSS让名称可收缩换行、状态不收缩且不换行。真实3状态×1280/620/390共9组，原版状态2—3行、英文3组文字越界；60181的`stage-ns-before`失败。修改后9组状态1行/0越界/0横向溢出，完整项目DTO/0写/0异常，11627的`stage-ns-after`通过，类型/测试构建/diff通过，前后窄屏截图已看。`settings-header-ns-before.json`、`settings-header-ns.json`，探针归档，无新增永久测试，句柄已回收 |
| NP / 2aec872 | 项目设置成员/归档在真实403后仍保留旧内容；两个查询复用useResourceQuery，无新抽象。29405的`stage-np-corrected-before`两项在旧行未清除处失败；14176的`stage-np-after`14不同浏览器通过，覆盖503保留→403清除→503不恢复→重授权/刷新，以及原成员添加/角色/未知写/归档恢复。完整人员/项目/归档DTO保持、0页面写/异常，390两错误提示已滚动到视口并看图。类型/测试构建、目标Lint/diff/矩阵通过，全部句柄回收。60403首轮只是夹具未先取消需求即归档，被业务规则正确拒绝；产品失败证据采用修正轮 |
| NF / 2b9ac1b | 统计主图表和配置预览403仍保留旧结果，改用既有useResourceQuery。真实503保留→403清除→503不恢复→重授权恢复；配置草稿、完整DTO保持，0业务写/异常。原版2失败，13不同浏览器通过，390实际提示截图已看。`stage-nf-corrected-before/after/preview-visible` |
| NE / b808aab | 行动中心问题负责人逐问题扫描accounts；指定现有idx_accounts_person。6组完整结果SHA/查询数不变，1000问题+5万无关账号534.64→12.44ms；原5000问题回归842.3→84.18ms，11性能/44业务/6浏览器通过。`issue-actions-ne-before/comparison.json`、`stage-ne-*` |
| NB / f6837ac | 关系图人员读取逐人扫描accounts；同一现有索引。6组完整快照SHA一致、只读，1000人+5万无关账号1988.70→2.97ms；原5000人性能825→15.20ms，11性能/41业务/4交接浏览器通过。`path-assignments-nb-before/comparison.json`、`stage-nb-*` |
| NA / 22d45f8 | 项目版本及行动中心工作项/需求负责人4处同类扫描，指定现有索引。9组版本完整一致，5000成员+5万账号12369→6.12ms；行动中心完整SHA相同、14查询，2053→309ms。未增索引/缓存/测试数量。`project-refresh-members-na-*`、`actions-accounts-na-*`、`stage-na-verify-final.log` |
| MW / 2a6ad07 | 项目归档核对写入旧无账号缓存键；改当前项目query.refetch，再读归档，两者成功才解锁。必须顺序：项目访问版本变化会作废并行归档读取。原版2失败，24不同归档/恢复/删除场景通过。`stage-mw-before/after/accepted` |
| MU/MV / 495664b、6f54442 | 人员名单404、人力报表403仍显示旧内容；名单复用useResourceQuery，报表仅非临时且非取消错误清缓存。真实撤权/503/恢复/分页、完整DTO/0写通过，8不同浏览器。真实名单拒绝为404，不能等403。`stage-mu-corrected-before/after`、`stage-mv-before/after` |
| MP / 64ad1bc | localStorage/sessionStorage属性抛异常时侧栏跳错项目；用按账号隔离的当前标签记忆，项目入口带授权projectId。非默认项目跨页/刷新/新标签/个人页返回/390真实验收，3浏览器/29业务。`storage-project-scope-mp-before.json`、`stage-mp-complete` |
| MM / 4e95f24 | 统计日期缺失、逆序、超过1320工作日时就地提示并暂停查询，修正恢复且保留布局草稿。原版失败，11不同浏览器/完整DTO/0写；极端0100/9999前端反馈13.5—22.4ms，暂不优化。`stage-mm-*`、`analytics-range-cost-mo.json` |
| ML/MJ/MD / 96c7323、4aa4345、3c87217 | 项目中心首次读取失败不再当空列表；列表错误不遮挡创建/归档核对入口；核对复用当前账号query.refetch同步列表。原版均失败，真实未知创建/刷新503/恢复/旧缓存/390通过。`stage-md-*`、`stage-mj-recovery/complete`、`stage-ml-before/after` |
| MI / 36b4292、d583b73 | 编辑权无法读取与被另一页面占用分别说明，均只读；重试不抢占，显式接管才转交。4视图、双页面、存储恢复、输入/完整DTO/0写、390视口通过；10浏览器/27相关测试。`stage-mi-complete/visible/views` |
| MH / eb8d679 | 流程偏好读写失败不打断打开/成功保存；创建成功重置原草稿，删除偏好失败也不带回旧名称。7不同浏览器，真实1次POST/原流程完整DTO保持。`stage-mh-complete/create-receipt` |
| MC/MA / b33fc22、3517da6 | 纠错历史显示完整说明及事件/时间，末尾可检索；两个组件useMemo避免每次输入重新格式化5000记录，输入154—290→6—15ms。选择、纠错链、版本冲突/刷新保持，3真实浏览器及目标检查通过。`stage-ma-accepted`、`correction-scale-mc-*`、`work-correction-scale-mc-*` |
| LV/LW / 9cf4cd6、79bbdd9 | 菜单入口再次点可关闭，失焦清搜索，鼠标/键盘/触摸及焦点通过；日志3筛选有可访问名称。8/2浏览器通过。`stage-lv-select-after/menu-regression`、`stage-lw-label-after` |
| LA/KY/KX / 0da42bc、05e1795、682b616 | 草稿存储拒绝说明中文原因；排序回执读取异常不崩页；直接执行缺排期入口接现有计划表单并按权限显示。真实零写读取与仅一次保存通过。`stage-la-*`、`stage-ky-*`、`schedule-entry/save-kx` |
| KV/KT/KR / 033d907、4e840ba、5a02d5d | 返回标签刷新会话防旧身份内容；进度弹窗完整长名称可读；冲突用业务字段名。50/8/实际逐项合并浏览器验收。`stage-kv-*`、`progress-name-kt-*`、`kr-visible-heading-*` |
| KN/KM/KG / 47c50d4、b099f36、7e0f43e | 冲突选择即时反馈；被删除草稿对象优先显示已知名称；候选长姓名说明换行、菜单消失仍返回入口焦点。真实冲突重读/仅一次保存、1280/390与DTO保持通过。`stage-kn-*`、`deleted-draft-km-*`、`member-labels-*` |
| KF / 0451f2e | 成员候选用现有人员索引，5000人默认742→6.33ms、拼音1136→46.51ms；27组完整内容/顺序/SHA一致，11性能/22业务/真实5000候选旅程通过。`member-candidate-*` |
| KC/JR / 5ab83f5、d8d7b25 | 每轮浏览器只清理自身唯一临时目录，junction替换拒绝；tsup --clean使生产/测试输出均为相同6文件，移除约65MB旧块。真实中文/空格/方括号/&路径启动与重复启动通过。`stage-kc-*`、`stage-jr-*` |
| LD—LQ | 依赖入口进入所属范围、观察者禁用画布编辑；岗位长名、归档/问题筛选名称；工作项链接同步锁阻止双PATCH；同名Token撤销显示公开前缀。提交8903cfc/834caa2/dd0aa3a/e4c0fb6/0aa4c09/3376c6b，详见e6b84d1或cac4ecd |

## 已检查、暂不修改

以下有限样本已完成；无新证据不重复。只复核代码/既有证据的项目明确标为“复核”，不称本轮运行。

| 阶段 / 领域 | 结论与证据 |
|---|---|
| ON 图导出/归档规模复核 | 图导出已有空图/两种Phase视图、长字宽估算、中文扩展字符和XML转义实证，graph-export-text-characters.json三组无溢出；正式mcp-graph也覆盖只读/布局。归档历史5000需求/2.5万工作/10万历史全局中位8.82ms、单项目0.15–0.17ms，查询仍按关联索引读取。仅读既有证据与当前实现，无新问题，不重跑；长链历史2000跨需求对象亦降低优先级 |
| OM 下载与身份切换 | 真实备份的HTTP响应返回、Blob读取完成两处分别人为等待，实际退出管理员并登录普通成员后释放；旧响应0下载/0文件点击，新身份保持。重新登录管理员后各正常下载1份，SHA同源；项目/需求/备份完整DTO保持，仅4次登录退出写，0页面异常。35224的`stage-om-download-identity.log`首轮2浏览器通过（2.5/2.6s），类型/测试构建通过；探针归档，无产品修改/永久测试。等待由浏览器包装控制，不称为真实慢网测试 |
| OI 同名工作跨项目 | 实际普通成员两项目同名需求/工作，记忆甲但更新乙37%，弹窗显示乙，严格1 POST乙需求/乙工作ID；甲完整DTO保持，乙记录仅1条，点工作进入乙项目正确detailId，后退/刷新筛选及37%保持、0异常。24084的`stage-oi-complete.log`通过3.1s，390上下文截图已看；探针归档，无产品修改/永久测试。早期可选progressUpdates类型错误和81726误用“工作项详情”标题均为探针错误，真实标题为工作名称 |
| OH Token到期跨页 | 41条真实同名Token（21有效/20撤销），控制浏览器时钟使原第2页对象到期并移到第3页；确认框prefix和原页码保持，确认前完整DTO/0写，确认后仅1 DELETE原ID，其他40条完整DTO保持，刷新第3页/已撤销一致、0异常。24499的`stage-oh-corrected-expiry.log`通过2.0s，390标识/确认钮在视口且截图已看；`stage-oh-token-expiry.pw.ts`归档。到期是浏览器受控时钟，非服务端时钟测试。首轮97308错误查找仅窄屏可见的页码输入框，改按桌面页码按钮核对；无产品修改/永久测试 |
| OG Token读取规模 | 独立库本人0/30/1000条×其他100账号0/1000/5万条共9组，含有效/到期/撤销；完整DTO/降序顺序/hash和账号隔离保持、不返回密钥或hash、0数据库写。中位0.061—1.956ms、最慢2.580ms，1000条250759字节；`token-list-scale-og.ts/json`、`stage-og-token-list.log`首轮退出0且临时库清理。只测服务/SQL，不称浏览器验证，无新索引/产品修改/永久测试 |
| OF 承诺统计复核 | delivery-commitments路由被requireReady统一410，workflow-contracts拒绝新承诺，既有delivery-commitments测试覆盖。旧快照仍由loadPathInput读取，但未找到当前新增入口/增长证据，不把旧统计函数循环当作活跃性能缺陷。未测量、未修改 |
| OE 压缩读取复核 | path-api已有项目/需求两个分析端点×六种Accept-Encoding，逐字节解压结果、编码优先级、private no-store/Vary、未授权404及其他接口不压缩断言。path-routes只对这两端点开启压缩；本轮只复核代码，无新缺陷证据，不重跑/修改 |
| NZ 历史恢复复核 | 现有NC覆盖筛选/后退前进刷新，KV覆盖切身份后历史页不可恢复私有内容；正式path-navigation覆盖不同范围与外部工作项入口/多层画布返回，pagination覆盖145行选择及详情返回滚动。只按测试标题和相关小段复核，无新缺陷证据，不重跑浏览器或修改 |
| NX 导入体积 | 导入REST/MCP已有独立10MiB上限，不受普通API的1MiB限制。真实浏览器读取恰好10MiB（小JSON加空白），超1字节拒绝且草稿/0写保持；1,201,836字节合法文件20需求经1,203,046字节预览/1,203,200字节提交均200，全部长说明/标准逐字段一致，刷新完整DTO保持/无重复/0异常。7054的`stage-nx-corrected-size.log`通过4.7s，`import-size-nx.json`/探针归档，无产品修改或永久测试。首轮27923按字符补齐含中文文件导致字节超限，属于探针错误；两句柄已回收 |
| NW HTTP请求体 | 独立真实HTTP10类非法JSON/空/错类型/无Content-Type/超限请求均400/415/413，31表完整hash保持；Content-Length与chunked超限均拒绝，恰好1MiB含中文/扩展字符的合法JSON可创建，后续普通创建/健康200。`http-body-errors-nw.ts/json`、`stage-nw-http-body.log`首轮退出0，服务/临时目录清理。保留原框架错误码，无500/部分写入证据，不修改 |
| NV 大工期输入 | 现有契约：直接需求上限3660工作日，流程工期/偏移各1830、最多200步骤。共享schema拒绝3661/百万/MAX_SAFE_INTEGER，合法最大值接受；两起始年2026/9000、正反向及偏移+工期10组与独立工作日计数一致，中位0.055—10.03ms、最慢10.48ms。`duration-bounds-nv.ts/json`、`stage-nv-duration.log`首轮退出0。只测契约/计算，不称HTTP或浏览器验证；无需修改/永久测试 |
| NU 备份期间写入 | 6.09MB独立库，SQLite原生backup保持默认100页步长，用progress回调在复制中提交真实需求命令。同连接/另一连接各3次双需求事务，回滚场景3次事务全撤回；31张应用表完整hash均等于某次已提交快照（提交场景最终第3次、回滚原状态），完整性ok/外键0，后续3份备份及活动库一致、无partial残留，连接/临时目录清理。`backup-live-writes-nu.ts/json`、`stage-nu-live-writes.log`首轮退出0。回调插入观测与写入，耗时不作生产性能结论；无需修改/永久测试 |
| NR 日期/列表复核 | 日期上限已有domain正反向溢出、plan-preview REST/MCP创建/预览/提交原子回滚、合法0100/9999单日及最后两日并发读取，date-boundary浏览器改正后恢复；当前实现保持DateRangeError，不改、不重跑。项目列表历史51/501/5001×6身份完整结果/只读已验收，最大3.73ms（`project-list-scale.json`），不重测 |
| NO 首次安排 | 真实经理空项目取消创建/取消加人均0写；添加执行人并创建直接执行需求、选择起始日期/完成标准，观察者不进入负责人选项。真实执行人从我的工作接手并更新30%，经理刷新回读一致；严格经理2写/成员2写，另一项目需求/成员/关系图与平台人员完整DTO保持。79201的`stage-no-complete`通过8.4s，390两截图已看；`first-arrangement-no.json`，探针归档。早期90904原生select的getByLabel定位、77275未展开树行均仅探针错误，句柄已回收 |
| NM 我的工作 | 3本人项目之外0/20/100项目，最多2000需求/2万工作/1万历史；不参与/成员无本人工作5组。基线3.19ms，最大干扰不参与2.95ms/成员7.15ms；完整结果SHA相同、34查询、0数据库写。`my-work-cross-project-nm.ts/json`、`stage-nm-cross-project.log`首轮通过；旧e504ced复用分析测量未重跑 |
| NL MCP中断 | 12次请求体部分取消+12次3.30MB响应取消，连接每次归零，14个McpServer全部关闭；最终响应SHA与31表hash保持、健康200。日志12 aborted/13成功，无500；响应取消时服务端已发完，不能算24次服务端失败。`mcp-interruption-nl.ts/json`、`stage-nl-interruption.log` |
| NK 长问题历史 | 1800字多段/空行/800字符地址，1280/390全文矩形不溢出，滚动末尾实际在视口；完整DTO/0写/0异常。已有pre-wrap/anywhere。`issue-history-nk.json`、`stage-nk-visible-end` |
| NJ 人员并发 | 姓名/岗位两次409，重读503保留输入，再核对只提交本字段与新版本；各1次成功，远端另一字段/其他人员/账号保持。`person-conflict-nj.json`、`stage-nj-accepted`；早期GET/PATCH不同DTO与按钮名误差仅探针错误 |
| NI 下载中断 | 独立32.5MiB真实备份首块/1MiB/16MiB各取消4次，文件流全关；后续完整下载SHA同源、下一备份成功、健康/完整性正常。`backup-download-ni.ts/json`、`stage-ni-download.log`；服务与临时库已清理 |
| ND Token恢复 | 真实创建落库但响应中断，列表503/刷新/重读均防重复；恢复后撤销丢失密钥Token再创建。严格2 POST+1 DELETE，其他Token/项目/人员完整DTO保持。`token-recovery-nd.json`、`stage-nd-token`；报告与截图不存密钥 |
| NC 键盘搜索 | 1280/390无结果Escape、拼音搜索、Tab到末结果并Enter、关闭返回焦点、清单/进展各自筛选、后退/前进/刷新通过，完整DTO/0写。`search-keyboard-nc.json`、`stage-nc-search` |
| MZ 参考链接 | 真实只读者需求/特性各20链接，名称200字符/URL4000字符，1280/390完整文字/全部入口/Tab到20/href/刷新，80矩形无溢出，完整DTO/0写。`readonly-links-mz.json`、`stage-mz-links` |
| MS/MT 双标签/岗位 | 正常存储同账号双标签各守项目，个人页返回/显式切换/刷新保持，真实0写；岗位失效保留当前选择已有3视图回归，MT仅复核。`project-tabs-ms.json`、`stage-ms-project-tabs`、people-filter-changes |
| MR/ME 备份/退出 | 保留前复查文件指纹，变化文件本轮跳过，有效名额不含坏文件，近期partial保留；MR仅复核。ME独立服务内部触发SIGINT/SIGTERM均0退出28/33ms，数据库/备份完整，不代表Windows外部信号或强制终止已验。`shutdown-me.json` |
| MF/MG 参数/流程 | 7类读取100检查：93非法分页/排序400、7极大合法页码200，5表hash保持。流程由依赖和安排方式定先后，无独立排序入口，不新增。`query-inputs-mf.json`、template-save-journey/graphic-editor既有覆盖 |
| MB/LQ 批量/取消 | 复核：特性批量归档一项不合条件则全部回滚；选择在范围变化/他人归档时清除。取消工作不计当前汇总，完成子工作保留事实，空/全取消Phase待规划。workspace-outline、unified-workspace；`split-cancel-complete.log`成功，final日志失败 |
| MN/LP/LZ Token/分析/MCP | Token长名/30条分页/准确撤销已有AL验收；分析跨项目日期范围、迟到响应、往返刷新模拟API通过（非真实数据库）；MCP局部清空/省略/冲突/错误日志已有真实HTTP覆盖。`token-long-after`、`analytics-projects-lp`、mcp-partial-updates/queries/logging |
| KZ/KU/KI 规模 | 流程18组最高105ms、101流程×30步首开226—242ms；问题42组及10万历史默认4.52ms/组合125ms/搜索557ms；人员5000约7ms，完整结果一致。`template-list-scale-before`、`template-catalog-scale`、`issue-scale-checks`、`issue-history-scale-after`、`people-account-lookup`；旧测量，不反复重跑 |
| KL/LS/LT/LU | MCP真实HTTP项目8.27ms、107工具清单13.89ms、31表hash/连接保持（非长期无泄漏证明）；LS日志游标已被NH替代；LT确认正式性能trace关闭；LU复核新增/编辑/恢复均限制活跃姓名唯一 |
| KQ/KS/KO | 跟进取消0写、恢复保留35%/历史，显式改期后提醒消失；分屏输入1024—640/低高度保留65%/说明；200项目/50相近长名键鼠/390切换通过。`follow-up-kq`、`stage-ks-browser`、`project-choice-after` |
| KK/KA/KB/JB/KD/KE | 游客切成员及公开撤销、双项目日志撤权清除、模板副本独立和旧实例不变、密码重置清会话后再提交、5000历史首开953ms/末页49ms及页码隔离。`guest-member-kk`、`stage-ka-audit-scope`、`template-copy-complete`、`password-session-accepted`、`requirement-history-browser-after` |

## 更早业务覆盖索引

| 领域 | 已覆盖 / 历史阶段 |
|---|---|
| 执行/历史 | 转拆分、返工、取消再开、并行最终完成、日期纠正、提测未知/新返工周期、协作者6状态一致（AJ/CT/CV/CY/CM/IY）；历史页码独立EC |
| 协作/恢复 | 人员停用、项目/Phase/问题/需求/特性冲突、未知写、身份切换、跨页接管、后台503/403、对象删除（BJ/CB/CL/CP/CR/DD/DG/DW/DC/EA） |
| 规划/归属 | 排序/撤销、Phase聚合与历史快照、增加前置、流程跨项目复制/归档、里程碑入口、草稿跨范围（AX/BH/CD/DH/DK/EI/EK/EL/EP/ES）；关联问题随需求归档锁定/恢复IW，取消汇总IP |
| 导入/字符 | 原文备份/重导入、未整理输入恢复、异步读取竞争、回执、不部分写入、代理对截断（AA/AB/BW/DS/DT/EN）；UTF16LE/BE中英/扩展字/组合字经NFC重传一致JQ；IU来源链接7d70e7b已修复 |
| 查询/规模 | 搜索大小写、日志10万、我的工作复用分析e504ced、清单500需求2500工作、旧来源5000条款、10万历史、分析24面板（AK/BQ/BT/CK/CE/DB/DJ/DN/EH/EO）；问题跨需求/公共范围移动JX |
| 界面/日期 | 长文/空数据/390/低高度、焦点、复制降级、输入法、强制颜色、甘特边界位置、跨午夜/调休（AL/BB/BU/CI/CQ/CX/CZ/DL/EE/ET/EV/HN/HL）；JT/JU/JW非工作日事实/依赖/点位置已修复 |
| 运维/资源 | 备份有效性/恢复重启/坏文件/下载/同毫秒并发、Token撤销复用连接/到期刷新、密码重置（Q/CF/BO/CB/DQ/DR/IN）；30/50轮资源归零、资源加载失败恢复、草稿事务失败保留（HX/IH/IR/IC） |

历史检索：`git show <提交>:docs/debug/CONTINUOUS-GOAL.md`。A—DO `fd512b7`；DP—EV `41a4ed0`；FE—HL `d35957a`；HE—IE `67250e9`；JG—JL `1ce7589`；JP—JZ `dc53ed7`；JG—KU `6a913cc`；LD—LQ `e6b84d1`；JR—NM详细合并记录 `cac4ecd`。仅按当前主题读取。

## 稳定决定与操作约束

- 不扩功能，不为保持忙碌新增抽象、跨请求缓存、索引体系或布局系统。测量证明具体收益后再修改。
- 未知写入先核对原结果，不盲目再提交；身份切换清空未提交草稿是既定行为。
- Feature/Phase/Issue/需求纠错重读只合并原基线未改字段；ProjectForm及品牌“使用最新设置”整体重载。
- 需求info/correction/plan/schedule的“已核对并关闭”仅有版本变化证据，应保留输入，不能套用DW已确认成功的清理。
- 业务日期统一Asia/Shanghai，显示时间戳沿用浏览器时区。计划日期0100—9999，Phase允许0001—0099；甘特上限36600自然日不改变业务日期范围。新建排期只选工作日，休息日负载为空是规则。
- 需求标题200 UTF-16单元，截断去末尾高代理；requireLabel为200码点，部分创建schema仍UTF-16；品牌20/4码点且不换行。没有业务证据不统一限制。
- 活跃人员姓名全局唯一（新增、编辑、恢复均检查）；历史重复或失效引用不据此增加产品字段。
- 登录名上限沿用64 UTF-16单元；自动姓名前缀为重名后缀预留位置且不拆开扩展字符。人员姓名保持完整，不批量重命名已有账号；OJ原系统只读计数未发现超限账号。
- 正式详情用detailId；里程碑/图属性用pathNode+graphInspector=open+pathInspector=closed。项目里程碑为项目范围；“其他需求”可能不存在，不为只读导航创建它。
- 批量归档行继续显示“已归档”并禁用选择；项目恢复保留独立归档需求，Phase交付历史保持快照，旧来源条款不恢复成入口。
- 协调阻塞已退役，0026清空协调人并转换blocked；残留函数不证明当前入口可达。旧验收人历史引用仍保护IK。
- 性能独占、生产React、trace关闭，用原生事件→对应DOM→两帧；区分SQL/服务/网络/浏览器，不把Playwright定位算渲染。
- 浏览器探针验收后移入证据目录；仅无变化探针不加永久测试。Vitest会发现证据目录，归档必须`.probe.ts`而非`.test.ts/.spec.ts`。
- 不递归扫描/删除JR启动目录 `.preview/qa/continuous-goal/启动 验证 [JR] & LgWieM`：含node_modules junction。证据查询先顶层文件名，按确切子目录读。
- 旧943组测试数据库约2.56GB及2035备份目录未删。新测试目录匹配`project-manage-playwright-数字-后缀`，不含backups；只清理自己创建且原位的目录，强制终止不保证清理。
- 超时不等于结束，回收exec句柄后再开下一轮；浏览器取消/滚动须验证真实请求、实际视口，不仅DOM可见。GET丰富DTO不可直接同PATCH简略DTO比较。

## 候选、限制与解除条件

| 候选 | 当前证据、已试方案与下一步条件 |
|---|---|
| IU导入合并选项 | 300需求无工作项整理1269.5ms、改标题442.3ms，option平方增长（91203）。两稿按交互延迟创建选项键鼠通过但触摸打不开，静态原版触摸通过；全部撤回，未验收优化性能。仅有更简单且保留原生触摸的方案才重启。`intake-editor-300-0-before`、`intake-merge-choice-first/no-blur`及touch证据 |
| LR清单全部展开 | 模拟API1000需求/5000工作展开2173—2472ms，206426 DOM；首行225—297ms、搜索157—166ms、清空68—84ms。无简单修复证据，不直接引入虚拟列表或改层级/选择。`outline-scale-lr.json`、`stage-lr-outline-calibrated`；早期trace开启的4.7秒作废 |
| FE大图布局 | 1000节点/3000边固定路由约3.75s、ELK约4.9s、首开8.8s/返回0.8—3.6s；DO搜索511→288ms已保留。无新证据不改算法或加缓存 |
| 日志/单人并发 | 10万日志无匹配约0.64s，暂不建索引体系；单人并发SQL过滤改变顺序已撤回，不能把撤回方案算成果 |
| DU偶发启动超时 | 一次迁移测试15s空输出；单项与同并发复验及后续全量通过。需可复现证据，不直接放宽超时 |
| IE未匹配GET | 10请求无路径；当前游客首页48请求成功。需原请求路径/复现场景，不削弱日志隐私规则 |
| 已降优先级 | HS/HU长标题复制、GT输入节奏候选已完成GZ；周末排期假设无当前入口证据。上述规模样本只说明本机条件，不推断全部设备 |

无待用户决策或外部阻塞。遇单项受阻保留证据后检查独立事项，不把阶段验收或运行中断写成长期目标完成。
