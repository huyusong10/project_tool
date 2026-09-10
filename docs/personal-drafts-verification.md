# 个人草稿交付验证

基线：dev e3ab6c5。分支：codex/personal-requirement-drafts。工作区：D:\tools\project-manage-drafts。

| 检查 | 结果 |
|---|---|
| npm run verify | 73 个测试文件、698 项测试通过；HTTP 回归、类型检查、lint、生产构建通过 |
| 浏览器回归 | 38 项通过，覆盖我的工作、需求执行、导入、甘特、路径及个人草稿 |
| 最终草稿浏览器检查 | 3 项再次通过，覆盖桌面、390px 窄屏、局域网 HTTP、断网合并及发布回执恢复 |
| MCP | 9 个草稿工具可用；没有发布工具；同账号 Token 接续、成员预览、他人隔离通过 |
| 数据 | 草稿保存与预览无正式副作用；并发版本、跨项目拒绝、环路、来源修订、回滚和幂等通过 |
| 案例 | LOG v24、ORG v18 经 MCP 保存为本人未发布草稿；试用项目正式需求数为 0 |
| Skill 包 | 仓库内 7 个文件，无原文链接，包含新草稿与兼容导入案例 |
| 最终构建隔离 | 构建前后用户技能目录的 486 个文件，清单、内容哈希、长度和修改时间全部一致 |

最初快照到最终快照之间，全局 project-manage-intake 有 4 个文件出现外部修改，内容与本 worktree 不同。本轮未写入该目录，也未覆盖这些修改。最终验证阶段单独采集构建前后快照，确认本轮构建没有刷新全局 skill。

隔离试用使用 3242，开发前端 5177，浏览器测试 3243。数据库、备份、Cookie、密钥和构建产物独立。现有服务未重启，主工作区未提交修改未携入。

详细日志、目录比对和截图保存在忽略目录 `.preview`：verify-final.log、browser-regression.log、browser-final.log、final-build-skill-verification.json、skill-verification.json、demo-drafts.json。
