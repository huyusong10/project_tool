# 统一项目工作区

## 使用方式

三个视角共用项目、特性、Phase、需求范围。首次进入显示特性清单，后续按账号和项目恢复上次范围和视角。

| 操作 | 行为 |
|---|---|
| 点击特性、Phase、需求名称 | 进入下一层，三个视角共同切换范围 |
| 展开箭头 | 原地展开，面包屑不变 |
| 资料、工作项名称 | 打开共用资料面板 |
| 上一级、面包屑 | 进入指定祖先，保留视角 |
| 特性清单 | 直接创建、批量选择、拖拽排序和移动 |
| 关系图 | 维护依赖和布局，业务草稿统一预览、保存和处理冲突 |
| 进展表 | 按当前范围查看计划／实际双轨并更新进展 |

Phase 属于单个特性。跨特性的交付配合通过需求依赖表达。

清单勾选只选择当前对象。系统分组有“选择本组全部需求”入口。需求跨归属移动时追加到目标末尾，多选拖拽保持来源顺序。人工顺序支持拖拽手柄、Alt + 上下方向键和批量上移／下移；筛选或按名称、日期排列时禁用行间排序。

移动、排序使用独立事务，成功后可以撤销。撤销同时核对涉及的同级成员及版本；发生后续修改时整批拒绝。已推进 Phase 的移动填写原因，已交付 Phase 先重新打开。未知提交保留原请求，读取正式资料后明确核对，不自动重发。

## 概览与系统归类

概览统计正式数据，筛选不影响计数。显示需求完成数量、Phase 交付数量、阻塞需求数量；取消项不计入成果，归档完成项保留贡献。按阻塞来源合并影响需求，保留原分析排序和关键路径结果。

展开后显示未来 30 天、逾期、推进中及待交付批次；未定日期单列。特性和 Phase 可查看批次范围及需求执行阶段，需求层可查看工作项及预计完成。阻塞可以定位到当前层关系图。

“其他需求”以 `Feature.kind=other` 标识，固定置底。系统禁止改名、归档、删除、新建 Phase 或特性规划关系；保留历史 Phase 的处理入口。需求仍参加依赖、排期和统计。

## 接口与数据

| 接口 | 契约 |
|---|---|
| `POST /api/projects/:projectId/outline-order` | `kind`、`parentId`、完整同级 `items:[{id,expectedVersion}]`；返回当前顺序及 `undo` |
| `POST /api/projects/:projectId/requirement-placement` | 原输入兼容；维护目标人工顺序，附带 `undo` |
| `POST /api/projects/:projectId/outline-restore` | 提交 `undo.before/expected`，必要时填写 `reason` |
| `POST /api/projects/:projectId/features/archive-batch` | 任一所选特性不满足归档条件则整批回滚 |
| `GET /api/requirements/query?sort=manual` | 人工顺序；旧客户端默认仍按名称排序 |

上述写入通过现有操作注册表同步开放 MCP：`order_outline`、`update_requirement_placement`、`restore_outline`、`archive_features`。

迁移 `0034` 保留特性 ID、需求引用、布局和交付历史。需求初始顺序按原名称／编号自然顺序回填。启动及备份恢复均执行可重复的顺序初始化。

网址使用 `workspaceView`、`scopeType`、`scopeId`；资料选择单独保存。旧工作区和独立需求网址转换为对应范围，旧导入入口、提交原文和本地业务草稿继续保留。

## 验证入口

- `tests/workspace-navigation.test.ts`：层级、旧链接、概览范围、去重和多选顺序。
- `tests/workspace-outline.test.ts`：原子排序、移动撤销、版本冲突、归档和系统归类保护。
- `tests/workspace-migration.test.ts`：历史 Phase、交付快照和引用保留。
- `tests/responsive/unified-workspace.pw.ts`：三个视角、表单保留、创建、拖拽、异常提交、例会更新和导入。
- `npx tsx scripts/validate-workspace-migration.ts <旧数据库>`：对一致性副本迁移并逐表比对，不修改来源数据库。

独立预览使用 `project-manage-workspace` worktree、3281 端口、`.preview/workspace.db` 和独立会话 Cookie。配置脚本拒绝覆盖既有预览；登录资料保存在 `.preview/access.json`。
