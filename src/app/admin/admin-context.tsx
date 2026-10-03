'use client';

import { createContext, useContext } from 'react';

export interface Admin { id: string; username: string; role: string }
export const AdminCtx = createContext<Admin | null>(null);
export const useAdmin = () => useContext(AdminCtx);
