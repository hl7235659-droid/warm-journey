import { listCities, createCity } from '@/lib/db';
import { withAdmin, readJson, isResponse } from '@/lib/http';
import { z } from 'zod';

export const runtime = 'edge';

export const GET = withAdmin(async ({ env }) => {
  const cities = await listCities(env.DB);
  return Response.json({ ok: true, data: cities });
});

const CreateSchema = z.object({
  name: z.string().min(1).max(20),
  center_lat: z.number().min(-90).max(90),
  center_lng: z.number().min(-180).max(180),
});

export const POST = withAdmin(async ({ req, env }) => {
  const parsed = await readJson(req, CreateSchema);
  if (isResponse(parsed)) return parsed;

  try {
    const id = await createCity(env.DB, parsed);
    return Response.json({ ok: true, data: { id } }, { status: 201 });
  } catch {
    return Response.json({ ok: false, error: '城市已存在' }, { status: 409 });
  }
}, { roles: ['super_admin', 'admin'] });
