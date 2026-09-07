// 认证查询统一使用账号别名 a；未绑定人员的系统账号不受人员状态限制。
export const accountPersonAvailableSql = `(a.person_id IS NULL OR EXISTS (
  SELECT 1 FROM people p WHERE p.id=a.person_id AND p.active=1 AND p.deleted_at IS NULL
))`;
