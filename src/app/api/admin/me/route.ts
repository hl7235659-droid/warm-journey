import { withAdmin } from '@/lib/http';

export const runtime = 'edge';

// active：以 DB 为准返回身份，账号被删/降级后立即失效（管理端角色门禁依赖此结果）
export const GET = withAdmin(async ({ auth }) => {
  return Response.json({ ok: true, data: { id: auth.sub, username: auth.username, role: auth.role } });
}, { active: true });
