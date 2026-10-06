import { z } from 'zod';

// 服务点 admission 结构（POST / PUT 共用）
export const POINT_ADMISSION_SCHEMA = z.object({
  id_required: z.boolean().optional(),
  capacity: z.number().int().min(0).max(10000).nullable().optional(),
  notes: z.string().max(200).optional(),
});

// 服务点字段校验的唯一来源：POST 用全集，PUT 用 .partial()，
// 避免两份并行 schema 随时间漂移（ PUT 弱化校验即源于此）。
const PointFields = {
  name:          z.string().min(1).max(100),
  address:       z.string().min(1).max(200),
  lat:           z.number().min(-90).max(90),
  lng:           z.number().min(-180).max(180),
  city:          z.string().default(''),
  district:      z.string().default(''),
  contact_phone: z.string().default(''),
  open_hours:    z.string().default('全天'),
  status:        z.enum(['open', 'closed', 'temp_closed']).default('open'),
  services:      z.array(z.string().max(20)).default([]),
  admission:     POINT_ADMISSION_SCHEMA.default({}),
  notes:         z.string().max(2000).default(''),
  verified_at:   z.number().nullable().default(null),
};

export const PointCreateSchema = z.object(PointFields);

// PUT：缺省字段表示"不修改"（zod 的 optional 短路，不会套用 default）
export const PointUpdateSchema = PointCreateSchema.partial();
