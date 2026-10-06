// Core domain types for 暖途同行

// 领域枚举的唯一来源：const 数组（供 z.enum / includes / 遍历）+ 派生联合类型。
export const POINT_STATUSES = ['open', 'closed', 'temp_closed'] as const;
export const REPORT_CATEGORIES = ['closed', 'info_wrong', 'facility', 'safety', 'other'] as const;
export const KNOWLEDGE_CATEGORIES = ['rights', 'channel', 'faq', 'notice'] as const;

export type PointStatus = typeof POINT_STATUSES[number];
export type ReportCategory = typeof REPORT_CATEGORIES[number];
export type KnowledgeCategory = typeof KNOWLEDGE_CATEGORIES[number];
export type ReportStatus = 'pending' | 'processing' | 'resolved' | 'closed';
export type WorkOrderStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type InspectionResult = 'pass' | 'fail' | 'partial';
export const ADMIN_ROLES = ['super_admin', 'admin', 'inspector'] as const;
export type AdminRole = typeof ADMIN_ROLES[number];
export type VisitStatus = 'reserved' | 'in_store' | 'completed' | 'cancelled' | 'expired';

// DB 主键形态（唯一来源）：真实数据为 16 位小写 hex（randomblob(8)），seed 数据为 point001 风格
export const ID_RE = /^[a-z0-9]{4,32}$/;

// 单张上传图片体积上限：客户端预检与服务端拒绝共用（文案里的 "5MB" 随此值同步）
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export interface ServicePoint {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city: string;
  district: string;
  contact_phone: string;
  open_hours: string;
  status: PointStatus;
  services: string[];       // e.g. ['休息', '充电', '饮水', '急救箱', '雨具']
  admission: AdmissionInfo;
  notes: string;
  verified_at: number | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
}

export interface AdmissionInfo {
  capacity?: number;           // max concurrent riders
  id_required?: boolean;
  notes?: string;
}

export interface PointHistory {
  id: string;
  point_id: string;
  changed_by: string | null;
  changed_by_name?: string;    // joined
  changed_at: number;
  snapshot: ServicePoint;
}

export interface Report {
  id: string;
  point_id: string;
  point_name?: string;         // joined
  category: ReportCategory;
  content: string;
  images: string[];
  status: ReportStatus;
  created_at: number;
  work_order_id: string | null;
}

export interface WorkOrder {
  id: string;
  title: string;
  description: string;
  point_id: string | null;
  point_name?: string;         // joined
  report_id: string | null;
  status: WorkOrderStatus;
  priority: WorkOrderPriority;
  resolution_note: string;
  resolved_at: number | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
}

export interface Inspection {
  id: string;
  point_id: string;
  point_name?: string;         // joined
  inspector_id: string | null;
  inspector_name?: string;     // joined
  result: InspectionResult;
  images: string[];
  notes: string;
  inspected_at: number;
  created_at: number;
}

export interface Visit {
  id: string;
  point_id: string;
  point_name?: string;         // joined
  rider_token: string;
  status: VisitStatus;
  reserved_at: number;
  checked_in_at: number | null;
  checked_out_at: number | null;
  created_at: number;
  // 反滥用内部字段：getVisit 的 SELECT * 会带出，公开响应必须剔除
  created_ip?: string | null;
  // 一次性入店码：只随预约响应/二维码走，第三方读取口必须剔除
  checkin_code?: string | null;
}

export interface VisitFeedback {
  id: string;
  visit_id: string;
  point_id: string;
  point_name?: string;         // joined
  rating: number;              // 1-5
  supports: string[];
  suggestion: string;
  created_at: number;
}

export interface AdminUser {  id: string;
  username: string;
  role: AdminRole;
  display_name: string;
  created_at: number;
  last_login_at: number | null;
}

// API response wrappers：全部接口唯一的响应信封（判别联合，`api()` 消费）
export type ApiResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

// Pagination
export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// Label maps for display
export const STATUS_LABELS: Record<PointStatus, string> = {
  open: '开放中',
  closed: '已关闭',
  temp_closed: '临时关闭',
};

// 状态圆章配色（国风印章类名）：卡片与详情页共用，避免同一映射各抄一份
export const STATUS_SEALS: Record<PointStatus, string> = {
  open: 'seal-jade',
  closed: 'seal-ink',
  temp_closed: 'seal-gold',
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  pending: '待核实',
  processing: '核实处理中',
  resolved: '已解决',
  closed: '已关闭',
};

export const REPORT_CATEGORY_LABELS: Record<ReportCategory, string> = {
  closed: '已关闭未更新',
  info_wrong: '信息有误',
  facility: '设施损坏',
  safety: '安全隐患',
  other: '其他问题',
};

export const WORK_ORDER_STATUS_LABELS: Record<WorkOrderStatus, string> = {
  open: '待处理',
  in_progress: '处理中',
  resolved: '已解决',
  closed: '已关闭',
};

export const PRIORITY_LABELS: Record<WorkOrderPriority, string> = {
  low: '低',
  normal: '普通',
  high: '高',
  urgent: '紧急',
};

export const INSPECTION_RESULT_LABELS: Record<InspectionResult, string> = {
  pass: '通过',
  fail: '未通过',
  partial: '部分通过',
};

export const ADMIN_ROLE_LABELS: Record<AdminRole, string> = {
  super_admin: '超级管理员',
  admin: '管理员',
  inspector: '巡检员',
};

export const SERVICE_TAGS = [
  '休息区', '充电', '饮用水', '急救箱', '雨具', '厕所', '餐饮', '停车', 'Wi-Fi',
] as const;

export const VISIT_STATUS_LABELS: Record<VisitStatus, string> = {
  reserved: '已预约',
  in_store: '在店',
  completed: '已离店',
  cancelled: '已取消',
  expired: '已过期',
};

// 离店反馈：希望获得的支持（多选）
export const FEEDBACK_SUPPORT_TAGS = [
  '充电', '饮用水', '热饭', '休息区', '厕所', 'Wi-Fi', '雨具', '急救药品', '手机维修', '法律援助', '心理疏导',
] as const;
