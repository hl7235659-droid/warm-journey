// 半年运营流水造数（挑战杯路演演示用）
//
// ⚠️ 这里写出去的全部是**合成数据**，不是真实业务记录：visits / visit_feedback /
//    reports / work_orders / inspections / point_confirms / point_history /
//    ai_knowledge 的新条目，以及 3 个点位的时间戳回填。造它的原因是管理端看板、
//    AI 周报、口碑摘要、客流提示这四条演示链路都要求"库里已有半年积累"才看得出效果。
//    凡是本脚本写的行，主键一律以 `ops` 开头（在店/预约的实时尾部以 `opslive` 开头），
//    --purge 按这个前缀精确删除，不会碰到真实数据，也不会碰到 seed-demo 的 demo* 行。
//    表内所有 IP 是虚拟值，不对应任何真实设备。
//
// 用法：
//   node scripts/seed-ops.mjs                 # 本地库（.wrangler 里的 d1）
//   node scripts/seed-ops.mjs --remote        # 生产库（会要求输入 prod 确认）
//   node scripts/seed-ops.mjs --remote --yes  # 生产库，跳过确认（自动化场景）
//   node scripts/seed-ops.mjs --remote --live-only   # 只刷新"当前在店/已预约/今日进店"
//   node scripts/seed-ops.mjs --remote --purge       # 删掉本脚本写过的所有行
//   node scripts/seed-ops.mjs --dry /tmp/x.sql       # 只生成 SQL 不执行（--dry 后跟输出路径）
//
// 为什么需要 --live-only：expireStaleVisits 挂在所有读路径上，预约 2 小时过期、
// 入店 4 小时自动离店。演示隔了几小时再开，"当前在店"必然归零，这是代码语义决定的，
// 不是数据坏了。开场前重跑一次 --live-only 即可（约 3 秒）。
//
// 幂等：全量跑之前先 --purge，所以重复执行同一份数据只有一份。时间戳按执行时刻回推，
// 任何时候跑都是"刚刚过去了 180 天"。

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { argv, exit, stdin, stdout } from 'node:process';

const require = createRequire(import.meta.url);
const { DB_NAME, ACCOUNT_ID } = require('./db-objects.cjs');

