# 持续改进工作记录

长期目标：保持功能范围稳定，提高正确性、易用性、性能和可维护性。Goal保持active，没有预设完成点。当前阶段验收后继续选择不同重点，不因清单清空结束。

## 恢复入口与当前阶段 RK

1. 工作目录 `D:\tools\project-manage-improve`，分支 `codex/continuous-improvement`，起点 `bd19fa1`。先看本记录和 `git status --short`，按主题读代码与证据，不重新开始。
2. 当前阶段RK6（继续用户优先目标：全面整理UI）：RK1甘特/间距、RK2筛选/密集导入、RK3详情表单、RK4密集表格、RK5异常状态已验收。下一轮检查密集图表/关系图工具栏与长图例，补宽屏和缩放布局；只在实际截图或测量显示问题时修改。近期普通列表/表单/只读详情降低优先级，不改变业务范围。
3. 最新完整验证QU覆盖至8c67902：1002业务/121文件（45.81s）、13性能（18.81s）、26浏览器冒烟（1.2min），运行时/428边界/完整Lint及按钮规范/类型/生产构建/预算均通过。5429首轮退出0、已回收；stage-qu-verify.log、stage-qu-performance-samples.json、stage-qu-build-budget.json。
4. 最新产品RK5（本次提交，加载反馈和提示间距）；此前c3ac452（RK4账号列和长项目名）、3f5dfb1（RK3资料卡和表单焦点）、f5b3323（RK2筛选和密集导入）、4f4c1e5（RK1尺寸与间距）、044c619（RJ新建工作项失效协作者提示）、190bf36（RE创建日志省略空对象），此前5a4ec09（RC归档同名流程统计）、7f71ac3（QZ问题状态术语）、7ffc3b2（QW流程里程碑定位）、8c67902（QT同名需求）、a4c6c6b（QS图例）、428b87b（QO认证反馈）、05e6869（QJ）、162894d（QI）、e5b6299（QF）。QQ精简前完整记录在 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`，PY前在33ff6eb，PB前在67baff3，更早在cac4ecd。QQ归档校验见 `.preview/qa/continuous-goal/record-compaction-qq.json`；按索引续查，不重新开始。
5. 原目录 `D:\tools\project-manage` 的dev不改，仍仅用户的 `skills/project-manage-intake/SKILL.md` 修改和未跟踪 `docs/dcim-ai-workflow-v3-gaps.md`。未部署、推送或合并；3210/3295不改。
6. 浏览器端口3296，每次命令设置 `$env:PLAYWRIGHT_PORT='3296'`，独立数据库/构建；浏览器串行、性能独占。RK5最终46210的5既有+1临时场景43.7s退出0，目标Lint/按钮CSS/类型/生产构建/预算通过；RK4的19161共8场景及58939长名称通过，完整Lint通过。所有句柄已回收。RK2—RK5的探针错误和解除证据按ui-rk*-audit.json查阅，不重复运行已通过场景。

RK6恢复入口：先复用analytics/graph夹具，选密集图例和工具栏实际截图；近期甘特条尺寸与表单方案保持。候选：Templates/Logs首次加载代码未见提示，尚未在浏览器证实，排在本轮不同重点之后。临时探针均归档到 `.preview/qa/continuous-goal/`，不用递归扫描该目录（历史证据内有node_modules联接）。

## 当前验收基线

| 范围 | 最终证据与边界 |
|---|---|
| RK5 异常状态 | 人员页首次慢加载原显示0/0与空白，现复用LoadingState；刷新提示与筛选框增加12px间距。实际隔离服务观察者、2人员/3需求，加载/刷新失败与恢复/搜索空态/需求和工作项只读/问题空态共21图，1280/900/390，无溢出、写入或页面异常，需求完整DTO保持。46210的5既有权限与恢复场景+1临时通过43.7s；目标Lint/按钮CSS/类型/构建/预算通过（JS935.01KB/CSS340.67KB）。改后窄屏提示/加载/错误及原版只读代表图已看；不改正常的只读详情和提示按钮布局。ui-rk5-audit.json、ui-rk5-before-complete/accepted、stage-rk5-*；无永久测试 |
| RK4 密集表格 | 账号紧凑布局统一980px断点，明确网格区域，消除姓名/状态和登录/菜单重叠；状态文案原64px压到47px→完整64px，900宽列间距14px。宽屏主信息顶部对齐；筛选36px、窄屏等宽；项目列40/30/14/16并允许长名换行。mock只读24人员/8项目/19归档，4页×1280/1180/900/390、菜单和分页21图，另4张超长项目名；代表性修改区域已看。19161的账号/项目切换/分页7既有+1临时46.4s通过，58939长名补测通过；0异常/写入，菜单定位、筛选刷新保留、第二页及文字边界通过。完整Lint/类型/构建/预算通过（JS935.01KB/CSS340.61KB）。ui-rk4-audit.json、ui-rk4-*和stage-rk4-*；4份CSS改动，无永久测试。初始全页图内的分页是正常sticky行为，未误改 |
| RK3 详情编辑 | 去掉工作项资料卡work-editor-scroll内框；详情内表单加滚动预留，Phase多链接24次Tab原5个控件遮挡→0。真实8长需求、3长链接，特性/Phase编辑、移入选择及单工作资料1280/390共9图；代表性和修改区域已看。82637的detail-fields/feature-phases共3既有+1临时通过34.4s；类型/生产构建/预算/按钮CSS检查通过（CSS340.04KB）。ui-rk3-audit.json及ui-rk3-visual/after/accepted、stage-rk3-*。临时视觉场景不提交表单，真实保存恢复由既有场景覆盖；仅2行产品CSS，无永久测试 |
| RK2 密集界面 | 状态预设标题/说明分行；更多筛选72px标签及提示对齐；弹层使用实色背景；导入工作项复用FormField，桌面三列、窄屏标题满行；滚动区预留底栏，解决实际Tab焦点遮挡。隔离服务10工作/8长姓名、6导入需求×8工作，19截图状态，1280/390及dcim筛选；修改区域人工复核。19既有浏览器+2临时场景通过，后补24次Tab原8遮挡→0；Lint/类型/构建/预算通过（JS935.01KB/CSS340.00KB）。ui-rk2-audit.json、ui-rk2-*截图和stage-rk2-*日志；无永久新增测试，临时探针归档 |
| RE创建日志验证 | RD实际25条日志的summary均有尾缀{}；delivery-execution和requirement-commands两处在新记录中省略空归属JSON，有值时保留内容，直接创建补中文分号分隔。已有日志不重写。13775首轮退出0回收：既有delivery-execution/feature-planning/integration共45测试/3文件4.87s，目标Lint/diff/类型/生产构建/预算通过；stage-re-create-log-tests.log、stage-re-build.log、stage-re-build-budget.json。纯文案变化未新增测试或重复浏览器 |
| RC流程分组验证 | 新增1个真实HTTP注入回归：归档旧流程后创建同名流程，两组1/2需求原来合成3；名为“未绑定流程”的4需求与真正未绑定3需求原来合成7。analytics.template维度按已有templateId分组，未绑定使用独立key；4组分别4/3/2/1，主副指标、正倒序/Top1、接口更名key稳定、7表和total_changes只读均通过。连同需求分组/integration/流程复制共28测试/4文件4.78s，目标Lint/diff/类型/生产构建/预算通过；stage-rc-template-groups-reproduction/after.log、stage-rc-build.log及budget.json。无UI改动或浏览器新增用例。前两次夹具误传templateId:null、executionMode，400属测试输入错误，原版失败证据以reproduction为准 |
| QZ文案验证 | 问题状态为已解决，原筛选/统计/说明却用闭环。6文件10处纯文字统一为解决，详情提示引用现有“重新打开”按钮。未改变操作/指标ID、统计口径或已存个人标题；保留既有测试中的旧自定义标题验证兼容。98039最终domain/issue-lifecycle共52测试/2文件2.73s，目标Lint/diff/类型/正式构建/预算通过，无新增测试或浏览器场景。stage-qz-terminology-tests-final.log、stage-qz-build-final.log、stage-qz-build-budget-final.json |
| QW专项验证 | PW已覆盖普通工作项10/50/200元素定位，本轮真实122工作日、2工作/3里程碑补首尾里程碑键盘操作。73966原版完整流程仅末尾定位断言失败：1280/390选末尾后甘特scrollLeft仍0，选中标签在可见区外；焦点/关闭及DTO保持均正常。TemplatePreview补查现有data-milestone-id所属标签，复用滚动逻辑，改4行；41531的6浏览器16.3s通过，末尾scrollLeft739/1045，回首项归0，四次标签均可见、外层滚动保持、选择焦点和Escape入口焦点保持，0写/异常且流程/项目完整DTO保持。含既有列表/长名/长工期/草稿预览，类型/目标Lint/diff/生产构建/预算通过，1280原版及390改后图已看；preview-keyboard-qw-original/after.json、stage-qw-preview-keyboard-baseline/after.log、stage-qw-build.log及build-budget.json。探针归档，无永久测试；34682相对has选择器错误属探针问题 |
| QU完整验证 | 5429首轮verify退出0、已回收，覆盖8c67902及QS/QT：1002业务/121文件45.81s、13性能18.81s、26浏览器冒烟1.2min，运行时/428边界/完整Lint及按钮规范/类型/生产构建/预算均通过。stage-qu-verify.log、stage-qu-performance-samples.json、stage-qu-build-budget.json |
| QT专项验证 | 原版两个回归用例失败：同名需求进展1/2条合为3，延期1/2工作日合为1.5。dimensionValue仅在requirement维度使用需求ID作key，标题仍作label；无API字段/存储迁移。2个永久回归覆盖两个数据集、降序/升序/Top1、归档/其他项目排除、更名键不变、5表及total_changes只读；连同已有测试共36/4文件3.62s通过。67865真实HTTP两同名需求及3说明，表格/柱图分别2/1；改名后键和值保持、旧历史保留，布局/项目/账号和另一需求除分析revision完整DTO保持，0页面写/异常，1280/390无溢出、390图已看。浏览器10.2s/类型/目标Lint/diff通过；stage-qt-groups-original/after.log、requirement-groups-qt.json、stage-qt-requirement-groups-verified.log；浏览器探针归档。47454未排除更名导致的项目分析revision，属探针错误，已回收 |
| QS专项验证 | 原版1810真实4需求（已完成/未开始/处理中）、2负责人；状态筛选后甲2/1、乙1/0，表格/纵图正确而横图缺两个指标图例且数量轴有0.5/1.5。AnalyticsPage共用原纵图图例，横图留34px顶部空间，数量刻度至少1；无接口/布局配置变化。90552改后3浏览器13.7s通过（含既有指标切换与长标签），类型/目标Lint/diff/生产构建/预算通过，390前后图已看；无横向溢出，完整布局/4需求/人员/项目DTO保持，0写/异常。analytics-legend-qs-original/after.json、stage-qs-analytics-legend-original/after.log、stage-qs-build.log及build-budget.json；探针归档，无永久测试。71701误传已退役priority属探针错误，改用真实状态筛选后复现 |
| QP完整验证 | 65495首轮verify退出0、已回收：1000业务/120文件45.85s、13性能18.75s、26浏览器冒烟1.2min；运行时/428边界/完整Lint及按钮规范/类型/生产构建/预算全部通过，覆盖428b87b及累计QF/QI/QJ/QO。stage-qp-verify.log、stage-qp-performance-samples.json、stage-qp-build-budget.json |
| QO专项验证 | 390×400首次改密不一致提示在弹窗可见区外，登录/强制改密/普通改密共4类错误均无alert标记；原版auth-height-qo-original.json完整流程通过，仅末尾通知标记断言失败。AuthForms内部6行组件复用原样式，错误变化后nearest滚动并标记role=alert。46600改后5浏览器14.7s通过，4错误均在可见区，确认输入焦点保持；7次预期认证请求、0额外提交/异常，原需求/项目/其他账号完整DTO保持，同身份以新密码重新登录。包含既有重复提交/Escape/未知结果4场景；类型/目标Lint/diff/生产构建/预算通过，两低高度图已看；auth-height-qo-after.json、stage-qo-auth-height-after/build.log及build-budget.json。未用真实读屏软件验证播报，不扩大为该项结论；无永久测试 |
| QJ专项验证 | 120真实候选原版只展示50人且无上限说明，其余完整业务流程通过；56844退出1仅因缺提示。增加1行条件提示，复用field-help；96884改后4浏览器20.1s通过，含原有失败重试/未知写2路径。1280/390长姓名及岗位无横向溢出，跨搜索保留3选择和viewer角色，空搜索结果不清选择，Enter不提交；仅3次PUT到目标项目，刷新一致，已加入搜索禁用，人员/账号/项目/另一项目成员完整DTO保持，0异常。类型/测试构建、目标Lint/diff通过，390长名与上限图已看；member-candidates-qj-original/after.json、stage-qj-member-candidates-original/after.log，探针归档，无永久测试 |
| QI专项验证 | 原版98808真实quota故障注入：已存37%后改57%，没有提示，关闭再开恢复旧37%；当前重新填写57%可仅提交1次。hook在写失败状态首次出现时用现有Toast告知风险，连续输入不重复；恢复写入后重开保留67%未提交草稿，明确取消后正式数据仍57%。91665专项5场景23.8s、6334现有冒烟26场景1.2min通过；类型/目标Lint/428边界/diff/正式构建及预算通过，390提示图已看；draft-quota-qi-original/verified.json、stage-qi-draft-quota-verified/smoke/build.log及build-budget.json。无新存储机制/永久测试；持续故障下关闭后仍可能丢失最新输入，本次仅修复缺少反馈，未声称无损恢复 |
| QF专项验证 | 原版模拟API、真实浏览器：两同名不同日期记录与一个105字标题，1280/390浮窗宽318但scrollWidth856，入口全在记录之外；milestone-actions-qf-original-complete.json和截图。入口改在对应记录内、统一短文案，49042的11浏览器32.7s通过：两尺寸scrollWidth=clientWidth=318，3记录各1入口，6次分别定位w1/w-late/w-early；既有10场景覆盖主题/缩放/日期/历史/取消/项目范围。类型/测试构建、目标Lint/按钮规范/diff通过，原版/改后390图已看，0写/异常。milestone-actions-qf-after.json、stage-qf-milestone-actions-after.log；探针归档，无永久测试。仅界面模拟数据证据，不称真实数据库验收 |
| 生产体积 | QU正式构建：主JS934890B、CSS339753B、ELK1595334B；服务端6文件/app879.38KB，预算通过。覆盖8c67902，stage-qu-build-budget.json与stage-qu-verify.log |
| 浏览器清单 | 最新`stage-np-matrix.log`：771功能/183布局/2性能、普通1869实例；这是列举结果，未执行整个矩阵。NT结束3296监听0、当前测试临时目录0；原目录仍只有2处用户改动 |
| 原服务增量 | 最新游标QV：2026-09-19T09:19:51.510Z，较QL约46分钟；17日志新增0字节/0事件，无错误/读取失败，3210健康200。runtime-log-review-qv.mjs/json、stage-qv-runtime.log。连续QL/QV均无新增，降低优先级，等待实际运行变化或更长间隔，不短间隔轮询 |
| 原备份 | KJ已验证 `project-manage-2026-09-19T02-00-10-969.db`，3112960字节，完整性ok/外键0/33表、源SHA保持；QV按修改时间取最新两份备份，元数据与QL/PN一致，不重复完整性检查。`runtime-backup-kj.json`、`runtime-backup-qv-listing.json` |
| 依赖证据 | QD于2026-09-19T07:47:17—21Z查询npm官方registry，生产范围143依赖、0已知漏洞，退出0；锁SHA256前后相同32A55528…C796F，最后提交06146c4。stage-qd-audit-official.json及metadata.json；未升级依赖 |

QU完整验证覆盖至8c67902；后续QW/QZ/RC/RE按专项及生产构建验收，未重复全量。各专项证据保留其额外覆盖和限制。原目录仍仅2处用户修改。没有新修改或验收疑点时不重复已通过检查。证据在 `.preview/qa/continuous-goal/`，不进版本库。


## 近期产品成果

均已验收，QW/QZ/RC/RE专项通过，QU完整验证覆盖至8c67902；额外场景见专项基线。更早产品成果、失败尝试和精确证据见 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`；不把文件名中的final/pass当作通过证明。

