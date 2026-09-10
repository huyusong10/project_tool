# 个人草稿使用

1. 在“我的工作 → 个人草稿”选择目标项目新建，或让 Agent 通过 MCP 保存到你的个人空间。
2. 在“需求与来源”核对原文、落实范围和验收，按需拆分合并，再整理工作项或展开工作流。
3. 在“拓扑”建立真实前置，工作可并行，共享成果只录一次。
4. 在“计划”补充有依据的工期与日期，人选留给人类，未知信息进入待确认项。
5. 等待“已保存”，校验此版本。有项目管理权限的本人可审核发布，之后查看正式需求和 ID 映射。

MCP 默认流程：create_requirement_draft → update_requirement_draft → preview_requirement_draft → preview_requirement_draft_plan。工作流用 preview_requirement_draft_template，返回结果核对后通过 update 保存。

```json
{
  "requestId": "实际生成的 UUID",
  "projectId": "目标项目系统 ID",
  "title": "日志检索方案",
  "content": {
    "formatVersion": 1,
    "entities": [
      {"id": "log-query", "entity": "requirement", "group": "日志管理", "data": {"title": "日志查询可用", "acceptanceCriteria": "输入已知时间范围，查询结果与样本一致", "deliveryScope": "candidate", "tags": ["建议拆分"]}},
      {"id": "query-api", "entity": "work", "requirementId": "log-query", "data": {"title": "查询接口"}},
      {"id": "query-check", "entity": "work", "requirementId": "log-query", "data": {"title": "端到端验证"}}
    ],
    "dependencies": [{"clientId": "api-before-check", "sourceRequirementId": "log-query", "sourceWorkItemId": "query-api", "targetRequirementId": "log-query", "targetWorkItemId": "query-check"}],
    "questions": ["由人类确定负责人和工期"]
  }
}
```

更新带 draftId、expectedVersion、新 requestId 和完整 title/content。冲突先 get，不覆盖新版。来源可无地址及原版本，正文和映射继续保留。LOG／ORG 案例在仓库 skill 的 assets/log-draft.json、assets/org-draft.json。

保存响应未知用原请求重试。发布响应未知先查原批次回执，页面提供查询和原批次重试。已发布和已关闭草稿只读。

隔离试用初始化：`node scripts/setup-drafts-preview.mjs`；显式设置 SKIP_CODEX_SKILL_SYNC=1 后运行 `npm run build`，再运行 `pwsh -File scripts/start-drafts-preview.ps1`。本机端口为 3242，开发前端 5177；账号资料在忽略目录 `.preview/access.json`。

`node scripts/seed-drafts-preview.mjs` 通过隔离 MCP 试录 LOG／ORG，保留为未发布草稿，不生成正式需求。试用 MCP 端点为 `http://127.0.0.1:3242/mcp`，Token 同样保存在 `.preview/access.json`，不修改现有 MCP 配置。
