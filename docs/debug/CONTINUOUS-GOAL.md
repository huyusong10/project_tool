# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal持续active，没有预设完成点。

## 基线与恢复

- 工作目录D:\tools\project-manage-improve，分支codex/continuous-improvement，起点bd19fa1。最新产品3376c6b（LM）、0aa4c09（LK）、e4c0fb6（LI）、834caa2（LE）、8903cfc（LD），测试夹具dd0aa3a；更早成果见下表与历史版本。
- 原目录D:\tools\project-manage的dev不改，仅保留用户自己的skill修改和未跟踪文档。未部署、未推送。独立数据库/构建，浏览器端口3296，测试串行、性能独占；3210/3295不改。
- 最新全量LF：997业务/120文件、11性能、26浏览器冒烟，运行时/428边界/完整Lint/类型/生产构建/预算全部通过，stage-lf-verify.log，24625退出0已回收。覆盖LD/LE及dd0aa3a，首轮完整通过；目标检查另有LD 15、LE 7个不同浏览器场景通过。
- LF生产构建：主JS933.42KB、CSS339.24KB、ELK1595.33KB，预算通过，按JR规则清理输出。最新stage-ld-matrix.log确认758功能/183布局/2性能、普通1856实例；只列清单，不称为执行全部浏览器。该轮产品与测试已提交，临时探针已归档；LF结束时无运行句柄、3296监听0、当前格式临时目录0，原目录仍仅用户两项修改。
- 证据在.preview/qa/continuous-goal/，不进版本库。恢复先看当前阶段和git状态，不重跑已通过检查。

详细历史在本文件Git版本：A—DO fd512b7；DP—EV 41a4ed0；FE—HL d35957a；HE—IE 67250e9。JG至JL详验见1ce7589；JP—JZ详验见dc53ed7。按主题取读，不重新开始。

## 近期成果