| 阶段 / 提交 | 问题、结果与证据入口 |
|---|---|
| RK5 / 本次提交 | 人员慢加载反馈与刷新提示间距；复用现有状态组件，无新状态或接口 |
| RK4 / c3ac452 | 修复账号中窄屏重叠与截字，统一筛选高度，长项目名完整展示；4份CSS |
| RK3 / 3f5dfb1 | 工作项资料卡减少重复边框；详情内长表单预留底栏空间，避免键盘焦点被覆盖。只改2行CSS，验证见RK3基线 |
| RK2 / f5b3323 | 修复筛选文案粘连、标签断行、浮层透字、导入工作项原生窄输入框及底栏遮挡键盘焦点。复用现有按钮和字段，未增组件/状态/API；详见RK2验收基线 |
| RK1 / 4f4c1e5 | 甘特计划6px、执行/预测16px统一；表单标签间距、42px字段控件、窄屏工作项及统计卡布局。44既有浏览器场景及实际窄屏创建通过 |
| RE / 190bf36 | 无归属附加信息时，新建需求日志不再显示空{}；非空内容仍保留，历史日志不改。45既有测试和构建通过 |
| RC / 5a4ec09 | 流程归档后复用名称，旧/新流程需求被按名称合并；真实流程还会与同名的“未绑定流程”占位组混合。改用流程ID区分，仅5行变化，不改名称或存储；1个接口回归及28相关测试、构建通过 |
| QZ / 7f71ac3 | 同一问题状态在状态徽标中叫已解决，在筛选/统计/说明中却叫闭环。统一问题筛选、解决说明、3个统计指标、默认趋势标题及接口提示；详情操作说明使用现有按钮名称。只改文案，52既有测试和构建通过 |
| QW / 7ffc3b2 | 流程图选中首尾里程碑只更新选择，甘特仍停在原位置，长流程末尾不可见。仅在TemplatePreview选择时查现有里程碑标签并复用工作项滚动；不增加标记/组件/状态。6浏览器及构建通过，见专项基线 |
| QT / 8c67902 | 同名需求按标题合并，进展相加、延期天数取平均，掩盖分别处理的两个对象。仅requirement维度按现有ID分组，仍显示原标题；进展和偏差分列，改名后身份保持。2回归、36相关业务及真实页面通过，见专项基线 |
| QS / a4c6c6b | 按负责人分组的横向对比柱状图未显示图例，两个指标只能悬停识别；数量轴出现小数刻度。复用纵图既有图例并留顶部空间，数量最小间隔1；实际筛选值和其他对象不变。3浏览器及构建通过，见专项基线 |
| QO / 428b87b | 低高度首次改密的错误文字需手动滚动才能看见，认证错误也缺辅助技术通知标记。仅在AuthForms本文件复用AuthFormError，出现/变化的错误滚到最近可见区域并带role=alert；不移动输入焦点，不改密码/会话/提交锁逻辑。5浏览器及构建通过，见专项基线 |
| QJ / 05e6869 | 添加项目成员最多返回50名候选，原界面未说明，列表外人员需搜索。仅在返回50人且加载成功时显示“最多显示 50 人，未找到时请缩小搜索范围。”；不改变接口、上限或批量逻辑。真实120人流程与既有恢复场景通过，见专项基线 |
| QI / 162894d | sessionStorage写入失败时普通表单静默继续，关闭后读回旧草稿而无提示。useDeliveryForm记录本次写入是否失败，仅在失败状态出现时复用Toast提醒提交/复制；恢复成功写入后重置失败状态。保持当前输入与原提交逻辑，不增加存储后备或持久化体系。原版损失风险及改后31浏览器/构建证据见专项基线 |
| QF / e5b6299 | 甘特里程碑浮窗把全部查看按钮放在记录末尾，同名记录难以对应，长名称按钮使318px浮窗溢出至856px。复用MilestoneSummary在每条记录内显示“查看关联工作”，名称只显示于标题；仅调整现有回调位置和局部按钮样式，无新数据/API/抽象。两尺寸无溢出、6次关联定位及既有10场景通过 |


