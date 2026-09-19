# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal保持active，没有预设完成点。当前阶段验收后继续选择不同重点，不因清单清空结束。

## 恢复入口与当前阶段 QU

1. 工作目录 `D:\tools\project-manage-improve`，分支 `codex/continuous-improvement`，起点 `bd19fa1`。先看本记录和 `git status --short`，按主题读代码与证据，不重新开始。
2. 当前阶段QU（累计验证，待运行）：QT修改服务端统计分组，运行一次完整verify覆盖QS/QT；保留性能样本和构建预算。随后切换到运行资源或其他尚未检查的业务，不重复本轮图表。
3. 最新完整验证QP覆盖至428b87b：1000业务/120文件（45.85s）、13性能（18.75s）、26浏览器冒烟（1.2min），运行时/428边界/完整Lint及按钮规范/类型/生产构建/预算均通过。65495首轮退出0、已回收；stage-qp-verify.log、stage-qp-performance-samples.json、stage-qp-build-budget.json。
4. 最新产品本次QT（同名需求独立统计），此前a4c6c6b（QS图例）、428b87b（QO，认证反馈），此前05e6869（QJ）、162894d（QI）、e5b6299（QF）。QQ精简前完整记录在 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`，PY前在33ff6eb，PB前在67baff3，更早在cac4ecd。QQ归档校验见 `.preview/qa/continuous-goal/record-compaction-qq.json`；按索引续查，不重新开始。
5. 原目录 `D:\tools\project-manage` 的dev不改，仍仅用户的 `skills/project-manage-intake/SKILL.md` 修改和未跟踪 `docs/dcim-ai-workflow-v3-gaps.md`。未部署、推送或合并；3210/3295不改。
6. 浏览器端口3296，每次命令设置 `$env:PLAYWRIGHT_PORT='3296'`，独立数据库/构建；浏览器串行、性能独占。QP65495首轮verify退出0、已回收；QO46600专项5场景已验收，探针归档，无运行测试。QR53138完整验证通过并回收；38891选择器歧义、2498未计实时账号问题数变化均为探针错误，已回收并修正。无运行测试。

## 当前验收基线

| 范围 | 最终证据与边界 |
|---|---|
| QT专项验证 | 原版两个回归用例失败：同名需求进展1/2条合为3，延期1/2工作日合为1.5。dimensionValue仅在requirement维度使用需求ID作key，标题仍作label；无API字段/存储迁移。2个永久回归覆盖两个数据集、降序/升序/Top1、归档/其他项目排除、更名键不变、5表及total_changes只读；连同已有测试共36/4文件3.62s通过。67865真实HTTP两同名需求及3说明，表格/柱图分别2/1；改名后键和值保持、旧历史保留，布局/项目/账号和另一需求除分析revision完整DTO保持，0页面写/异常，1280/390无溢出、390图已看。浏览器10.2s/类型/目标Lint/diff通过；stage-qt-groups-original/after.log、requirement-groups-qt.json、stage-qt-requirement-groups-verified.log；浏览器探针归档。47454未排除更名导致的项目分析revision，属探针错误，已回收 |
| QS专项验证 | 原版1810真实4需求（已完成/未开始/处理中）、2负责人；状态筛选后甲2/1、乙1/0，表格/纵图正确而横图缺两个指标图例且数量轴有0.5/1.5。AnalyticsPage共用原纵图图例，横图留34px顶部空间，数量刻度至少1；无接口/布局配置变化。90552改后3浏览器13.7s通过（含既有指标切换与长标签），类型/目标Lint/diff/生产构建/预算通过，390前后图已看；无横向溢出，完整布局/4需求/人员/项目DTO保持，0写/异常。analytics-legend-qs-original/after.json、stage-qs-analytics-legend-original/after.log、stage-qs-build.log及build-budget.json；探针归档，无永久测试。71701误传已退役priority属探针错误，改用真实状态筛选后复现 |
| QP完整验证 | 65495首轮verify退出0、已回收：1000业务/120文件45.85s、13性能18.75s、26浏览器冒烟1.2min；运行时/428边界/完整Lint及按钮规范/类型/生产构建/预算全部通过，覆盖428b87b及累计QF/QI/QJ/QO。stage-qp-verify.log、stage-qp-performance-samples.json、stage-qp-build-budget.json |
| QO专项验证 | 390×400首次改密不一致提示在弹窗可见区外，登录/强制改密/普通改密共4类错误均无alert标记；原版auth-height-qo-original.json完整流程通过，仅末尾通知标记断言失败。AuthForms内部6行组件复用原样式，错误变化后nearest滚动并标记role=alert。46600改后5浏览器14.7s通过，4错误均在可见区，确认输入焦点保持；7次预期认证请求、0额外提交/异常，原需求/项目/其他账号完整DTO保持，同身份以新密码重新登录。包含既有重复提交/Escape/未知结果4场景；类型/目标Lint/diff/生产构建/预算通过，两低高度图已看；auth-height-qo-after.json、stage-qo-auth-height-after/build.log及build-budget.json。未用真实读屏软件验证播报，不扩大为该项结论；无永久测试 |
| QJ专项验证 | 120真实候选原版只展示50人且无上限说明，其余完整业务流程通过；56844退出1仅因缺提示。增加1行条件提示，复用field-help；96884改后4浏览器20.1s通过，含原有失败重试/未知写2路径。1280/390长姓名及岗位无横向溢出，跨搜索保留3选择和viewer角色，空搜索结果不清选择，Enter不提交；仅3次PUT到目标项目，刷新一致，已加入搜索禁用，人员/账号/项目/另一项目成员完整DTO保持，0异常。类型/测试构建、目标Lint/diff通过，390长名与上限图已看；member-candidates-qj-original/after.json、stage-qj-member-candidates-original/after.log，探针归档，无永久测试 |
| QI专项验证 | 原版98808真实quota故障注入：已存37%后改57%，没有提示，关闭再开恢复旧37%；当前重新填写57%可仅提交1次。hook在写失败状态首次出现时用现有Toast告知风险，连续输入不重复；恢复写入后重开保留67%未提交草稿，明确取消后正式数据仍57%。91665专项5场景23.8s、6334现有冒烟26场景1.2min通过；类型/目标Lint/428边界/diff/正式构建及预算通过，390提示图已看；draft-quota-qi-original/verified.json、stage-qi-draft-quota-verified/smoke/build.log及build-budget.json。无新存储机制/永久测试；持续故障下关闭后仍可能丢失最新输入，本次仅修复缺少反馈，未声称无损恢复 |
| QF专项验证 | 原版模拟API、真实浏览器：两同名不同日期记录与一个105字标题，1280/390浮窗宽318但scrollWidth856，入口全在记录之外；milestone-actions-qf-original-complete.json和截图。入口改在对应记录内、统一短文案，49042的11浏览器32.7s通过：两尺寸scrollWidth=clientWidth=318，3记录各1入口，6次分别定位w1/w-late/w-early；既有10场景覆盖主题/缩放/日期/历史/取消/项目范围。类型/测试构建、目标Lint/按钮规范/diff通过，原版/改后390图已看，0写/异常。milestone-actions-qf-after.json、stage-qf-milestone-actions-after.log；探针归档，无永久测试。仅界面模拟数据证据，不称真实数据库验收 |
| 生产体积 | QP正式构建：主JS934890B、CSS339753B、ELK1595334B；服务端6文件/app879.24KB，预算通过。覆盖428b87b，stage-qp-build-budget.json与stage-qp-verify.log |
| 浏览器清单 | 最新`stage-np-matrix.log`：771功能/183布局/2性能、普通1869实例；这是列举结果，未执行整个矩阵。NT结束3296监听0、当前测试临时目录0；原目录仍只有2处用户改动 |
| 原服务增量 | 最新游标QL：2026-09-19T08:33:47.350Z，较QD约46分钟；17日志新增0字节/0事件，无错误/读取失败，3210健康200。runtime-log-review-ql.mjs/json、stage-ql-runtime.log。只检查后续增量，不短间隔轮询 |
| 原备份 | KJ已验证 `project-manage-2026-09-19T02-00-10-969.db`，3112960字节，完整性ok/外键0/33表、源SHA保持；QL最新两份备份元数据与PN一致，不重复完整性检查。`runtime-backup-kj.json`、`runtime-backup-ql-listing.json` |
| 依赖证据 | QD于2026-09-19T07:47:17—21Z查询npm官方registry，生产范围143依赖、0已知漏洞，退出0；锁SHA256前后相同32A55528…C796F，最后提交06146c4。stage-qd-audit-official.json及metadata.json；未升级依赖 |

QP完整验证覆盖至428b87b，包含QF/QI/QJ/QO；后续QS/QT按专项验收，未重复全量。各专项证据保留其额外覆盖和限制。原目录仍仅2处用户修改。没有新修改或验收疑点时不重复已通过检查。证据在 `.preview/qa/continuous-goal/`，不进版本库。


## 近期产品成果

均已验收，最新QS/QT专项通过，QP完整验证覆盖至428b87b；额外场景见专项基线。更早产品成果、失败尝试和精确证据见 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`；不把文件名中的final/pass当作通过证明。