| 阶段 / 提交 | 结果与验证 |
|---|---|
| LC / 组合验收 | KX/KY/LA后一次完整verify首轮通过：997业务/120文件、11性能、26冒烟、运行时/428边界/完整Lint/类型/生产构建/预算，stage-lc-verify.log，71519退出0已回收。无额外产品修改 |
| LA / 0da42bc | 本机存储被浏览器拒绝时，空草稿及已有草稿详情都只显示英文Access is denied；旧方案恢复可行但未解释原因。只将SecurityError转成中文原因/恢复指引，提示与按钮上下排列，其他错误及核对规则保持。强化原有回归；3个不同浏览器、3业务、类型/测试构建/目标Lint/按钮样式/diff通过。完整IndexedDB草稿与正式分析DTO保持、0业务写，恢复访问后可解除核对；1280/390文字完整可见，截图已看。stage-la-*、storage-details-la-*、la-accepted；临时探针已归档 |
| KY / 05e1795 | sessionStorage不可读使项目关系图显示“页面出现异常”；旧排序回执读取缺少catch，真实探针原版失败。1行捕获读取异常，保留正常读取/核对行为；新增1条回归覆盖存储读写删除均失败、切换进展/关系图、390px刷新、另一正常标签旧回执显示与核对清除，完整分析DTO保持且0业务写。4目标浏览器/类型/测试构建/目标Lint/矩阵/diff通过，截图已看；stage-ky-before/after/regression/lint/matrix.log、ky-before、ky-storage-unavailable-390.png |
| KX / 682b616 | 缺失排期入口在直接执行需求中跳到不含日期编辑的资料页，观察者也显示“排期”；真实三角色复现。接入现有计划表单，工作项仍导航原安排页，按权限/锁状态显示排期或查看；直接执行只读者不显示无用途按钮。强化1个原有回归，11个不同浏览器、类型/测试构建/目标Lint/diff通过。真实三角色两模式零写、完整DTO保持；直接保存仅1写、版本+1、刷新一致，1280/390截图已看。stage-kx-before/after/save-rechecks/lint.log、schedule-entry-kx、schedule-save-kx、kx-before/after；探针已归档 |
| KW / 组合验收 | KR/KT/KV后一次完整verify首轮通过：997业务、11性能、26冒烟、运行时/428边界/完整Lint/类型/生产构建/预算；stage-kw-verify.log，43070退出0已回收 |
| KV / 033d907 | 另一标签登录新账号后，旧个人页返回仍显示原身份。只为session开启返回标签刷新，复用原缓存清理，不增加轮询；1个真实双标签回归在校正后的原版失败。50目标浏览器、目标Lint/类型/测试构建/矩阵通过；后退/前进无私有数据、授权后刷新可读、甲乙完整DTO保持、原页业务0写，390截图已检查。stage-kv-regression/corrected-before/matrix/lint.log、kv-accepted-* |
| KT / 4e840ba | 进度弹窗工作项名称单行省略，1280px可用宽仅187—200px，390px仅0—6px；中英文真实两场景复现。1行CSS让名称和所属需求分行、允许断行。强化原有两角色回归（原版均失败），8浏览器、类型/测试构建/目标Lint/按钮样式/diff通过；真实完整名称6组矩形、取消零写、仅乙1写而甲资料保持、原历史/刷新一致。stage-kt-*、before-progress-name-kt-*、progress-name-kt-*；截图已检查，探针已归档 |
| KR / 5a02d5d | 画布冲突原样显示title/durationDays等内部字段，改用表单中的业务名称。仅组件本地名称表，合并键/值/保存逻辑不变；调整已有回归定位，无新永久测试。真实逐项处理及刷新通过，1280/390完整标题截图已检查；类型/测试构建/目标Lint/diff通过，stage-kr-*、kr-visible-heading-* |
| KP / 组合验收 | KM/KN完成后执行一次完整verify：997业务/120文件、11性能、26冒烟及全部静态/生产构建/预算首轮通过。矩阵755功能/183布局/2性能、1853实例归类通过；stage-kp-verify/matrix.log，24687退出0已回收。无额外产品修改 |
| KN / 47c50d4 | 多条画布冲突点选后没有反馈，真实新增回归原版失败。直接显示现有选择状态、使用已有选中样式及文字提示，不新增状态或改合并规则。1真实浏览器验证改选、外部再次更新后清空旧选择、最后按各项决定仅apply1次、核对0写/完整DTO保持、刷新一致；1280/390已查看。类型/测试构建/目标Lint/按钮样式/diff通过，stage-kn-*、kn-before/after-* |
| KM / b099f36 | 草稿对象被他人删除后，冲突标题与摘要显示ID，即使基线有名称。3行产品修改优先使用已知名称，无名称时冲突提示具体对象类型；合并规则不变。新增1回归原版失败，16业务、4不同浏览器、类型/测试构建/目标Lint/diff通过；真实核对0写、最后仅1批保存其他修改，删除对象不恢复，刷新DTO一致，1280/390截图已检查。stage-km-*、deleted-draft-km-*；KH全量尚未包含KM，当前目标验证已完成 |
| KH / 组合验收 | JZ/KC/KF/KG目标验证后执行一次完整verify：996业务/120文件、11性能、26冒烟及全部静态/生产构建/预算通过。stage-kh-verify.log，7808退出0已回收。无额外产品修改、未部署或推送 |
| KG / 7e0f43e | 候选姓名/说明单行省略，末尾区分信息在1280/390不可见；2行CSS允许换行并按内容取行高，列表保持限高滚动。同时修复菜单项消失后弹窗无法返回焦点：关闭前只在焦点仍位于菜单内时还给入口。新增1条菜单真实回归原版失败；6个不同浏览器、目标Lint/类型/测试构建/diff通过，12处文字末尾实际可见、取消0写/最终仅1人1写、来源成员及刷新DTO保持，1280/390截图已检查。stage-kg-*、topbar-modal-focus-before.log、member-labels-* |
| KF / 0451f2e | 5000人候选查询为每人扫描整张账号表，默认742ms、拼音1136ms。1行SQL指定现有人员唯一索引后降至6.33/46.51ms；100/1000/5000规模9类查询共27组内容/顺序/hash完全一致且只读。新增1条性能回归原版失败；11性能、22业务、真实5000候选跨搜索/角色竞争旅程、类型/测试构建/目标Lint/diff通过。member-candidate-*、stage-kf-*；390px截图已检查，临时探针归档且临时数据库已自动清理 |
| KC / 5ab83f5 | 浏览器验证遗留943组数据库/WAL/SHM共约2.56GB，另2035个备份目录。改用每轮唯一目录，进程正常退出后只清理自身原位目录，失败截图/trace保留。3回归覆盖成功/失败退出、同PID旧资料保留及junction替换拒绝；真实服务两路径、类型/目标Lint/diff通过。playwright-temp-before.json、playwright-storage-real-results.json、stage-kc-*；旧资料未删除，强制终止进程不保证清理 |
| JR / d8d7b25 | 两条tsup命令补--clean，生产44文件26.37MB→6文件984482B，测试66文件40.89MB→相同6文件；去掉38+60个未引用旧块，合计65297436B。生产/测试构建（含类型）和预算首轮0、当前引用完整、6文件字节及SHA一致、diff通过。实际start.bat从中文/空格/方括号/&目录启动，健康/资源931873B/登录/创建项目入独立SQLite/重复启动0通过，12037测试树已停止。stage-jr-*、server-build-artifacts-before/after.json、output-match.json、startup-path-*；61506/10503均已回收，无新永久测试 |

