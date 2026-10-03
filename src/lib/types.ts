// Core domain types for 暖途同行

export type PointStatus = 'open' | 'closed' | 'temp_closed';
export type ReportCategory = 'closed' | 'info_wrong' | 'facility' | 'safety' | 'other';
export type ReportStatus = 'pending' | 'processing' | 'resolved' | 'closed';
export type WorkOrderStatus = 'open' | 'in_progress' | 'resolved' | 'closed';
export type WorkOrderPriority = 'low' | 'normal' | 'high' | 'urgent';
export type InspectionResult = 'pass' | 'fail' | 'partial';
export type AdminRole = 'super_admin' | 'admin' | 'inspector';

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
  qr_code_url: string;
  verified_at: number | null;
  verified_by: string | null;
  created_at: number;
  updated_at: number;
  created_by: string | null;
}

export interface AdmissionInfo {
  capacity?: number;           // max concurrent riders
  id_required?: boolean;
  platform_required?: string;  // e.g. '美团', '饿了么', '顺丰' or null = all
  notes?: string;
}

export interface PointHistory {
  id: string;
  point_id: string;
  changed_by: string | null;
  changed_by_name?: string;    // joined
  changed_at: number;
  change_summary: string;
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
  assigned_to: string | null;
  assigned_name?: string;      // joined
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
  findings: string[];
  images: string[];
  notes: string;
  inspected_at: number;
  created_at: number;
}

export interface AdminUser {
  id: string;
  username: string;
  role: AdminRole;
  display_name: string;
  created_at: number;
  last_login_at: number | null;
}

// API response wrappers
export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

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

export const SERVICE_TAGS = [
  '休息区', '充电', '饮用水', '急救箱', '雨具', '厕所', '餐饮', '停车', 'Wi-Fi',
] as const;