| 阶段 / 提交 | 问题、结果与证据入口 |
|---|---|
| QT / 本次提交 | 同名需求按标题合并，进展相加、延期天数取平均，掩盖分别处理的两个对象。仅requirement维度按现有ID分组，仍显示原标题；进展和偏差分列，改名后身份保持。2回归、36相关业务及真实页面通过，见专项基线 |
| QS / a4c6c6b | 按负责人分组的横向对比柱状图未显示图例，两个指标只能悬停识别；数量轴出现小数刻度。复用纵图既有图例并留顶部空间，数量最小间隔1；实际筛选值和其他对象不变。3浏览器及构建通过，见专项基线 |
| QO / 428b87b | 低高度首次改密的错误文字需手动滚动才能看见，认证错误也缺辅助技术通知标记。仅在AuthForms本文件复用AuthFormError，出现/变化的错误滚到最近可见区域并带role=alert；不移动输入焦点，不改密码/会话/提交锁逻辑。5浏览器及构建通过，见专项基线 |
| QJ / 05e6869 | 添加项目成员最多返回50名候选，原界面未说明，列表外人员需搜索。仅在返回50人且加载成功时显示“最多显示 50 人，未找到时请缩小搜索范围。”；不改变接口、上限或批量逻辑。真实120人流程与既有恢复场景通过，见专项基线 |
| QI / 162894d | sessionStorage写入失败时普通表单静默继续，关闭后读回旧草稿而无提示。useDeliveryForm记录本次写入是否失败，仅在失败状态出现时复用Toast提醒提交/复制；恢复成功写入后重置失败状态。保持当前输入与原提交逻辑，不增加存储后备或持久化体系。原版损失风险及改后31浏览器/构建证据见专项基线 |
| QF / e5b6299 | 甘特里程碑浮窗把全部查看按钮放在记录末尾，同名记录难以对应，长名称按钮使318px浮窗溢出至856px。复用MilestoneSummary在每条记录内显示“查看关联工作”，名称只显示于标题；仅调整现有回调位置和局部按钮样式，无新数据/API/抽象。两尺寸无溢出、6次关联定位及既有10场景通过 |