## 已检查、暂不修改

以下样本无需无证据重测。这里只保留最近检查；其余阶段的完整结论、限制和证据路径见 `1a366a3:docs/debug/CONTINUOUS-GOAL.md`。

| 阶段 / 领域 | 结论与证据 |
|---|---|
| RK1 UI首轮 | 15主页面、详情/6类弹窗、三级关系图与流程编辑，50个截图状态（1280/1536/390，甘特补深色），尺寸无根级溢出；代表性页面及修改区域人工复核。执行/预测/汇总16px、计划参考6px，移除特性10px/单日8px覆盖，截止线/命中区随高度；流程预览选中不变粗。流程属性复用字段间距；表单选择42px、工作项说明满行、窄容器单列；我的工作统计4列、窄屏问题统计2x2及等宽筛选。44个既有浏览器场景分批通过（日期/预测/里程碑/预览/保存恢复/详情编辑）和3临时场景通过；13650真实草稿桌面填入、390完整展示并只创建1项。完整Lint/类型/生产构建/预算通过；主CSS340.14KB。ui-rk-audit.json、ui-rk-before/after/checked/final/accepted截图及stage-rk-*日志。仅修正1处旧趋势日期测试断言，无新永久测试。新探针的issue description字段/按钮aria-label错误已排除，不计产品缺陷。RK2继续密集数据和浮层 |
| RJ新建参与人恢复 | 协作者账号失效时，原校验提示只指负责人；work-item-assignees一行改为“负责人和协作人员”。真实草稿提交400不写数据，刷新保留名称/说明/日期/有效负责人，改选后仅一次200创建一项，原进展保持。86588完整原版仅文案断言失败；40817改后1浏览器16.3s、52094既有8测试/2文件3.43s、目标Lint/类型/构建/预算通过，均回收。create-assignees-rj-original/after.json、stage-rj-*日志；探针归档，无永久测试。2958动态checked定位器uncheck超时为探针错误 |
| RI 常用控件名称 | 隔离服务真实项目/需求/问题，浏览10常用页并打开新增人员/新建项目弹窗，通过浏览器辅助功能树检查button/link/textbox/searchbox/combobox/spinbutton/checkbox/radio/slider/dialog非忽略节点。12状态合计354个控件，空名称0，页面写0/异常0；49703首轮18.5s退出0回收（含类型/测试构建）。control-names-ri.json、stage-ri-control-names.log；探针归档，无产品改动/永久测试。仅名称检查，不扩展为全站所有弹窗或完整无障碍验收 |
| RF 双项目历史恢复 | 真实HTTP两项目4问题，从甲项目带搜索进入乙项目，另设乙搜索，再进个人设置。后退乙→甲、前进乙分别恢复项目/搜索/对应2与1条结果；打开乙问题详情ID正确，关闭/重载仍保留乙筛选。27038首轮10.8s退出0回收（含类型/测试构建），完整4问题和项目DTO保持，0页面写/异常；project-history-rf.json、stage-rf-project-history.log，探针归档，无修改/永久测试 |
| RG 本人跨项目刷新 | main.tsx已为keys.myWork单独配置60秒轮询及返回标签刷新，不依赖useProjectRefresh的当前项目；隐藏时沿用查询库暂停策略。既有my-work-journey覆盖两种触发，RA确认草稿独立。仅追踪配置，不改/不新建或重跑测试 |
| RH 流程目录旧证据 | 找到KZ已复核的100/500/1000规模18组测量，800流程/16000元素中位105.1ms；真实101流程×30步首开226–242ms。证据template-list-scale-before.json、template-catalog-scale.json及cac4ecd记录。当前列表仍按相同方式组装，未发现新瓶颈，不重测或优化；把此项补回索引以避免再次探索 |
| RD 日志连续翻页 | 既有deep-regressions已覆盖服务端固定快照；补真实HTTP浏览器25创建日志，第二页时另一会话新增第26条，往返页仍为原20+5且无重复/遗漏，snapshot保持27。主动刷新回第1页，snapshot28/共26条，新增记录在首行；动作/对象/每页20筛选及刷新结果重载保持。50190首轮12.4s退出0回收，0页面写/异常，完整26需求和项目DTO保持，390无根级溢出且截图已看（表格仍为内部横滚）。audit-pages-rd.json、stage-rd-audit-pages.log；探针归档，无产品修改/永久测试 |
| RA 我的工作跨日 | 只读追踪App→useBusinessDateClock→invalidateBusinessDateViews，已包含keys.myWork；accounts.readMyWork单次todayIso统一逾期/预测/未来10工作日，MyWorkPage把响应asOfDate传入甘特。筛选独立存于URL，ProgressForm按工作ID挂载且useDeliveryForm独立保留草稿。既有personal-experience覆盖响应日期，my-work-journey覆盖轮询/返回；未发现缺口，不改/不重跑测试。本轮仅代码与既有覆盖审查，不称实际跨午夜验证 |
| RB 导出覆盖复核 | 草稿最新输入/存储失败后备份重传、数据库导出恢复、MCP SVG转义与边界已有requirement-intake/database-transfer/mcp-graph及OM/ON覆盖。只读核对导出入口与既有场景，未发现新证据，不重复运行或增加测试 |
| QY 测试资源清理 | 2026-09-19T09:33:50Z检查QU开始（09:17:12Z）后的资源：改进目录data文件0/目录0，Temp中pm-/project-manage-前缀且该时间后修改的目录0，3296监听0。仅目录元数据读取，无删除或数据库内容访问；不能扩大为全机无残留。旧943组/2035备份目录仍不动，无新增泄漏证据，不改代码；test-resources-qy.json |
| QX 只读取消与返回 | 既有api-read-errors覆盖主动取消、503/403及迟到响应；useResourceQuery取消时不清缓存、不回调。补真实HTTP浏览器：暂扣已成功计算的问题搜索响应，离开到流程页时浏览器发出1次ERR_ABORTED；返回后新请求200，原q与2结果保持，刷新一致，无网络/读取故障提示。2问题/项目/账号完整DTO保持，0写/异常，390无溢出且截图已看；33487首轮11.5s通过（含类型/测试构建），read-cancel-qx.json、stage-qx-read-cancel.log。探针归档，无产品改动/永久测试；失权恢复依托既有用例覆盖，本轮未重测 |
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