## 覆盖与降低优先级

旧阶段完整记录可从Git读取：6a913cc保存JG—KU的成果、早期失败、无需修改结论与详细证据。以下仅保留恢复所需索引；无新证据不重复运行。

| 阶段 / 领域 | 已验收结果与证据 |
|---|---|
| LB 原服务增量 | 从KJ游标2026-09-18 18:16:27.072Z检查至20:12:50.557Z，17日志新增0字节/0事件，无读取错误，3210健康200。runtime-log-review-lb.json/mjs为最新游标；实际间隔约2小时，不是一天。无新增备份，不重复KJ的备份完整性检查；原服务未修改 |
| KZ 流程目录成本 | 复核已有100/500/1000规模×3项目×含归档与否共18组；最高105.10ms，803条SQL合计22.82ms。原真实101流程×30步首开226—242ms，HTTP26.36ms、响应到可用127—141ms、末项预览33.20ms。template-list-scale-before.json/log、template-list-queries-before.json、template-catalog-scale.json/log；列表函数仍5b5bd91，未发现新瓶颈，不重测、不改实现。以上是旧测量 |
| KQ 到期跟进 | 真实经理取消0写、恢复保留35%/原历史/核对日期、显式改期后提醒消失；返回/刷新保留筛选，共2写。stage-kq-final.log 1通过，follow-up-kq.json/png |
| KS 分屏输入 | 1024/820/801/800/768/640/1280×600保持65%与说明、按钮可滚动操作；取消0写、确认1写、历史/刷新一致。stage-ks-browser.log 1通过；名称问题已由KT修复 |
| KO 项目切换 | 200项目及50相近长名称已有真实1280/390/键盘/鼠标/URL/零写验收。project-choice-after.log最终1通过；Topbar源码仍6348240，不把早期失败日志当成功 |
| KU 问题查询 | 100/1000/5000×14查询42组完整hash对照通过；1000问题×0/25/100历史×11组合通过。10万历史默认4.52ms、组合125ms、搜索最高557ms为旧测量。issue-scale-checks、issue-history-scale-after；当前717bc30，无需重测 |
| KI 人员目录 | 0/100/1000/5000×4范围、48次只读，完整结果一致；5000人6.93—7.94ms，账号子查询使用idx_accounts_person。people-account-lookup.ts/json |
| KL MCP成本 | 真实HTTP预热15/测量129次；REST项目/版本1.41/1.60ms，MCP8.27/8.72ms，107工具清单13.89ms。31表hash保持、每轮连接归零；不是长期无泄漏证明。mcp-read-cost-kl.ts/json |
| KJ 原服务与备份 | 最新日志游标runtime-log-review-kj.json：至2026-09-18 18:16:27.072Z，新增379B仅自动备份2事件，健康200。备份project-manage-2026-09-19T02-00-10-969.db独立只读副本完整性ok/外键0/33表，源hash保持。runtime-backup-kj.json；内存反序列化失败不是源损坏；未恢复原服务 |
| KK 游客转成员 | 甲公开只读/乙普通成员1次42%写入；撤回甲公开后旧详情清除，乙仍可编辑，双方资料保持。stage-kk-browser-final.log 1通过；guest-member-kk.json/png |
| KA 日志隔离 | 双项目分页快照独立；撤销甲权限后旧内容清空，乙仍可读。24问题DTO保持/业务0写。stage-ka-audit-scope.log 1通过 |
| KB/JB 模板 | BH真实副本独立、来源执行事实/旧实例保持，新实例采用新流程；归档旧模板后改选保留草稿。template-copy-complete、archived-template-draft-facts最终各1通过；后者其它final/pass命名日志仍可能失败 |
| KD/KE 身份与历史 | CB密码重置旧提交401、改密后返回原需求仅1次新进度；password-session-accepted.log通过。需求历史5000条首开953ms/末页49ms、EC跨需求页码独立，requirement-history-browser-after、position-after通过 |
| JX/JQ 查询与字符 | 问题跨需求/公共范围移动、筛选往返/页码/汇总/DTO一致，stage-jx-issue-scope通过。UTF16LE/BE导入含中文/扩展字/组合字符，经既定NFC后导出重传一致，intake-utf16-checked通过 |
| IY/IW/IP 执行与归档 | 协作者6状态视图一致，失权保留输入且0提交；关联问题随父需求归档锁定/恢复，取消工作项不进入汇总。collaborator-consistency、archived-issues-complete、requirement-cancellation |
| HN/HL/IN 日期与Token | 跨午夜刷新、调休、Token到期focus/每分钟更新已覆盖；后续JT/JU/JW修复非工作日事实/依赖校验/点位置，均已随KW通过 |
| HX/IH/IR 恢复与资源 | 30/50轮导航资源归零且没有泄漏证据；资源加载失败可导航并重试。resource-release、page-chunk-recovery；IC草稿写事务失败保留原输入/正式0写 |
| KC 测试临时资料 | 仅清理每轮自己的随机目录，成功/失败退出及junction替换保护已验收；旧943组数据库约2.56GB和2035个旧备份目录未删。当前目录匹配应为project-manage-playwright-数字-后缀，不能把backups-数字算作新残留 |