const WRANGLER = path.resolve(import.meta.dirname, '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const REMOTE = argv.includes('--remote');
const YES = argv.includes('--yes');
const LIVE_ONLY = argv.includes('--live-only');
const PURGE = argv.includes('--purge');
const DRY_AT = argv.indexOf('--dry');
const DRY_FILE = DRY_AT >= 0 ? argv[DRY_AT + 1] : null;

const DAY = 86400;
const DAYS = 180; // 半年
const now = Math.floor(Date.now() / 1000);
// 北京时间当日 00:00 的 unix 秒（与 getAdminStats 的 shanghaiDayStart 同口径）
const todayStart = Math.floor((now + 8 * DAY) / DAY) * DAY - 8 * DAY;
const hourNow = Math.max(1, Math.floor((now - todayStart) / 3600));
const dayTs = (k) => todayStart - k * DAY; // k 天前那一天的 00:00
const at = (k, h, m = 0) => dayTs(k) + h * 3600 + m * 60;
// 1970-01-01 是周四，故 +4 后 %7 得 0=周日
const dowOf = (k) => Math.floor((dayTs(k) + 8 * 3600) / DAY + 4) % 7;

// ---------- 确定性随机（同一次运行内可复现，跨运行只随 now 平移） ----------
let seed = 20261006;
function rnd() {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const chance = (p) => rnd() < p;
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function wpick(items, weights) {
  const total = weights.reduce((s, x) => s + x, 0);
  let r = rnd() * total;
  for (let i = 0; i < items.length; i++) { r -= weights[i]; if (r <= 0) return items[i]; }
  return items[items.length - 1];
}
const HEX = '0123456789abcdef';
const hex16 = () => Array.from({ length: 16 }, () => HEX[Math.floor(rnd() * 16)]).join('');
// 与 db/index.ts genRandomCode 同字符集（Crockford base32，去 i/l/o/u）
const B32 = '0123456789abcdefghjkmnpqrstvwxyz';
const code10 = () => Array.from({ length: 10 }, () => B32[Math.floor(rnd() * 32)]).join('');

// ---------- SQL 输出 ----------
const q = (v) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const n = (v) => (v === null || v === undefined ? 'NULL' : String(Math.floor(v)));
const J = (v) => q(JSON.stringify(v));

// 点位以生产/本地库的**当前真实行**为准（不覆盖内容，只回填时间戳、造历史快照）
const ADMIN_IDS = [];
const POINTS = [];

// ---------------------------------------------------------------------------
// 文案池：离店建议 / 上报内容 / 工单 / 巡检记录
// ---------------------------------------------------------------------------
const PRAISE = [
  '插座够多，充半小时就能跑下午的单', '老板认得我们，进来不用登记',
  '有热水和茶叶，冬天跑单前能暖手', '空调足，中午歇二十分钟下午不瞌睡',
  '急救箱换过药，绷带碘伏都在', '能停电动车还有人看着，放心',
  '免费午餐实在，11 点到 13 点别错过', 'Wi-Fi 密码写在墙上，不用问',
  '厕所干净，比在街上找方便', '雨天有雨衣可以借，救过一次急',
  '微波炉好用，自带饭省了外卖钱', '位置好找，地铁口出来两百米',
  '后来加了几个凳子，中午坐得下了', '站长会提醒别在楼道充电，是为我们好',
  '手机和车都能充，这个最实用', '进去歇着没人赶，这点最难得',
];
const COMPLAIN = [
  '晚上十点后门锁扫码反应慢，等了两分钟', '插座只有四个，高峰期抢不到',
  '中午人太多座位不够，站了一会儿就走了', '空调制冷一般，夏天还是热',
  '想要能热饭的微波炉，现在没有', '停车棚晚上灯太暗，推车看不清路',
  '急救药品断了半个月没补', '要出示骑手码，可有些平台压根不发工牌',
  '饮水机能出水但纸杯经常没有', '门口电动车乱停，进出得挪车',
  '希望加个换电池或者修手机的地方', '周末不开门，跑周末单的人没地方歇',
  '希望多贴点维权宣传，很多骑手不知道能找谁', '希望有心理疏导，压力大时没人说话',
  '建议延长到夜里十二点，收完单才敢过去', '凳子偏少，来得晚只能站着',
];
const REPORT_TEXT = {
  closed: [
    '页面写全天开放，今天过去卷帘门锁着，问隔壁说改成晚上十点了',
    '这家已经搬走了，原址变成快递柜',
    '标的是周六也开，实际周末两天都不开',
    '今天去过不去了，说是内部装修暂停一周',
    '门口贴了告示说不再对外提供休息，麻烦核实',
  ],
  info_wrong: [
    '电话打过去是空号，地址是对的',
    '营业时间应该改成 08:00 开门，站长说早上没人',
    '地图定位偏了大概六百米，实际在路南侧',
    '写的容量 20 人，实际能坐的只有十个位置',
    '服务项目里说提供餐饮，去了只有饮水',
    '区写错了，这个地址在番禺不在海珠',
  ],
  facility: [
    '三号插座没电，插上不亮',
    '饮水机坏了两周，只出水不加热',
    '空调开了不冷，遥控器失灵',
    '充电区漏雨，插线板被淋湿了',
    '休息区长条凳断了一根',
    '急救箱锁着，钥匙找不到人',
  ],
  safety: [
    '门口充电桩冒火花，已经断电，尽快来看一下',
    '夜间门口有狗出没，怕咬到取餐的人',
    '消防通道被纸箱堵住了',
    '楼梯灯坏，晚上下楼看不清',
    '插线板超载，好几个大功率一起插，闻着有焦味',
  ],
  other: [
    '能不能加个打气筒', '希望多备几把共享伞',
    '希望备苹果和安卓两种充电线', '建议门口把 Wi-Fi 密码贴出来',
    '想问问能不能借用一下工具拧螺丝', '能不能设个寄存外卖箱的地方',
  ],
};
const REPORT_WEIGHT = { facility: 0.34, info_wrong: 0.26, closed: 0.16, safety: 0.10, other: 0.14 };

const RESOLVE_NOTE = {
  closed: '已电话站点并现场复核，实际营业时间为 {h}，平台信息与门口告示已同步更新',
  info_wrong: '已逐项核对地址、电话与服务项目，站点详情页已更正并标注复核时间',
  facility: '站点已完成维修/更换，现场实测功能恢复正常，登记复查通过',
  safety: '已联系站点与物业现场处置隐患，整改完成后复查通过',
  other: '需求已转达站点方，可落地的已补充到位，其余纳入下季度改造清单',
};
const INSPECTION_PASS = [
  '现场核对营业时间、座位数与插座可用情况，休息区整洁，急救箱药品在效期内',
  '充电、饮水、如厕三项功能正常，门口指引牌清晰，登记信息与实际一致',
  '随机询问三位骑手，均反馈可自由进入休息，无收费情况',
  '空调、微波炉、饮水机全部通电试用正常，安全通道畅通',
  '复查上次整改项，插座与照明均已修复，现场无遗留问题',
];
const INSPECTION_PART = [
  '两处插座无电已现场标注，站点承诺一周内联系电工处理',
  '饮水机滤芯超期，要求更换；其余项目合格',
  '座位数比登记少 4 个，建议补充；急救箱药品齐全',
  '雨具已用完未及时补充，其余服务正常',
  '门口指引牌被遮挡，要求重新张贴；其余合格',
];
const INSPECTION_FAIL = [
  '现场无人应答，卷帘门关闭且未张贴暂停告示，暂判定信息失真',
  '充电区存在插线板超载与私拉电线，已当场要求整改并上报',
  '登记为全天开放，实际晚间无法进入，信息与现场不符',
];
const WO_TITLE = {
  closed: '核实并更新：{p} 开放状态与营业时间',
  info_wrong: '信息校正：{p} 地址/电话/服务项目',
  facility: '设施维修：{p} 充电与饮水设备',
  safety: '隐患整改：{p} 用电与通道安全',
  other: '需求受理：{p} 骑手建议汇总处理',
};

const IP_POOL = Array.from({ length: 140 }, () => {
  const seg = pick(['120.230', '183.23', '223.104', '14.116', '58.62', '113.77', '210.21', '119.35', '27.38', '36.5']);
  return `${seg}.${ri(1, 254)}.${ri(1, 254)}`;
});

// ---------------------------------------------------------------------------
// visits：180 天自然流水 + 近 14 天同时段保底 + 实时尾部
// ---------------------------------------------------------------------------
const HOUR_W = [
  0, 0, 0, 0, 0, 0, 0.3, 0.8, 1.4, 1.8, 2.4, 6.5, 7.2, 4.2, 2.2, 2.0, 2.4,
  5.0, 6.4, 4.6, 3.0, 2.0, 1.0, 0.4,
];
const WD_FACTOR = [1.12, 0.92, 0.96, 0.98, 1.0, 1.05, 1.15]; // 周日→周六

const visits = [];
const feedbacks = [];
let vseq = 0;
let fseq = 0;

// 骑手池随时间增长：早期 40 人活跃，到今天约 520 人
const RIDER_POOL = Array.from({ length: 520 }, () => hex16());
const tokenAt = (t) => RIDER_POOL[Math.floor(rnd() * (40 + 480 * t))];

function newVisit(pointId, ts, t, opts = {}) {
  vseq++;
  const reserved = ts - ri(3, 46) * 60;
  const token = opts.token ?? tokenAt(t);
  const status = opts.status ?? 'completed';
  const v = {
    id: `opsvisit${String(vseq).padStart(5, '0')}`,
    point_id: pointId,
    rider_token: token,
    created_ip: pick(IP_POOL),
    checkin_code: null,
    status,
    reserved_at: reserved,
    checked_in_at: null,
    checked_out_at: null,
    created_at: reserved,
  };
  if (status === 'completed') {
    v.checked_in_at = ts;
    // 25% 的离店不是本人扫码，而是 4 小时兜底自动释放（与 expireStaleVisits 写出的形状一致）
    v.checked_out_at = chance(0.25) ? ts + 4 * 3600 : ts + ri(12, 115) * 60;
  }
  visits.push(v);
  return v;
}

function genHistory() {
  for (let k = DAYS - 1; k >= 0; k--) {
    const t = (DAYS - 1 - k) / (DAYS - 1); // 0 最早 → 1 今天
    const daily = (3 + 16 * t) * WD_FACTOR[dowOf(k)] * (0.82 + rnd() * 0.4);
    // 当天只到今天此刻为止，且按已过小时数折算，免得早上跑出的"今日进店"比昨天还多
    const scale = k === 0 ? (hourNow + 1) / 24 : 1;
    for (const p of POINTS) {
      let cnt = Math.round(daily * p.w * (0.7 + rnd() * 0.6) * scale);
      if (cnt <= 0) continue;
      if (k === 0) cnt = Math.min(cnt, Math.max(1, Math.floor((hourNow + 1) / 2)));
      for (let i = 0; i < cnt; i++) {
        const h = Math.min(wpick(HOUR_W.map((_, idx) => idx), HOUR_W), 23);
        const hour = k === 0 ? Math.min(h, hourNow) : h;
        if (hour < p.hOpen[0] || (p.hOpen[1] <= 23 && hour > p.hOpen[1])) continue;
        const v = newVisit(p.id, at(k, hour, ri(0, 59)), t, {
          status: wpick(['completed', 'cancelled', 'expired'], [0.88, 0.05, 0.04]),
        });
        if (v.status === 'completed' && chance(0.62)) pushFeedback(v, p, t);
      }
    }
  }
}

// crowdHint 的判据是"近 14 天同星期同小时段"，一条都没有就只会显示"暂无历史规律"，
// T1 客流提示与 AI 上下文两条演示链路都哑。这里给午晚高峰做保底密度。
function genCrowdBackfill() {
  for (const p of POINTS) {
    for (let k = 1; k <= 14; k++) {
      for (const h of [11, 12, 13, 17, 18, 19]) {
        if (h < p.hOpen[0] || (p.hOpen[1] <= 23 && h > p.hOpen[1])) continue;
        if (chance(0.35)) continue; // 已有自然数据的时段跳过，避免双倍堆高
        const v = newVisit(p.id, at(k, h, ri(0, 59)), 1, { status: 'completed', token: hex16() });
        if (chance(0.5)) pushFeedback(v, p, 1);
      }
    }
  }
}

function pushFeedback(v, p, t) {
  fseq++;
  // 半年里口碑爬坡：早期均分 3.96 → 近期 4.50（对应整改与设备补充）
  const w5 = 0.40 + 0.18 * t, w4 = 0.32, w3 = 0.16 - 0.06 * t, w2 = 0.08 - 0.04 * t, w1 = 0.04 - 0.02 * t;
  const rating = wpick([5, 4, 3, 2, 1], [w5, w4, w3, w2, w1]);
  const supportTags = ['充电', '饮用水', '热饭', '休息区', '厕所', 'Wi-Fi', '雨具', '急救药品', '手机维修', '法律援助', '心理疏导'];
  const supportW = [0.55, 0.3, 0.3, 0.35, 0.2, 0.22, 0.1, 0.1, 0.08, 0.14, 0.08];
  const chosen = [...new Set(Array.from({ length: ri(1, 3) }, () => wpick(supportTags, supportW)))];
  feedbacks.push({
    id: `opsfb${String(fseq).padStart(5, '0')}`,
    visit_id: v.id,
    point_id: p.id,
    rating,
    supports: chosen,
    suggestion: chance(rating <= 3 ? 0.72 : 0.28) ? pick(rating >= 4 ? PRAISE : COMPLAIN) : '',
    created_at: v.checked_out_at + ri(0, 9) * 60,
  });
}

// 实时尾部：当前在店 / 有效预约 / 今日最新离店。每次运行都重造，避免被懒清理抹平。
const live = [];
function genLiveTail() {
  const codes = [];
  let seq = 0;
  const slots = [
    { point: POINTS[0], status: 'in_store', ago: ri(8, 55), minutes: 0 },
    { point: POINTS[1], status: 'in_store', ago: ri(20, 95), minutes: 0 },
    { point: POINTS[2], status: 'in_store', ago: ri(6, 40), minutes: 0 },
    { point: POINTS[2], status: 'in_store', ago: ri(50, 110), minutes: 0 },
    { point: POINTS[0], status: 'reserved', ago: ri(6, 35), minutes: 0 },
    { point: POINTS[1], status: 'reserved', ago: ri(15, 60), minutes: 0 },
    { point: POINTS[2], status: 'reserved', ago: ri(25, 70), minutes: 0 },
  ];
  for (const s of slots) {
    seq++;
    const checkedIn = s.status === 'in_store' ? now - s.ago * 60 : null;
    const code = s.status === 'reserved' ? code10() : null;
    if (code) codes.push({ point: s.point.name, code, minutes: s.ago });
    live.push({
      id: `opslive${String(seq).padStart(3, '0')}`,
      point_id: s.point.id,
      rider_token: hex16(),
      created_ip: pick(IP_POOL),
      checkin_code: code,
      status: s.status,
      reserved_at: (checkedIn ?? now - s.ago * 60) - ri(4, 20) * 60,
      checked_in_at: checkedIn,
      checked_out_at: null,
      created_at: (checkedIn ?? now - s.ago * 60) - ri(4, 20) * 60,
    });
  }
  // 今日已完成的三条（其中两条留反馈），让"今日进店"与最新离店反馈不是空值
  for (let i = 0; i < 3; i++) {
    seq++;
    const p = POINTS[i % POINTS.length];
    const inAt = Math.max(todayStart + 30 * 60, now - ri(60, hourNow * 60));
    const outAt = Math.min(inAt + ri(18, 80) * 60, now - 3 * 60);
    const v = {
      id: `opslive${String(seq).padStart(3, '0')}`,
      point_id: p.id, rider_token: hex16(), created_ip: pick(IP_POOL), checkin_code: null,
      status: 'completed', reserved_at: inAt - ri(5, 30) * 60, checked_in_at: inAt,
      checked_out_at: outAt, created_at: inAt - ri(5, 30) * 60,
    };
    live.push(v);
    if (i < 2) pushFeedback(v, p, 1);
  }
  return codes;
}

// ---------------------------------------------------------------------------
// reports / work_orders
// ---------------------------------------------------------------------------
const reports = [];
const orders = [];
let rseq = 0, oseq = 0;

function newReport(point, category, k, hour, status) {
  rseq++;
  const created = at(k, hour, ri(0, 59));
  const r = {
    id: `opsrep${String(rseq).padStart(4, '0')}`,
    point_id: point.id,
    category,
    content: pick(REPORT_TEXT[category]),
    images: [],
    status,
    created_at: created,
    work_order_id: null,
    query_code: code10(),
  };
  reports.push(r);
  return r;
}

function newOrder(report, status, createdGapDays, priority) {
  oseq++;
  const created = report.created_at + ri(20, 300) * 60 + createdGapDays * DAY;
  const done = status === 'resolved' || status === 'closed';
  const o = {
    id: `opswo${String(oseq).padStart(4, '0')}`,
    title: WO_TITLE[report.category].replace('{p}', report.pointName),
    description: `骑手上报（查询码 ${report.query_code.slice(0, 4)}…）：${report.content}。由值班管理员建单跟进。`,
    point_id: report.point_id,
    report_id: report.id,
    status,
    priority,
    resolution_note: done ? RESOLVE_NOTE[report.category].replace('{h}', report.pointHours) : '',
    resolved_at: done ? created + ri(1, 6) * DAY + ri(1, 12) * 3600 : null,
    created_at: created,
    updated_at: done ? created + ri(1, 6) * DAY + ri(1, 12) * 3600 : created + ri(1, 40) * 3600,
    created_by: pick(ADMIN_IDS),
  };
  orders.push(o);
  report.work_order_id = o.id;
  // 与 maybeAutoCreateWorkOrder 的写后状态一致：工单还在途，上报就必须是"核实处理中"
  if (status !== 'resolved' && status !== 'closed') report.status = 'processing';
  return o;
}

function genReports() {
  // 半年 54 条上报。k 用 1.8 次方分布压向近期——流量在爬坡、复核力度也在加大，
  // 早期的上报少而含糊，越靠近今天越密。
  const plan = [];
  for (let i = 0; i < 54; i++) {
    const k = Math.max(1, Math.round((DAYS - 3) * rnd() ** 1.8));
    const category = wpick(Object.keys(REPORT_WEIGHT), Object.values(REPORT_WEIGHT));
    plan.push({ k, category });
  }
  for (const { k, category } of plan) {
    // pending 一律留给演示点位以外的站，point001 的 pending 由下面精确控制成 2 条
    const p = k <= 7 ? pick(POINTS.slice(1)) : pick(POINTS);
    const status = k > 30 ? (chance(0.55) ? 'resolved' : 'closed')
      : k > 7 ? (chance(0.7) ? 'resolved' : chance(0.5) ? 'closed' : 'processing')
        : chance(0.42) ? 'resolved' : 'processing';
    const r = newReport(p, category, k, ri(9, 22), status);
    r.pointName = p.name; r.pointHours = p.openHours;
    if (status === 'processing') newOrder(r, 'in_progress', 0, category === 'safety' ? 'high' : 'normal');
    else if (status !== 'pending' && chance(0.6)) newOrder(r, status === 'resolved' ? 'resolved' : 'closed', 0, category === 'safety' ? 'urgent' : 'normal');
  }
  // 待核实 3 条：point001 刻意留 2 条 —— 现场再提交第 3 条就会踩到 AUTO_ORDER_THRESHOLD，
  // 自动建单这条链路可以当着评委的面跑一遍
  const demoPoint = POINTS[0];
  const w1 = newReport(demoPoint, 'facility', 0, Math.max(8, hourNow - 2), 'pending');
  w1.pointName = demoPoint.name; w1.pointHours = demoPoint.openHours;
  w1.created_at = now - ri(40, 170) * 60;
  const w2 = newReport(demoPoint, 'info_wrong', 1, ri(10, 19), 'pending');
  w2.pointName = demoPoint.name; w2.pointHours = demoPoint.openHours;
  const w3 = newReport(POINTS[2], 'other', 1, ri(11, 20), 'pending');
  w3.pointName = POINTS[2].name; w3.pointHours = POINTS[2].openHours;
  // 另有 3 个手动工单（不来自上报）：季度复核、设备增补、新增点位申请
  for (const [title, desc, status, pri, k] of [
    ['季度信息复核：三站点营业时间与准入要求', '按季度巡检计划对全部在册站点做一次信息复核，含电话接通性与门口指引牌。', 'open', 'normal', 2],
    ['设备增补：大学城北站雨具与充电宝租借试点', '反馈集中在这两项，拟与站点方试投放一个月，观察使用率。', 'open', 'low', 6],
    ['新增点位申请受理：番禺南村驿站', '站点方主动申请入库，待现场核验地址与准入条件后建档。', 'open', 'normal', 4],
  ]) {
    oseq++;
    const created = at(k, ri(9, 17), ri(0, 59));
    orders.push({
      id: `opswo${String(oseq).padStart(4, '0')}`,
      title, description: desc, point_id: pick(POINTS).id, report_id: null,
      status, priority: pri, resolution_note: '', resolved_at: null,
      created_at: created, updated_at: created + ri(1, 30) * 3600, created_by: pick(ADMIN_IDS),
    });
  }
}

// ---------------------------------------------------------------------------
// inspections / point_confirms
// ---------------------------------------------------------------------------
const inspections = [];
function genInspections() {
  let iseq = 0;
  for (const p of POINTS) {
    // 建档后首检 + 每月一次常规巡检 + 每次未通过/部分通过后 3–7 天复查
    let k = DAYS - 12;
    while (k > 1) {
      iseq++;
      const result = wpick(['pass', 'partial', 'fail'], [0.62, 0.26, 0.12]);
      const inspected = at(k, ri(10, 16), ri(0, 59));
      inspections.push({
        id: `opsins${String(iseq).padStart(3, '0')}`,
        point_id: p.id,
        inspector_id: pick(ADMIN_IDS),
        result,
        images: [],
        notes: result === 'pass' ? pick(INSPECTION_PASS) : result === 'partial' ? pick(INSPECTION_PART) : pick(INSPECTION_FAIL),
        inspected_at: inspected,
        created_at: inspected,
      });
      if (result !== 'pass' && k > 8) {
        iseq++;
        const re = inspected + ri(3, 7) * DAY;
        inspections.push({
          id: `opsins${String(iseq).padStart(3, '0')}`,
          point_id: p.id, inspector_id: pick(ADMIN_IDS), result: 'pass', images: [],
          notes: `复查：${pick(INSPECTION_PASS)}`, inspected_at: re, created_at: re,
        });
      }
      k -= ri(22, 38);
    }
  }
}

const confirms = [];
function genConfirms() {
  let cseq = 0;
  for (let k = DAYS - 2; k >= 0; k--) {
    const t = (DAYS - 1 - k) / (DAYS - 1);
    const cnt = Math.round((1.2 + 3.4 * t) * (0.6 + rnd() * 0.8));
    for (let i = 0; i < cnt; i++) {
      cseq++;
      confirms.push({
        id: `opsconf${String(cseq).padStart(4, '0')}`,
        point_id: pick(POINTS).id,
        rider_token: tokenAt(t),
        created_at: at(k, ri(9, 22), ri(0, 59)),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// ai_knowledge：把 6 条扩到 18 条（权益/渠道/常见问题/公告四类均衡）
// 内容口径与既有 6 条一致：只给公开可核实的渠道与政策要点，涉及个案一律引导到专业机构
// ---------------------------------------------------------------------------
const KNOWLEDGE = [
  ['rights', '跑单途中受伤怎么办：先固定证据再走职业伤害保障',
    '发生事故后第一步是就医并保留病历、发票与事故现场照片，第二步截图当日的接单记录、行程轨迹与配送订单号。广东是职业伤害保障试点省份之一，可通过接单平台的"职业伤害申报"入口或当地人社部门（咨询 12333）申报，保障对象包含符合条件的新就业形态劳动者。若平台未依法参保，可同时向劳动保障监察机构反映（咨询 12333 或 12345）。注意时效：申报一般要求在事故发生后尽快提出，拖延会影响受理。',
    '["受伤","工伤","职业伤害","事故","报销","申报","试点","证据"]'],
  ['rights', '被扣款、罚款或账号被封，怎么申诉',
    '先在对账/接单记录里把扣款的时间、金额、事由截图存证，再走平台内部申诉通道（客服工单、骑手 App 申诉入口），保留工单编号与回复截图。对处理结果不满意时，可向工会职工服务中心反映（12351），或拨打公共法律服务热线 12348 咨询下一步；涉及金额较大、疑似违法扣款的，可向 12345 转劳动保障监察举报。要点是证据链：接单规则截图 + 扣款记录 + 沟通记录，缺一都会让后续维权变难。',
    '["扣款","罚款","封号","申诉","维权","监察","证据","客服"]'],
  ['rights', '社保和医保怎么自己缴：灵活就业参保',
    '没有固定用工单位的骑手可以按"灵活就业人员"身份参加职工基本养老保险和职工医保，也可参加城乡居民医保，具体险种、缴费基数和补贴标准以参保地政策为准。办理渠道：当地税务或人社部门的线上小程序、经办大厅，咨询电话 12333。两地户籍分离的，通常可在就业地参加居民医保，需要办理就业登记或居住证。建议不要为了参保去注册个体工商户，人社部门已明确平台不得诱导或强迫骑手注册为个体工商户以规避用工责任。',
    '["社保","医保","养老保险","灵活就业","参保","12333","户籍"]'],
  ['rights', '劳动仲裁的基本流程与时效',
    '如果与平台或站点（外包公司）存在用工争议，可申请劳动仲裁：第一步确认被申请人（看工资由谁发放、接单 App 主体是谁、工牌/合同署名）；第二步到用工所在地或申请人所在地的劳动人事争议仲裁委员会提交申请书与证据；第三步是受理、开庭、裁决。仲裁时效一般为一年，从当事人知道或应当知道权利被侵害之日起算。经济困难或属于新就业形态劳动者的，可向法律援助中心申请免费代理（12348 咨询）。本条只讲流程，个案请找专业律师或工会确认。',
    '["仲裁","劳动","时效","流程","外包","申请","法援","合同"]'],
  ['channel', '人力资源社会保障服务热线 12333',
    '12333 是全国统一的人力资源社会保障服务热线，可咨询社保与医保参保、职业伤害保障、工伤认定、劳动报酬监察举报、就业扶持政策等。人工服务一般在工作日，语音与线上小程序全天候。涉及欠薪、超时加班、不依法参保等线索，可通过 12333 或全国根治欠薪线索反映平台提交。广州可另拨 020-12345 政务服务热线转办。',
    '["12333","人社","社保","咨询","监察","欠薪","热线"]'],
  ['channel', '政务服务便民热线 12345 能管哪些事',
    '12345 是地方政府综合服务热线，受理各类非紧急的政务咨询、投诉与建议，会分派到对应职能部门并回访。适合的情况：站点周边停车与市容问题、无证占道、找不到线下劳动者服务站点、其他热线转办无果的政策咨询。拨打时讲清地点、时间、诉求三件事，记下工单号便于跟进。涉及紧急人身安全请用 110/120/119。',
    '["12345","政务","投诉","工单","热线","分派","回访"]'],
  ['channel', '工会户外劳动者服务站点怎么找',
    '各级总工会在街头、商圈、便利店等地设有"户外劳动者服务站点/工会驿站",通常提供免费饮水、热饭、热天休息、手机充电、应急药品等服务,多数不要求登记。查找方式：微信搜索"全国工会职工服务"或各省总工会公众号里的"驿站地图",也可拨 12351 询问离你最近的站点。暖途同行收录的驿站信息可由站点方或工会登记，遇到实际不开门的情况请在站内上报，我们会复核更新。',
    '["工会","驿站","服务站点","热饭","饮水","地图","12351"]'],
  ['channel', '交通事故现场处置与报警',
    '配送途中发生交通事故：有人伤先拨 120 并保护现场，同时拨 122（交通事故报警）；仅车损无人伤的，拍照固定双方车辆位置与号牌后尽快撤离，避免二次事故。及时向站长与平台报备，保留事故认定书、医院票据与维修单据，供职业伤害保障或商业保险理赔使用。不要私了后删除现场照片；对责任认定有异议的，可在规定期限内申请复核，具体流程可拨 12348 咨询。',
    '["交通事故","122","120","报警","认定书","理赔","保险","私了"]'],
  ['faq', '预约进店要钱吗？会不会被收押金',
    '暖途同行收录的驿站全部免费，预约、入店确认、离店评价都不收费，也不收任何押金。如果个别站点以"押金""刷卡消费"名义收费，属于与登记信息不符，请立即在站点详情页上报，我们会核实并标注。',
    '["收费","免费","押金","预约","诈骗"]'],
  ['faq', '为什么要出示入店码，能不能直接进去',
    '预约成功后页面给出的 10 位入店码是一次性的，用来把"名额"和"到店"对上：站点容量有限，只有实际到店的人才占用名额。直接进去休息一般不被拒绝（多数站点不登记），但这样站点看不到实时人数，高峰时可能出现挤爆却仍显示有空位的情况。不愿扫码也没关系，本页面的信息照样可以免费查看。',
    '["入店码","预约","名额","扫码","容量"]'],
  ['faq', '上报之后多久会有人处理，怎么查进度',
    '上报会先进入"待核实"，值班管理员按点位就近安排复核；同一点位积压满 3 条会自动生成工单。处理结果与进度凭上报成功后给出的 10 位查询码查看，无需登录。多数问题在 1 至 7 天内闭环，安全隐患类会优先处理。',
    '["上报","进度","查询码","工单","多久","待核实"]'],
  ['faq', '小暖的回答能当作法律意见吗',
    '不能。小暖只做两件事：引用本站知识库里已经人工核对过的条目并附上出处，以及根据站点数据回答"哪里有位置、现在挤不挤、怎么预约"这类操作性问题。法律、社保、工伤认定这类个案结论必须由工会、法律援助机构或律师根据你的具体材料判断，小暖会指引你到 12351、12348、12333 等正规渠道，不会替你做决定。',
    '["AI","法律意见","准确","知识库","免责","出处"]'],
];

const knowledge = [];
function genKnowledge() {
  let kseq = 0;
  for (let i = 0; i < KNOWLEDGE.length; i++) {
    kseq++;
    const [category, title, content, tags] = KNOWLEDGE[i];
    // 更新时间散布在半年里，看起来是持续维护而不是今天一次灌进来的
    const k = Math.max(1, Math.round((KNOWLEDGE.length - i) * 12 + rnd() * 8));
    knowledge.push({
      id: `opsknow${String(kseq).padStart(3, '0')}`,
      category, title, content, tags: JSON.parse(tags),
      enabled: 1,
      updated_at: at(k, ri(9, 18), ri(0, 59)),
    });
  }
}

// ---------------------------------------------------------------------------
// service_points：内容不动，只把 created_at / verified_at / updated_at 回退半年，
// 并为每次历史改动生成变更前快照（point_history.snapshot 与 getPoint 的下发形状一致）
// ---------------------------------------------------------------------------
const pointMeta = [];
const histories = [];

// 各点位"最近一次现场复核"发生在多少天前，必须与 EVOLUTION 里写入 verified_at
// 的那一步对齐：复核之前的快照 verified_at 为空，之后的都带着这个时间。
const VERIFY_K = { point001: 75, point002: 88, point003: 70 };

// 每个点位从今天的真实行往回倒推的"更早取值"（数组顺序 = 改动时间从新到旧）。
// point_history 的语义来自 snapshotPoint()：存的是**那次改动之前**的行状态，
// changed_at 是改动发生的时刻，snapshot.updated_at 退回上一次（更早那次）改动的时间。
const EVOLUTION = {
  point001: [
    { k: 3, patch: (s) => { s.notes = '二楼设有微波炉，雨天可免费借用雨衣'; } },
    { k: 21, patch: (s, live) => { s.admission = { ...live.admission, capacity: 15 }; } },
    { k: 48, patch: (s) => { s.services = s.services.filter((x) => x !== '急救箱'); } },
    { k: 75, patch: (s) => { s.open_hours = '周一至周日 08:00–22:00'; s.verified_at = null; } },
    { k: 150, patch: (s) => { s.address = '广州市番禺区大学城贝岗村贝岗大街12号'; } },
    { k: 176, patch: (s) => { s.contact_phone = ''; s.status = 'temp_closed'; } },
  ],
  point002: [
    { k: 9, patch: (s) => { s.notes = '紧邻地铁大学城北站A口'; } },
    { k: 33, patch: (s) => { s.services = s.services.filter((x) => x !== '停车'); } },
    { k: 62, patch: (s, live) => { s.admission = { ...live.admission, capacity: 10 }; } },
    { k: 88, patch: (s) => { s.open_hours = '07:00–23:00'; s.verified_at = null; } },
    { k: 132, patch: (s) => { s.lat = 23.0625; s.lng = 113.3895; } },
    { k: 172, patch: (s) => { s.services = ['休息区', '饮用水']; s.contact_phone = ''; } },
  ],
  point003: [
    { k: 2, patch: (s) => { s.services = s.services.filter((x) => x !== 'Wi-Fi'); } },
    { k: 18, patch: (s, live) => { s.admission = { ...live.admission, capacity: 24 }; } },
    { k: 40, patch: (s) => { s.notes = '免费提供午餐（11:00–13:00），需凭骑手工牌'; } },
    // 7 月因装修停业 → 恢复营业时做了复核，所以停业期的快照 verified_at 为空
    { k: 70, patch: (s) => { s.status = 'temp_closed'; s.open_hours = '装修暂停，恢复时间待定'; s.verified_at = null; } },
    { k: 74, patch: (s, live) => { s.status = 'open'; s.open_hours = live.open_hours; } },
    { k: 120, patch: (s) => { s.services = ['休息区', '充电', '饮用水', '急救箱']; } },
    { k: 168, patch: (s) => { s.district = '番禺区小谷围'; } },
  ],
};

function genPointTimelines() {
  for (const p of POINTS) {
    const steps = (EVOLUTION[p.id] ?? []).slice();
    // live 是"当前真实行"，随后被 patch 一步步倒退回旧状态。
    // created_by 要剥掉：snapshotPoint() 存的是 getPoint() 的下发形状，不含管理员 id。
    const { created_by: _omit, ...rowShape } = p.row;
    const state = { ...rowShape, verified_at: p.verifyTs, created_at: p.createdTs, updated_at: p.verifyTs };
    steps.forEach((st, idx) => {
      st.patch(state, p.row);
      state.updated_at = idx + 1 < steps.length
        ? dayTs(steps[idx + 1].k) + ri(9, 17) * 3600 + ri(0, 59) * 60
        : p.createdTs + ri(3600, 7200 * 4);
      histories.push({
        id: `opshist${String(histories.length + 1).padStart(3, '0')}`,
        point_id: p.id,
        changed_by: pick(ADMIN_IDS),
        changed_at: dayTs(st.k) + ri(9, 18) * 3600 + ri(0, 59) * 60,
        snapshot: JSON.parse(JSON.stringify(state)),
      });
    });
    pointMeta.push({
      id: p.id,
      created_at: p.createdTs,
      verified_at: p.verifyTs,
      updated_at: dayTs(steps.length > 0 ? steps[0].k : 20) + ri(9, 18) * 3600,
    });
  }
}

// ---------------------------------------------------------------------------
// SQL 拼装
// ---------------------------------------------------------------------------
const stmts = [];
const add = (s) => stmts.push(s);

function insertBatch(table, cols, rows, chunk = 60) {
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const values = part.map((r) => `(${cols.map((c) => r[c] === undefined ? 'NULL' : r[c]).join(', ')})`).join(',\n');
    add(`INSERT OR IGNORE INTO ${table} (${cols.join(', ')}) VALUES\n${values};`);
  }
}

function purgeStmts(target) {
  // 删除顺序由外键决定：reports.work_order_id → work_orders.id，而
  // work_orders.report_id → reports.id，两向都引用，必须先把引用列清空再删行。
  target.push(
    `DELETE FROM point_history WHERE id LIKE 'ops%';`,
    `DELETE FROM visit_feedback WHERE id LIKE 'ops%';`,
    `DELETE FROM visits WHERE id LIKE 'ops%';`,
    `UPDATE reports SET work_order_id = NULL WHERE work_order_id LIKE 'ops%';`,
    `UPDATE work_orders SET report_id = NULL WHERE report_id LIKE 'opsrep%';`,
    `DELETE FROM work_orders WHERE id LIKE 'ops%';`,
    `DELETE FROM reports WHERE id LIKE 'ops%';`,
    `DELETE FROM inspections WHERE id LIKE 'ops%';`,
    `DELETE FROM point_confirms WHERE id LIKE 'ops%';`,
    `DELETE FROM ai_knowledge WHERE id LIKE 'ops%';`,
  );
}

function buildSql() {
  // --- visits（历史 + 实时尾部）---
  const allVisits = [...visits, ...live].map((v) => ({
    id: q(v.id), point_id: q(v.point_id), rider_token: q(v.rider_token),
    created_ip: q(v.created_ip), checkin_code: q(v.checkin_code), status: q(v.status),
    reserved_at: n(v.reserved_at), checked_in_at: n(v.checked_in_at),
    checked_out_at: n(v.checked_out_at), created_at: n(v.created_at),
  }));
  insertBatch('visits',
    ['id', 'point_id', 'rider_token', 'created_ip', 'checkin_code', 'status', 'reserved_at', 'checked_in_at', 'checked_out_at', 'created_at'],
    allVisits);

  // --- visit_feedback（含实时尾部今天产生的）---
  insertBatch('visit_feedback',
    ['id', 'visit_id', 'point_id', 'rating', 'supports', 'suggestion', 'created_at'],
    feedbacks.map((f) => ({
      id: q(f.id), visit_id: q(f.visit_id), point_id: q(f.point_id), rating: n(f.rating),
      supports: J(f.supports), suggestion: q(f.suggestion), created_at: n(f.created_at),
    })));

  // --- reports / work_orders ---
  insertBatch('reports',
    ['id', 'point_id', 'category', 'content', 'images', 'status', 'created_at', 'query_code'],
    reports.map((r) => ({
      id: q(r.id), point_id: q(r.point_id), category: q(r.category), content: q(r.content),
      images: J(r.images), status: q(r.status), created_at: n(r.created_at), query_code: q(r.query_code),
    })));
  insertBatch('work_orders',
    ['id', 'title', 'description', 'point_id', 'report_id', 'status', 'priority', 'resolution_note', 'resolved_at', 'created_at', 'updated_at', 'created_by'],
    orders.map((o) => ({
      id: q(o.id), title: q(o.title), description: q(o.description), point_id: q(o.point_id),
      report_id: o.report_id ? q(o.report_id) : 'NULL', status: q(o.status), priority: q(o.priority),
      resolution_note: q(o.resolution_note), resolved_at: n(o.resolved_at),
      created_at: n(o.created_at), updated_at: n(o.updated_at), created_by: q(o.created_by),
    })));
  // 工单与上报互为外键，先建单再回填关联列
  for (const r of reports) {
    if (r.work_order_id) add(`UPDATE reports SET work_order_id = ${q(r.work_order_id)} WHERE id = ${q(r.id)};`);
  }

  // --- inspections / point_confirms ---
  insertBatch('inspections',
    ['id', 'point_id', 'inspector_id', 'result', 'images', 'notes', 'inspected_at', 'created_at'],
    inspections.map((i) => ({
      id: q(i.id), point_id: q(i.point_id), inspector_id: q(i.inspector_id), result: q(i.result),
      images: J(i.images), notes: q(i.notes), inspected_at: n(i.inspected_at), created_at: n(i.created_at),
    })));
  insertBatch('point_confirms',
    ['id', 'point_id', 'rider_token', 'created_at'],
    confirms.map((c) => ({
      id: q(c.id), point_id: q(c.point_id), rider_token: q(c.rider_token), created_at: n(c.created_at),
    })));

  // --- point_history + 点位时间戳回填 ---
  insertBatch('point_history',
    ['id', 'point_id', 'changed_by', 'changed_at', 'snapshot'],
    histories.map((h) => ({
      id: q(h.id), point_id: q(h.point_id), changed_by: q(h.changed_by),
      changed_at: n(h.changed_at), snapshot: q(JSON.stringify(h.snapshot)),
    })));
  for (const m of pointMeta) {
    add(`UPDATE service_points SET created_at = ${n(m.created_at)}, verified_at = ${n(m.verified_at)}, updated_at = ${n(m.updated_at)} WHERE id = ${q(m.id)};`);
  }

  // --- ai_knowledge：新增条目 + 把原有 6 条的更新时间回退到半年内 ---
  insertBatch('ai_knowledge',
    ['id', 'category', 'title', 'content', 'tags', 'enabled', 'updated_at'],
    knowledge.map((k) => ({
      id: q(k.id), category: q(k.category), title: q(k.title), content: q(k.content),
      tags: q(JSON.stringify(k.tags)), enabled: n(k.enabled), updated_at: n(k.updated_at),
    })));
  add(`UPDATE ai_knowledge SET updated_at = ${n(at(118, 10, 20))} WHERE id = 'knowl01chan01';`);
  add(`UPDATE ai_knowledge SET updated_at = ${n(at(64, 15, 40))} WHERE id = 'knowl03righ01';`);
  add(`UPDATE ai_knowledge SET updated_at = ${n(at(26, 9, 15))} WHERE id = 'knowl06noti01';`);
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------
function runWrangle(args) {
  return spawnSync(process.execPath, [WRANGLER, ...args.slice(1)], {
    encoding: 'utf8',
    env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID },
    maxBuffer: 32 * 1024 * 1024,
  });
}

function queryJson(sql) {
  const r = runWrangle(['wrangler', 'd1', 'execute', DB_NAME, '--command', sql, '-y', '--json', REMOTE ? '--remote' : '--local']);
  if (r.status !== 0) {
    throw new Error(`查询失败：${(r.stderr ?? r.stdout ?? '').split('\n').slice(0, 5).join(' ')}`);
  }
  const body = (r.stdout ?? '').trim().replace(/^\uFEFF/, '');
  const parsed = JSON.parse(body.slice(body.indexOf('[')));
  return parsed[0]?.results ?? [];
}

function execute(list, label) {
  // 每个临时文件承载的语句数。wrangler 会把一个文件里的语句合成批提交，
  // 单批过大顶到 D1 请求上限就会整批失败，所以按"小批多次"走。
  const CH = 8;
  for (let i = 0; i < list.length; i += CH) {
    const chunk = list.slice(i, i + CH);
    const tmp = path.join(os.tmpdir(), `wj-ops-${Date.now()}-${i}.sql`);
    fs.writeFileSync(tmp, chunk.join('\n'), 'utf8');
    const r = runWrangle(['wrangler', 'd1', 'execute', DB_NAME, '--file', tmp, '-y', REMOTE ? '--remote' : '--local']);
    fs.rmSync(tmp, { force: true });
    if (r.status !== 0) {
      console.error(`✗ ${label} 第 ${Math.floor(i / CH) + 1} 批失败：`);
      console.error((r.stderr ?? r.stdout ?? '').split('\n').slice(0, 12).join('\n'));
      exit(1);
    }
    process.stdout.write(`  ${label} ${Math.min(i + CH, list.length)}/${list.length}\r`);
  }
  process.stdout.write(`  ${label} ${list.length}/${list.length} ✓\n`);
}

function loadBindings() {
  const admins = queryJson('SELECT id, username, display_name FROM admin_users ORDER BY created_at;');
  if (admins.length === 0) {
    console.error('✗ 库里没有管理员账号。point_history / work_orders / inspections 的归属列需要真实管理员 id。');
    console.error('  先建号：npm run admin:create（本地）或 ADMIN_USERNAME=... ADMIN_PASSWORD=... npm run admin:create -- --remote');
    exit(1);
  }
  ADMIN_IDS.push(...admins.map((a) => a.id));
  console.log(`· 管理员归属：${admins.map((a) => `${a.display_name || a.username}(${a.id})`).join('、')}`);

  // 按 id 排：本脚本多处依赖 POINTS[0] 是"自动建单演示点位"，
  // 用 created_at 排序会随上一轮回填的时间戳漂移，第二次跑就换人了
  const rows = queryJson('SELECT * FROM service_points ORDER BY id;');
  if (rows.length === 0) {
    console.error('✗ 库里没有服务点，先执行 npm run db:seed');
    exit(1);
  }
  for (const row of rows) {
    const services = JSON.parse(row.services || '[]');
    POINTS.push({
      id: row.id,
      name: row.name,
      row: {
        ...row,
        services,
        admission: JSON.parse(row.admission || '{}'),
      },
      services,
      openHours: row.open_hours,
      // 24 小时站点返回 [0,24]，其余按营业时间文本里的"早/晚"边界取整
      hOpen: row.open_hours.includes('24') || row.open_hours === '全天' ? [0, 24] : parseHours(row.open_hours),
      w: 0,
      createdTs: dayTs(DAYS - 2) + ri(9, 17) * 3600,
      verifyTs: at(VERIFY_K[row.id] ?? 60, ri(10, 16), ri(0, 59)),
    });
  }
  // 容量越大、越好找 → 客流越高；三点开放状态一致时才按此权重分配
  const weights = POINTS.map((p) => (p.row.status === 'open' ? 1 : 0.15));
  const raw = POINTS.map((p, i) => ((p.row.admission.capacity ?? 15) / 15) * weights[i]);
  const sum = raw.reduce((s, x) => s + x, 0);
  POINTS.forEach((p, i) => { p.w = raw[i] / sum; });
  console.log(`· 点位：${POINTS.map((p) => `${p.name.slice(0, 12)}(${(p.w * 100).toFixed(0)}%)`).join('、')}`);
}

// 从"周一至周日 07:00–23:00"这类文本里取营业时段边界
function parseHours(text) {
  const m = text.match(/(\d{1,2}):(\d{2})\s*[–\-~至]\s*(\d{1,2}):(\d{2})/);
  if (!m) return [8, 21];
  return [Number(m[1]), Number(m[3]) <= 6 ? 23 : Number(m[3])];
}

function main() {
  loadBindings();

  if (PURGE) {
    const p = [];
    purgeStmts(p);
    console.log(`→ 清理 ops* 造数（${REMOTE ? '生产' : '本地'}库）`);
    execute(p, 'purge');
    console.log('✓ 已删除本脚本写入的全部行（真实数据与 seed-demo 的 demo* 行未受影响）');
    return;
  }

  let liveCodes = [];
  if (LIVE_ONLY) {
    // 只重造"当前在店 / 有效预约 / 今日离店"，历史流水一行不动
    liveCodes = genLiveTail();
    const tail = [];
    for (const v of live) {
      tail.push(`INSERT OR IGNORE INTO visits (id, point_id, rider_token, created_ip, checkin_code, status, reserved_at, checked_in_at, checked_out_at, created_at) VALUES (${q(v.id)}, ${q(v.point_id)}, ${q(v.rider_token)}, ${q(v.created_ip)}, ${q(v.checkin_code)}, ${q(v.status)}, ${n(v.reserved_at)}, ${n(v.checked_in_at)}, ${n(v.checked_out_at)}, ${n(v.created_at)});`);
    }
    for (const f of feedbacks) {
      tail.push(`INSERT OR IGNORE INTO visit_feedback (id, visit_id, point_id, rating, supports, suggestion, created_at) VALUES (${q(f.id)}, ${q(f.visit_id)}, ${q(f.point_id)}, ${n(f.rating)}, ${J(f.supports)}, ${q(f.suggestion)}, ${n(f.created_at)});`);
    }
    const p = [
      `DELETE FROM visit_feedback WHERE visit_id LIKE 'opslive%';`,
      `DELETE FROM visits WHERE id LIKE 'opslive%';`,
    ];
    console.log(`→ 只刷新实时尾部（${REMOTE ? '生产' : '本地'}库）`);
    execute(p, 'purge-live');
    execute(tail, 'live');
    summary();
    printLive(liveCodes);
    return;
  }

  genHistory();
  genCrowdBackfill();
  liveCodes = genLiveTail();
  genReports();
  genInspections();
  genConfirms();
  genKnowledge();
  genPointTimelines();
  buildSql();

  const p = [];
  purgeStmts(p);

  if (DRY_FILE) {
    const all = [...p, ...stmts];
    fs.writeFileSync(DRY_FILE, all.join('\n'), 'utf8');
    console.log(`✓ 已生成 SQL（${all.length} 条语句）→ ${DRY_FILE}，未执行任何写入`);
    return;
  }

  console.log(`→ 目标库：${DB_NAME}（${REMOTE ? '生产' : '本地'}）`);
  execute(p, 'purge');
  execute(stmts, 'insert');
  summary();
  console.log('\n✓ 造数完成。演示当天若距本次执行超过 2 小时，重跑一次：node scripts/seed-ops.mjs' + (REMOTE ? ' --remote --live-only' : ' --live-only'));
  printLive(liveCodes);
}

function summary() {
  console.log(`· visits ${visits.length + live.length}（历史 ${visits.length} + 实时 ${live.length}）`);
  console.log(`· visit_feedback ${feedbacks.length} · reports ${reports.length} · work_orders ${orders.length}`);
  console.log(`· inspections ${inspections.length} · point_confirms ${confirms.length} · point_history ${histories.length} · ai_knowledge +${knowledge.length}`);
}

function printLive(codes) {
  if (codes.length > 0) {
    console.log('\n· 有效预约的入店码（演示"到店扫码确认"链路时用）：');
    for (const c of codes) console.log(`    ${c.point.slice(0, 14)}… ${c.code}（预约于 ${c.minutes} 分钟前）`);
  }
  const openRep = reports.filter((r) => r.status === 'pending' || r.status === 'processing').slice(0, 3);
  if (openRep.length > 0) {
    console.log('· 可查进度的上报码（打开 /report-status 输入即可）：');
    for (const r of openRep) console.log(`    ${r.query_code}  ${r.status}  ${r.category}`);
  }
}

// 生产库写入闸（M9）：本脚本写出去的是合成数据，误跑进生产会污染真实运营统计与看板，
// 而"清理"要靠记得住 ops* 前缀。--remote 的任何写操作（造数/刷新/purge）都要求手输 prod，
// 自动化场景显式带 --yes。--dry 只生成 SQL 不写库，不受此闸约束。
async function confirmRemoteWrite() {
  const what = PURGE ? '删除生产库的 ops* 造数行' : LIVE_ONLY ? '刷新生产库的实时尾部' : '向生产库写入半年合成流水';
  if (!stdin.isTTY) {
    console.error(`✗ 本次操作是「${what}」，需要交互确认，而当前是非交互环境。`);
    console.error('  确认无误后手动加 --yes 重跑：node scripts/seed-ops.mjs --remote --yes');
    exit(1);
  }
  console.error(`⚠ 目标：生产库 ${DB_NAME} —— ${what}`);
  console.error('  这些全是合成数据（主键 ops* 前缀）。路演结束后请用 npm run db:seed:ops:purge:prod 清干净。');
  const rl = readline.createInterface({ input: stdin, output: stdout });
  let answer = '';
  try {
    answer = (await rl.question('输入 prod 确认执行，其他任意输入取消: ')).trim();
  } finally {
    rl.close();
  }
  if (answer !== 'prod') {
    console.log('已取消，未对生产库做任何写入。');
    exit(0);
  }
}

if (REMOTE && !YES && !DRY_FILE) await confirmRemoteWrite();

main();