## 已检查、暂不修改

以下样本无需无证据重测。这里只保留最近检查；其余阶段的完整结论、限制和证据路径见 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`。

| 阶段 / 领域 | 结论与证据 |
|---|---|
| QR 失效负责人后重开 | 真实经理保留重开原因，管理员停用原负责人；旧重开409且完整问题不变。基本信息修正负责人1次PATCH200，仍已解决/100%，原解决日期保持，仅增纠错历史；刷新保留原因，重新读取问题后1次重开200、v3→5/99%，保留原2条历史，只增纠错及重开各1。新负责人账号实时activeAssignments.issues增加1，其余账号字段、项目/成员/其他问题完整DTO保持，0异常。53138首个完整13.4s通过（含测试构建/类型），390错误图已看，无溢出；issue-owner-qr.json、stage-qr-issue-owner-complete.log，探针归档，无产品修改/永久测试。38891全局option歧义、2498活跃问题数假设错误属探针错误 |
| QN 归档成果只读入口 | 只读追踪use-workspace-navigation→ProjectWorkspace/ProgressWorkspace→ArchivedRequirementDetails：归档ID从Phase facts解析，复用摘要且无完整需求GET；归档管理链接仅canManageProject为真显示。includeDeleted=true只用于RequirementCommandDialog管理命令核对。现有archived-requirement-navigation覆盖管理员三入口和游客摘要/无管理链接，delivery-permission-changes覆盖观察者管理限制。因此未发现权限不一致，不改/不新建或重跑浏览器；本轮仅代码与既有测试覆盖审查，不称新观察者实测 |
| QM 导入目标归档 | 真实经理预览两需求，含一待新建特性和一既有特性/Phase、2工作；管理员归档既有空特性后，旧apply409，需求/Phase/catalog/原需求完整DTO保持，回执not_found。重预览按人工改过的需求标题指出特性已归档；恢复并刷新后标题和原文保持。新预览apply200，只创建2需求/2工作，新特性仅1份且原特性/Phase复用；原需求除分析revision外完整DTO、另一项目需求/成员保持，0异常。26336首轮3.4s通过、类型/测试构建通过，390错误图已看；import-archive-qm.json、stage-qm-import-archive.log，探针归档，无产品修改/永久测试 |
| QK Phase移入中途归档 | 真实经理选择两需求，管理员取消/归档第二条；旧批次409，拒绝前后两需求及Phase完整DTO一致。重读仅保留第一条且原因不丢，重试1次200，第一条v3→4移入目标，27%进度/历史/其余业务字段保持；第二条归档资料保持，恢复后仍在原Phase且取消历史保持。项目/成员/另一项目需求完整DTO保持，0异常；Phase交付历史仍为空，不称已验证非空历史快照。4421首个完整2.9s通过、类型/测试构建通过，390图已看；phase-archive-qk.json、stage-qk-phase-archive-final-check.log，探针归档，无产品修改/永久测试。55947错误directPercent字段、3743推进后创建缺原因、23275非终态不能归档、70364textarea精确标签均属探针错误，修正并回收后通过 |
| QH 人员更名与进展 | 普通协作者打开27%工作并填57%草稿，管理员更名主负责人和本人；模拟61秒后台轮询取得新名称，原ID/工作版本/草稿保持，保存1次POST200、v3→4，仅增1条本人历史。旧历史、原需求除名称/分析revision外完整DTO保持，账号除实时personName外所有字段（含登录名/版本）保持，项目和另一项目需求完整DTO保持；刷新姓名/参与人一致，0异常。17072首个完整2.2s通过、类型/测试构建通过、390草稿图已看；person-rename-qh.json、stage-qh-person-rename-verified.log，探针归档，无产品修改/永久测试。33833账号personName假设错误见恢复项 |
| QG 多依赖工作分页 | 10/100/500工作，1/10/50里程碑，35/440/2240依赖；每组先核对100条分批完整读取与1/5条小页、末项DTO一致，再7类读取各预热+5样本及SQL profile。500工作末项32.7ms、首项37.1ms、5条小页34.0ms、完整分析30.3ms中位；空/越界≤1.13ms。21场景输出hash稳定、11表hash及total_changes保持。无需优化/永久测试；work-page-dependencies-qg.ts、work-page-dependencies-qg-baseline.json、stage-qg-work-dependencies-verified.log首个完整退出0。最初探针pageSize500超出既有100上限，改100分批核对；stage-qg-work-dependencies-baseline.log为探针错误。仅服务层本机样本，非HTTP或浏览器耗时 |
| QE 旧备份下载 | 隔离服务创建两份真实备份，另一管理员删除旧行文件。旧下载404且显示“备份不存在”，0下载产物；另一份仍可下载200，仅1文件，SQLite完整性ok/外键0/原需求内容一致。刷新移除旧行；剩余备份完整DTO、原项目/需求完整DTO保持，0页面写/异常。59993首轮2.6s通过，类型/测试构建通过、390错误图已看；stale-backup-qe.json与stage-qe-stale-backup.log，探针归档，无产品修改/永久测试。不涉及原服务备份 |


## 更早业务覆盖索引

QQ归档：QC, QB, QA, PX, PS, PR, PO, PM, PL, PH, PE, OZ, PZ, PW, PV, PT, PQ, PK, PG, OW, OR。完整原文、证据与失败边界在 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`；最新QP基线保留于本记录。