| 领域 | 已覆盖 |
|---|---|
| 执行/历史 | 转拆分、返工、取消再开、并行最终完成、日期纠正、提测未知及新返工周期（AJ/CT/CV/CY/CM）；各需求历史页码独立（EC） |
| 协作/恢复 | 人员停用、项目/Phase/问题/需求/特性冲突、未知写入、身份切换、跨页接管、背景503/403、删除对象（BJ/CB/CL/CP/CR/DD/DG/DW/DC/EA） |
| 规划/归属 | 排序/撤销、Phase聚合/历史快照、增加前置、流程跨项目复制/归档、里程碑入口、草稿跨范围定位（AX/BH/CD/DH/DK/EI/EK/EL/EP/ES） |
| 导入/字符 | 原文备份与重导入、输入未整理恢复、异步读取竞争、回执、不部分写入、代理对截断（AA/AB/BW/DS/DT/EN） |
| 查询/规模 | 搜索大小写、日志10万、我的工作复用分析、清单500需求2500工作、特性旧来源5000条款、10万历史、分析24面板、跨项目干扰（AK/BQ/BT/CK/CE/DB/DJ/DN/EH/EO） |
| 界面/往返 | 长文本/空数据/390px/低高度、项目切换、筛选焦点、复制降级、输入法、强制颜色、甘特边界和位置、双标签项目隔离（AL/BB/BU/CI/CQ/CX/CZ/DL/EE/ET/EV） |
| 运维/身份 | 备份有效性/恢复重启/无效文件/下载失败/同毫秒并发、Token撤销复用连接、密码重置清会话、原服务日志（Q/CF/BO/CB/DQ/DR） |

