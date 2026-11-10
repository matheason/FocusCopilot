// FocusCopilot 分类 & 目标 公共逻辑（看板等页面共用）
//
// 存储结构 chrome.storage.local.categoryConfig:
// {
//   categories: [{ id, name, color, goal: null | { period: 'day'|'week', type: 'min'|'max', hours } }],
//   sites: { 'bilibili.com': 'fun', ... }   // 规则 → 分类 id
// }
// 规则匹配：完全相同，或者是它的子域名（bilibili.com 匹配 www.bilibili.com），取最长匹配。
// 分类是在查看时根据 history 实时计算的，所以修改规则后历史数据也会按新规则重新归类。

const UNCATEGORIZED_ID = '__none__';
const UNCATEGORIZED = { id: UNCATEGORIZED_ID, name: '未分类', color: '#94a3b8', goal: null };

const DEFAULT_CATEGORY_CONFIG = {
  categories: [
    { id: 'study', name: '学习/工作', color: '#6366f1', goal: { period: 'day', type: 'min', hours: 2 } },
    { id: 'fun', name: '娱乐', color: '#ec4899', goal: { period: 'week', type: 'max', hours: 10 } },
    { id: 'social', name: '社交/资讯', color: '#f59e0b', goal: null },
  ],
  sites: {
    'github.com': 'study',
    'stackoverflow.com': 'study',
    'developer.mozilla.org': 'study',
    'leetcode.cn': 'study',
    'leetcode.com': 'study',
    'claude.ai': 'study',
    'chatgpt.com': 'study',
    'bilibili.com': 'fun',
    'youtube.com': 'fun',
    'douyin.com': 'fun',
    'netflix.com': 'fun',
    'iqiyi.com': 'fun',
    'v.qq.com': 'fun',
    'weibo.com': 'social',
    'zhihu.com': 'social',
    'x.com': 'social',
    'twitter.com': 'social',
    'reddit.com': 'social',
    'xiaohongshu.com': 'social',
  },
};

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function loadCategoryConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['categoryConfig'], (r) => {
      const cfg = r.categoryConfig;
      if (cfg && Array.isArray(cfg.categories) && cfg.sites) {
        resolve(cfg);
      } else {
        resolve(JSON.parse(JSON.stringify(DEFAULT_CATEGORY_CONFIG)));
      }
    });
  });
}

function saveCategoryConfig(cfg) {
  return new Promise((resolve) => chrome.storage.local.set({ categoryConfig: cfg }, resolve));
}

function newCategoryId() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

const FILE_PREFIX = 'file: ';