本轮归档索引：OX问题标题、OQ项目入口、OP分派查询、OK/OC流程数值、OJ长姓名登录、OD首账号空项目、OB流程不可用返回、NY特性需求分页；详细结果及提交在33ff6eb。

已验证且降低优先级：PJ图表文本、PF参考URL、PD分析日期、PC工作分组历史、OY个人负荷、OV工期覆盖、OU实际状态、OS导入优化撤回、ON图导出/归档规模、OM下载身份隔离、OI同名跨项目、OH/OG Token、OF旧承诺入口、OE压缩读取。结论边界和证据均保存在33ff6eb。

| 领域 | 已覆盖 / 历史阶段 |
|---|---|
| 执行/历史 | 转拆分、返工、取消再开、并行最终完成、日期纠正、提测未知/新返工周期、协作者6状态一致（AJ/CT/CV/CY/CM/IY）；历史页码独立EC |
| 协作/恢复 | 人员停用、项目/Phase/问题/需求/特性冲突、未知写、身份切换、跨页接管、后台503/403、对象删除（BJ/CB/CL/CP/CR/DD/DG/DW/DC/EA） |
| 规划/归属 | 排序/撤销、Phase聚合与历史快照、增加前置、流程跨项目复制/归档、里程碑入口、草稿跨范围（AX/BH/CD/DH/DK/EI/EK/EL/EP/ES）；关联问题随需求归档锁定/恢复IW，取消汇总IP |
| 导入/字符 | 原文备份/重导入、未整理输入恢复、异步读取竞争、回执、不部分写入、代理对截断（AA/AB/BW/DS/DT/EN）；UTF16LE/BE中英/扩展字/组合字经NFC重传一致JQ；IU来源链接7d70e7b已修复 |
| 查询/规模 | 搜索大小写、日志10万、我的工作复用分析e504ced、清单500需求2500工作、旧来源5000条款、10万历史、分析24面板（AK/BQ/BT/CK/CE/DB/DJ/DN/EH/EO）；问题跨需求/公共范围移动JX |
| 界面/日期 | 长文/空数据/390/低高度、焦点、复制降级、输入法、强制颜色、甘特边界位置、跨午夜/调休（AL/BB/BU/CI/CQ/CX/CZ/DL/EE/ET/EV/HN/HL）；JT/JU/JW非工作日事实/依赖/点位置已修复 |
| 近期补充 | NX/NW真实HTTP与导入字节边界；NU/NI备份并发事务与下载取消；NM跨项目本人工作规模；NO首次安排到成员执行；NK/NJ长历史与人员并发；MS双标签项目隔离。完整对象/只读及已知边界在67baff3，不能把仅复核项目当本轮执行 |
| 运维/资源 | 备份有效性/恢复重启/坏文件/下载/同毫秒并发、Token撤销复用连接/到期刷新、密码重置（Q/CF/BO/CB/DQ/DR/IN）；30/50轮资源归零、资源加载失败恢复、草稿事务失败保留（HX/IH/IR/IC） |