充分检查的领域只在新证据出现时深入。探针仅验证现有行为则归档，不增加永久测试。

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

## 旧阶段恢复索引

- KV返回标签身份核对033d907、KX缺失排期682b616、KY会话存储05e1795及LA存储原因0da42bc均随LF验收；细节见1532cfc和ed74b0c，不重复运行。
- LD 8903cfc：详情查看依赖进入所属需求并选中工作项，往返保留原页签；观察者不能编辑画布，成员按既有职责编辑。15个不同浏览器、20业务检查通过。最终stage-ld-regression/admin/contributor-final.log、ld-accepted、ld-contributor-final；早期范围、选中与角色失败及DTO断言修订见ed74b0c。
- LE 834caa2/dd0aa3a：人员与岗位长名称20/20完整显示；工作日和搜索重排夹具隔离真实日期/其他案例。7个不同浏览器通过，stage-le-*、le-accepted；50/500/5000模拟规模最高响应170—311ms为已完成旧测量，无性能修改。早期13/20裁切及夹具失败见ed74b0c。
- LF最新全量与浏览器清单见基线；stage-lf-verify.log首轮完整通过，覆盖至dd0aa3a。此后LI/LK/LM只作所需目标验证。

## LG复核：归档服务无需修改

archives-scale.json/log已有100/1000/5000需求、最高100项目/10万历史的全局及项目内9组对照，每组5次，完整结果hash/统计/只读断言通过。5000规模全局中位8.82ms、最高10.24ms，项目内0.15—0.17ms。listArchives第21—39行仍为25c7e91与5b5bd91，均早于该测量；后续ab3e713只改历史引用删除保护。本次只复核旧证据，未重跑、未改服务查询。

## LH验收：大归档清单无需性能改动

50/500/5000条四类归档各3轮浏览器测量，5000条响应到显示29—33ms、中文搜索23—25ms、拼音45—54ms、清空25—29ms、末页操作54—60ms；最大规模DOM仍717个元素。类型切换、末页与390px确认窗口通过；取消0写，模拟恢复仅指定需求与expectedDeletedAt，5000→4999、末页20→19，pageerror0。使用模拟API隔离浏览器成本，不称真实端到端或真实数据库恢复。archives-browser-lh.json、stage-lh-archives-final.log、lh-archives-final，截图已查看；临时探针归档，不改性能实现。

初始78150退出1：等待当前布局隐藏的跳页输入导致180秒超时，records为空，没有性能结论；改为点击可见末页按钮后32105退出0（1通过），两句柄已回收。stage-lh-archives.log、archives-browser-lh-initial.json保留失败证据。

## LI验收：筛选名称

e4c0fb6为归档类型和问题列表四个筛选补无障碍名称。只改5个aria-label，已有回归由按位置查找改为按名称查找；无新永久测试。Analytics、个人设置和项目成员的相邻控件已有表单标签，不重复添加。

归档原版39401退出1，快照中combobox没有名称；修改后58965退出0，真实同名跨项目筛选、取消、需求/模板各一次恢复、其他项目完整DTO保持及刷新通过。问题原版9148退出1（2失败）；修改后65042退出0（4通过），覆盖筛选互斥、详情Esc、加载重试及8种宽度的滚动编辑。stage-li-label/ issues-before/after.log与li-*；目标Lint/diff、类型/测试构建通过，句柄已回收。LF全量尚不含LI，不重复完整verify。

## LJ复核：休息日负载规则保持

