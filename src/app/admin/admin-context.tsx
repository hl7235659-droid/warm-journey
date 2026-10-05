'use client';

import { createContext, useContext } from 'react';

export interface Admin { id: string; username: string; role: string }
export const AdminCtx = createContext<Admin | null>(null);
export const useAdmin = () => useContext(AdminCtx);

// 与后端 withAdmin 的角色白名单对齐：无写权限时不渲染写操作入口
export const useCanWrite = () => {
  const role = useContext(AdminCtx)?.role;
  return role === 'super_admin' || role === 'admin';
};
export const useIsSuperAdmin = () => useContext(AdminCtx)?.role === 'super_admin';
