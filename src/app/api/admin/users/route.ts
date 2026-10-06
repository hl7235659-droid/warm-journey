import { listAdmins, createAdmin, getAdminByUsername } from '@/lib/db';
import { withAdmin, readJson, isResponse, jsonErr, ROLES_SUPER } from '@/lib/http';
import { ADMIN_ROLES } from '@/lib/types';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

export const GET = withAdmin(async ({ env }) => {
  const users = await listAdmins(env.DB);
  return Response.json({ ok: true, data: users });
}, { roles: ROLES_SUPER, active: true });

const CreateSchema = z.object({
  username: z.string().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/, '用户名仅限字母、数字、下划线'),
  password: z.string().min(6).max(64),
  role: z.enum(ADMIN_ROLES).default('inspector'),
  display_name: z.string().max(32).default(''),
});

export const POST = withAdmin(async ({ req, env }) => {
  const parsed = await readJson(req, CreateSchema);
  if (isResponse(parsed)) return parsed;

  const existing = await getAdminByUsername(env.DB, parsed.username);
  if (existing) return jsonErr('用户名已存在', 409);

  const password_hash = await bcrypt.hash(parsed.password, 10);
  const id = await createAdmin(env.DB, {
    username: parsed.username,
    password_hash,
    role: parsed.role,
    display_name: parsed.display_name || parsed.username,
  });
  return Response.json({ ok: true, data: { id } }, { status: 201 });
}, { roles: ROLES_SUPER, active: true });