LE出现的非工作日空矩阵已有明确业务回归：tests/integration.test.ts:736“周末并发区间没有工作日，不能虚构当日负载”要求dates与days为空、currentCount/peakCount为0、currentTop为空。该测试随LF通过，未重新执行。人力分析按工作日计算，源码与既定规则一致，本轮不改。

## LK验收：工作项链接连续提交

0aa4c09复用useSynchronousPendingLock保护关联链接保存。强化原有未知结果回归，同一事件周期两次requestSubmit在原版发出2次PATCH，stage-lk-links-before.log明确失败；该进程已结束、3296无监听，恢复时未持有句柄。修改后74017退出0，4个原有浏览器场景通过，包括已完成工作项补充链接、普通链接连续提交、刷新恢复与核对、窄屏主题；目标Lint/diff与类型/测试构建通过。stage-lk-links-after.log、lk-links-after。无新永久测试，不改回执或核对协议。LF全量早于LI/LK。

## LM验收：同名Token辨认

3376c6b在撤销窗口显示与列表相同的前缀标识。原有核对回归改成两个同名Token，原版87899退出1，确认窗口缺少目标前缀；修改后56708退出0，4个已有Token创建/撤销/未知结果场景和1个真实同名旅程通过。真实接口两次取消0写，确认只DELETE所选id，另一个完整DTO保持；刷新后状态一致，pageerror0。1280/390截图已查看，目标Lint/diff、类型/测试构建通过。stage-lm-tokens-before/after.log、lm-tokens-after、token-identity-lm.json；句柄已回收，临时stage-lm-token-identity.pw.ts已归档。无新永久测试。

旧Token长名称、53条真实分页、混合状态和390px撤销已有token-pagination-verified、token-long-after、token-table-final成功证据；本轮只复核，不重复。LF全量尚不含LI/LK/LM，最新目标验证分别5/4/5个不同浏览器场景。

## LN复核：下载恢复无需修改

backup-download-final.log于9月18日03:23验收真实备份下载503后重下同一快照：只备份一次、两次下载请求、一次成功文件；SQLite完整性ok，中文/扩展字原文保持且不包含备份后新增需求。SystemPage下载逻辑仍c2e876f/32d2a13，早于该测量，本轮未重跑。RequirementImport导出仍d47aa38，原有requirement-intake.pw.ts:35覆盖存储失败、未整理原文、JSON及重传恢复；没有新缺陷证据，不改实现。

顺带核对交接覆盖：assignment-handoff.pw.ts已覆盖待处理入口更换不可用负责人、开始执行、移除失效协作者及窄屏；服务assignment-handoff.test.ts另覆盖40%交接保留事实与历史。降低此领域优先级，不另建同类探针。

## LO复核：默认流程归档受既定保护

新假设不成立：TemplatesPage:150明确提示先更换默认流程并禁用归档；services/templates.ts:255/263在写前和事务内再次拒绝。versioned-write-integrity.test.ts:872已有触发器模拟“设默认时归档、归档时设默认、归档最后有效流程”并验证409及完整回滚，随LF通过。不能把合法业务中不可达的“默认流程已归档”当成新缺陷，本轮不改、不重跑。

## 当前阶段 LP

转查统计分析跨项目往返：日期范围与人员等筛选在切换项目、后退/前进和刷新时是否与所显示项目一致。验收只读零业务写入、返回范围不混用、空结果能正确恢复。先查AnalyticsPage、use-page-view和现有page-consistency/project-selection/workspace-refresh回归；已有同一路径证据则跳过，只补未覆盖的组合。该阶段尚未执行浏览器探针。

## 最新检查点

3376c6b、0aa4c09及e4c0fb6产品已保留，工作记录提交后工作树应干净。当前无运行句柄，3296监听0，当前格式Playwright临时目录0；临时LM探针已归档。原目录只保留skills/project-manage-intake/SKILL.md修改与docs/dcim-ai-workflow-v3-gaps.md未跟踪文件；没有部署或推送。原服务日志游标仍LB（20:12Z），本轮05:25本地时间仅相隔约1小时，不重复轮询。
