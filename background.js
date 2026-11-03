// FocusCopilot 计时核心
//
// 设计思路：不再依赖"事件 → 改状态"的增量逻辑（容易丢事件、竞态、Service Worker 重启后状态错乱），
// 而是每次触发（任何事件或每分钟的心跳）都执行一次 tick()：
//   1. 把「上次 tick → 现在」这段时间记到上次正在看的页面上；
//   2. 重新从浏览器读取真实状态（哪个窗口有焦点、哪个标签页激活、用户是否闲置），决定接下来记给谁。
// 所有 tick 串行执行，避免并发读写 storage 导致时间被覆盖或丢失。

const ALARM_NAME = 'focusTick';
const TICK_MINUTES = 0.5;            // 心跳间隔（Chrome/Edge 120+ 支持 30 秒）
const IDLE_SECONDS = 300;            // 5 分钟无键鼠操作视为离开（读 PDF 时留足时间）
const MAX_GAP_MS = 3 * 60 * 1000;    // 两次 tick 间隔超过此值视为浏览器关闭/电脑休眠，丢弃这段时间

chrome.idle.setDetectionInterval(IDLE_SECONDS);

// ---------- 工具函数 ----------

// 本地日期 key（原来用 toISOString 是 UTC，在中国早上 8 点前的数据会记到前一天）
function localDateKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function fileNameFromPath(path) {
  const name = decodeURIComponent(path).split(/[\\/]/).filter(Boolean).pop();
  return name || 'Local File';
}

// 把 URL 转成统计用的 key；返回 null 表示不统计
function urlToKey(url) {
  if (!url) return null;
  let u;
  try {
    u = new URL(url);
  } catch (e) {
    return null;
  }

  switch (u.protocol) {
    case 'http:':
    case 'https:': {
      // 本地开发服务器保留端口，便于区分不同项目
      const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      return isLocal ? u.host : u.hostname;
    }
    case 'file:':
      // 本地 PDF / HTML / 图片等，按文件名统计
      return `file: ${fileNameFromPath(u.pathname)}`;
    case 'chrome-extension:':
    case 'extension:': {
      // 第三方 PDF 阅读器插件（如 PDF.js）通常形如 .../viewer.html?file=<真实地址>
      const inner = u.searchParams.get('file') || u.searchParams.get('src');
      if (inner) return urlToKey(inner);
      return null; // 其它插件页面（包括本插件的看板）不统计
    }
    default:
      // chrome://, edge://, about:, devtools:// 等浏览器内部页面不统计
      return null;
  }
}

function addSeconds(history, dateKey, hourKey, key, seconds) {
  if (seconds <= 0) return;
  const day = (history[dateKey] = history[dateKey] || {});
  const hours = (day.hours = day.hours || {});
  const hour = (hours[hourKey] = hours[hourKey] || {});
  hour[key] = (hour[key] || 0) + seconds;
}

// 把 [startMs, endMs) 这段时间记到 key 上，跨小时/跨天时按边界拆分
function creditTime(history, key, startMs, endMs) {
  let t = startMs;
  while (t < endMs) {
    const d = new Date(t);
    const nextHour = new Date(d);
    nextHour.setMinutes(0, 0, 0);
    nextHour.setHours(nextHour.getHours() + 1);
    const chunkEnd = Math.min(endMs, nextHour.getTime());
    const seconds = Math.round((chunkEnd - t) / 1000);
    addSeconds(history, localDateKey(d), String(d.getHours()), key, seconds);
    t = chunkEnd;
  }
}

// 读取浏览器当前真实状态，返回当前应该计时的 key（null 表示不计时）
async function detectCurrentKey() {
  let win;
  try {
    win = await chrome.windows.getLastFocused({ populate: true, windowTypes: ['normal', 'popup'] });
  } catch (e) {
    return null;
  }
  // 浏览器窗口没有焦点（用户切到别的软件了）
  if (!win || !win.focused || win.state === 'minimized') return null;

  const tab = (win.tabs || []).find((t) => t.active);
  if (!tab) return null;

  const idleState = await chrome.idle.queryState(IDLE_SECONDS);
  // 闲置/锁屏时，只有正在播放声音（看网课/视频）才继续计时
  if (idleState !== 'active' && !tab.audible) return null;
  if (idleState === 'locked') return null;

  return urlToKey(tab.pendingUrl || tab.url);
}

// ---------- 核心 tick（串行执行） ----------

let queue = Promise.resolve();

function tick(reason) {
  queue = queue.then(() => doTick(reason)).catch((e) => {
    console.error('[FocusCopilot] tick 失败:', e);
  });
  return queue;
}

async function doTick(reason) {
  const now = Date.now();
  const { tracker, history = {} } = await chrome.storage.local.get(['tracker', 'history']);

  let changedHistory = false;
  if (tracker && tracker.key && tracker.since) {
    const gap = now - tracker.since;
    if (gap > 0 && gap <= MAX_GAP_MS) {
      creditTime(history, tracker.key, tracker.since, now);
      changedHistory = true;
    } else if (gap > MAX_GAP_MS) {
      console.log(`[FocusCopilot] 间隔 ${Math.round(gap / 1000)}s 过长（休眠/关闭浏览器），已丢弃`);
    }
  }

  const key = await detectCurrentKey();
  const toSave = { tracker: { key, since: now } };
  if (changedHistory) toSave.history = history;
  await chrome.storage.local.set(toSave);

  if (!tracker || tracker.key !== key) {
    console.log(`[FocusCopilot] (${reason}) 计时对象: ${tracker?.key ?? '无'} → ${key ?? '无'}`);
  }
}

// ---------- 事件监听：所有事件都只是触发一次 tick ----------

function ensureAlarm() {
  chrome.alarms.get(ALARM_NAME, (alarm) => {
    if (!alarm) chrome.alarms.create(ALARM_NAME, { periodInMinutes: TICK_MINUTES });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm();
  // 清理旧版本遗留的状态字段
  chrome.storage.local.remove(['activeUrl', 'lastCheckTime']);
  chrome.alarms.clear('autoSaveAlarm');
  tick('installed');
});
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm();
  tick('startup');
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) tick('alarm');
});

chrome.tabs.onActivated.addListener(() => tick('tab-activated'));
chrome.tabs.onRemoved.addListener(() => tick('tab-removed'));
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && (changeInfo.url || 'audible' in changeInfo || changeInfo.status === 'complete')) {
    tick('tab-updated');
  }
});
chrome.windows.onFocusChanged.addListener(() => tick('focus-changed'));
chrome.idle.onStateChanged.addListener((state) => tick(`idle-${state}`));

// popup / 看板打开时先结算一次，确保显示的数据包含当前正在进行的这段时间
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'flush') {
    tick('flush').then(() => sendResponse({ ok: true }));
    return true;
  }
});

// Service Worker 每次被唤醒都会执行到这里：只确保心跳存在，不重置计时起点
ensureAlarm();
