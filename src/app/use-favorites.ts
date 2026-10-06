'use client';

// 首页收藏（localStorage）：收藏状态 + 切换，读写统一走 lib/local。
import { useEffect, useState } from 'react';
import { LS_KEYS, readList, writeList } from '@/lib/local';

// 收藏裁剪上限：远大于站点总数，实际不会丢收藏（默认 50 会静默丢弃新收藏）
const FAV_MAX = 500;

export function useFavorites() {
  const [favs, setFavs] = useState<string[]>([]);

  // 收藏（localStorage）
  useEffect(() => { setFavs(readList<string>(LS_KEYS.favs, FAV_MAX)); }, []);

  function toggleFav(id: string) {
    setFavs(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      writeList(LS_KEYS.favs, next, FAV_MAX);
      return next;
    });
  }

  return { favs, toggleFav };
}
