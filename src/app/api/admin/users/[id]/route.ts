import { updateAdmin, deleteAdmin } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr } from '@/lib/http';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const runtime = 'edge';

const UpdateSchema = z.object({
  password: z.string().min(6).max(64).optional(),
  role: z.enum(['super_admin', 'admin', 'inspector']).optional(),
  display_name: z.string().max(32).optional(),
});

// 账号管理属高风险操作：withAdmin({ active: true }) 在 JWT 之外回查 DB，
// 被删除/降级账号的旧 token 立即失效。
export const PUT = withAdmin<{ id: string }>(async ({ req, env, auth, params: { id } }) => {
  const parsed = await readJson(req, UpdateSchema);
  if (isResponse(parsed)) return parsed;

  // 禁止修改自己的角色，防止 super_admin 把自己降级/降权后锁在门外
  if (parsed.role !== undefined && id === auth.sub) {
    return jsonErr('不能修改自己的角色', 400);
  }

  const data: { password_hash?: string; role?: string; display_name?: string } = {};
  if (parsed.password) data.password_hash = await bcrypt.hash(parsed.password, 10);
  if (parsed.role) data.role = parsed.role;
  if (parsed.display_name !== undefined) data.display_name = parsed.display_name;

  if (Object.keys(data).length === 0) return jsonErr('没有需要更新的字段', 422);

  const { changes } = await updateAdmin(env.DB, id, data);
  if (changes === 0) return Response.json({ ok: false, error: '账号不存在' }, { status: 404 });
  return Response.json({ ok: true, data: { message: '更新成功' } });
}, { roles: ['super_admin'], active: true });

export const DELETE = withAdmin<{ id: string }>(async ({ env, auth, params: { id } }) => {
  if (id === auth.sub) {
    return jsonErr('不能删除当前登录账号', 400);
  }
  const { changes } = await deleteAdmin(env.DB, id);
  if (changes === 0) return Response.json({ ok: false, error: '账号不存在' }, { status: 404 });
  return Response.json({ ok: true, data: { message: '已删除' } });
}, { roles: ['super_admin'], active: true });
