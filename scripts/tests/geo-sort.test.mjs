// 首页距离排序回归测试：node --test scripts/tests
// S1：排序比较器曾写成 haversine(user, a.lat, b.lng) - haversine(user, b.lat, b.lng)
// ——a 的纬度配 b 的经度，且完全丢掉 a.lng，得到的是"伪距离"。
// 下面的坐标刻意挑选成：交叉参数会把最远的东向站点排在中间站点之前。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { haversine, byDistance } from '../../src/lib/geo.ts';

const USER = { lat: 23.1291, lng: 113.3309 }; // 广州塔附近

const NEAR = { id: 'near', lat: 23.1300, lng: 113.3320 };  // ≈0.1km
const NORTH = { id: 'north', lat: 23.9000, lng: 113.3310 }; // ≈86km 正北
const SOUTH = { id: 'south', lat: 22.0000, lng: 113.3309 }; // ≈126km 正南
const EAST = { id: 'east', lat: 23.1291, lng: 116.4000 };   // ≈314km 正东（纬度与用户相同）

const INPUT = [EAST, SOUTH, NORTH, NEAR];

test('byDistance 最近点排在首位，整体按真实距离升序', () => {
  assert.deepEqual(
    byDistance(INPUT, USER.lat, USER.lng).map(p => p.id),
    ['near', 'north', 'south', 'east'],
  );
});

test('排序结果按真实球面距离单调递增（丢经度的交叉参数会在此断裂）', () => {
  const real = byDistance(INPUT, USER.lat, USER.lng)
    .map(p => haversine(USER.lat, USER.lng, p.lat, p.lng));
  for (let i = 1; i < real.length; i++) {
    assert.ok(real[i] > real[i - 1], `第 ${i} 项 ${real[i]}km 应大于前一项 ${real[i - 1]}km`);
  }
});

test('byDistance 不改动入参数组', () => {
  const input = [...INPUT];
  byDistance(input, USER.lat, USER.lng);
  assert.deepEqual(input.map(p => p.id), ['east', 'south', 'north', 'near']);
});

test('haversine 基准量级：同点为 0，1 度纬度约 111km、1 度经度约 102km', () => {
  assert.equal(haversine(23.1291, 113.3309, 23.1291, 113.3309), 0);
  const oneDegLat = haversine(23.0, 113.0, 24.0, 113.0);
  assert.ok(oneDegLat > 110 && oneDegLat < 112, `1 度纬度应约 111km，实得 ${oneDegLat}`);
  // cos23° ≈ 0.92 → 同纬度 1 度经度约 102km；用于确认经度项没被串到纬度上
  const oneDegLng = haversine(23.0, 113.0, 23.0, 114.0);
  assert.ok(oneDegLng > 100 && oneDegLng < 105, `1 度经度应约 102km，实得 ${oneDegLng}`);
});