历史检索：`git show <提交>:docs/debug/CONTINUOUS-GOAL.md`。PY前完整记录（含PX/PW/PV）`33ff6eb`；PB前完整记录（含OZ）`67baff3`；A—DO `fd512b7`；DP—EV `41a4ed0`；FE—HL `d35957a`；HE—IE `67250e9`；JG—JL `1ce7589`；JP—JZ `dc53ed7`；JG—KU `6a913cc`；LD—LQ `e6b84d1`；JR—NM详细合并记录 `cac4ecd`。仅按当前主题读取。

## 稳定决定与操作约束

- 不扩功能，不为保持忙碌新增抽象、跨请求缓存、索引体系或布局系统。测量证明具体收益后再修改。
- 未知写入先核对原结果，不盲目再提交；身份切换清空未提交草稿是既定行为。
- Feature/Phase/Issue/需求纠错重读只合并原基线未改字段；ProjectForm及品牌“使用最新设置”整体重载。
- 需求info/correction/plan/schedule的“已核对并关闭”仅有版本变化证据，应保留输入，不能套用DW已确认成功的清理。
- 业务日期统一Asia/Shanghai，显示时间戳沿用浏览器时区。计划日期0100—9999，Phase允许0001—0099；甘特上限36600自然日不改变业务日期范围。新建排期只选工作日，休息日负载为空是规则。
- 需求标题200 UTF-16单元，截断去末尾高代理；requireLabel为200码点，部分创建schema仍UTF-16；品牌20/4码点且不换行。没有业务证据不统一限制。
- 活跃人员姓名全局唯一（新增、编辑、恢复均检查）；历史重复或失效引用不据此增加产品字段。
- 登录名上限沿用64 UTF-16单元；自动姓名前缀为重名后缀预留位置且不拆开扩展字符。人员姓名保持完整，不批量重命名已有账号；OJ原系统只读计数未发现超限账号。
- 账号DTO的personName和activeAssignments是实时派生值；姓名/进行中任务变化时逐项验证预期差异，不把整份账号不变当作前提。
- 同项目执行更新或需求更名可递增其他需求的deliveryForecast.revision；需求及工作项的跨对象不变性比较只排除这个项目级分析元数据，其余完整DTO仍比对。OR/OY已两次确认，避免把它当业务对象版本或重新制造探针失败。
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
| IU导入合并选项 | 300需求无工作项整理1269.5ms、改标题442.3ms，option平方增长（91203）。两稿按交互延迟创建选项键鼠通过但触摸打不开，静态原版触摸通过；全部撤回，未验收优化性能。OS共享选项JSX亦无明确收益，已撤回；仅有能减少实际渲染且保留原生触摸的简单方案才重启。`intake-editor-300-0-before`、`intake-merge-choice-first/no-blur`及touch证据 |
| LR清单全部展开 | 模拟API1000需求/5000工作展开2173—2472ms，206426 DOM；首行225—297ms、搜索157—166ms、清空68—84ms。无简单修复证据，不直接引入虚拟列表或改层级/选择。`outline-scale-lr.json`、`stage-lr-outline-calibrated`；早期trace开启的4.7秒作废 |
| FE大图布局 | 1000节点/3000边固定路由约3.75s、ELK约4.9s、首开8.8s/返回0.8—3.6s；DO搜索511→288ms已保留。无新证据不改算法或加缓存 |
| 日志/单人并发 | 10万日志无匹配约0.64s，暂不建索引体系；单人并发SQL过滤改变顺序已撤回，不能把撤回方案算成果 |
| DU偶发启动超时 | 一次迁移测试15s空输出；单项与同并发复验及后续全量通过。需可复现证据，不直接放宽超时 |
| IE未匹配GET | 10请求无路径；当前游客首页48请求成功。需原请求路径/复现场景，不削弱日志隐私规则 |
| 已降优先级 | HS/HU长标题复制、GT输入节奏候选已完成GZ；周末排期假设无当前入口证据。上述规模样本只说明本机条件，不推断全部设备 |

无待用户决策或外部阻塞。遇单项受阻保留证据后检查独立事项，不把阶段验收或运行中断写成长期目标完成。