// 把本地路径规范成统一格式：反斜杠转正斜杠、去掉末尾斜杠
function normalizeLocalPath(p) {
  let s = p.trim().replace(/^["']|["']$/g, '').replace(/\\/g, '/');
  if (/^\/[a-zA-Z]:\//.test(s)) s = s.slice(1);
  if (s.length > 1 && !/^[a-zA-Z]:\/$/.test(s)) s = s.replace(/\/+$/, '');
  return s;
}

// 输入是否像本地路径：D:\xxx、D:/xxx、/home/xxx、\\server\share
function looksLikeLocalPath(s) {
  return /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('/') || s.startsWith('\\\\');
}

// 把用户输入的网址/域名/本地文件夹规范成规则 key
function normalizeSiteRule(input) {
  const raw = (input || '').trim();
  if (!raw) return '';

  // 本地文件 / 文件夹：统一成 "file: D:/Docs/Study"
  if (raw.startsWith(FILE_PREFIX)) return FILE_PREFIX + normalizeLocalPath(raw.slice(FILE_PREFIX.length));
  if (/^file:/i.test(raw)) {
    try {
      const u = new URL(raw);
      let p = decodeURIComponent(u.pathname);
      if (u.host) p = `//${u.host}${p}`;
      return FILE_PREFIX + normalizeLocalPath(p);
    } catch (e) {
      return FILE_PREFIX + normalizeLocalPath(raw.replace(/^file:\/*/i, ''));
    }
  }
  if (looksLikeLocalPath(raw)) return FILE_PREFIX + normalizeLocalPath(raw);

  let s = raw.toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0];
  if (s.startsWith('www.')) s = s.slice(4);
  return s;
}

// 本地文件规则：文件路径等于规则，或位于规则文件夹之下（不区分大小写，Windows 路径不分大小写）
function fileRuleMatches(siteKey, rule) {
  const key = siteKey.toLowerCase();
  const r = rule.toLowerCase();
  return key === r || key.startsWith(r.endsWith('/') ? r : r + '/');
}

// 返回某个站点 key 对应的规则（最长匹配），没有则返回 null
function matchSiteRule(siteKey, sites) {
  if (sites[siteKey] !== undefined) return siteKey;
  const isFile = siteKey.startsWith(FILE_PREFIX);
  let best = null;
  for (const rule of Object.keys(sites)) {
    const ok = isFile
      ? rule.startsWith(FILE_PREFIX) && fileRuleMatches(siteKey, rule)
      : siteKey.endsWith('.' + rule);
    if (ok && (!best || rule.length > best.length)) best = rule;
  }
  return best;
}

function categoryIdOf(siteKey, cfg) {
  const rule = matchSiteRule(siteKey, cfg.sites);
  const id = rule ? cfg.sites[rule] : null;
  if (id && cfg.categories.some((c) => c.id === id)) return id;
  return UNCATEGORIZED_ID;
}

function allCategories(cfg) {
  return [...cfg.categories, UNCATEGORIZED];
}

function categoryById(cfg, id) {
  return allCategories(cfg).find((c) => c.id === id) || UNCATEGORIZED;
}

// 某天的 { 站点: 秒数 }
function dailySiteTotals(history, dateKey) {
  const hours = history[dateKey]?.hours || {};
  const totals = {};
  for (const h of Object.keys(hours)) {
    for (const [site, sec] of Object.entries(hours[h])) {
      totals[site] = (totals[site] || 0) + sec;
    }
  }
  return totals;
}

// 某天的 { 分类id: 秒数 }
function dailyCategoryTotals(history, dateKey, cfg) {
  const totals = {};
  for (const [site, sec] of Object.entries(dailySiteTotals(history, dateKey))) {
    const id = categoryIdOf(site, cfg);
    totals[id] = (totals[id] || 0) + sec;
  }
  return totals;
}

// 本周一 00:00（周一作为一周开始）
function weekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 周一=0
  d.setDate(d.getDate() - dow);
  return d;
}

function weekDays(start) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

// 评估目标。返回 { status: 'done'|'fail'|'progress'|'future', actual, target }
// isOver: 这个周期是否已经结束；isFuture: 周期还没开始
function evaluateGoal(goal, actualSec, { isOver, isFuture }) {
  const target = Math.round(goal.hours * 3600);
  if (isFuture) return { status: 'future', actual: actualSec, target };
  if (goal.type === 'min') {
    if (actualSec >= target) return { status: 'done', actual: actualSec, target };
    return { status: isOver ? 'fail' : 'progress', actual: actualSec, target };
  }
  // max：不超过上限
  if (actualSec > target) return { status: 'fail', actual: actualSec, target };
  return { status: isOver ? 'done' : 'progress', actual: actualSec, target };
}

function formatDuration(seconds) {
  seconds = Math.round(seconds);
  if (seconds < 60) return `${seconds} 秒`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins} 分钟`;
  const hrs = Math.floor(mins / 60);
  const rm = mins % 60;
  return rm ? `${hrs} 小时 ${rm} 分` : `${hrs} 小时`;
}

function describeGoal(goal) {
  if (!goal) return '无目标';
  const period = goal.period === 'day' ? '每天' : '每周';
  const type = goal.type === 'min' ? '至少' : '最多';
  return `${period}${type} ${goal.hours} 小时`;
}
