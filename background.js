// 初始化或获取当前状态
async function initSession() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length > 0) {
      const tab = tabs[0];
      const url = tab.url;
      const now = Date.now();

      // 将初始状态存入 storage，防止 Service Worker 休眠丢失
      chrome.storage.local.set({
        activeUrl: url,
        lastCheckTime: now
      });
    }
  } catch (e) {
    console.error('[FocusCopilot] 初始化失败:', e);
  }
}

// 插件安装或启动时初始化
chrome.runtime.onInstalled.addListener(() => {
  initSession();
});
initSession();

// 1. 保存当前网站已停留的时间（基于 storage 中的时间戳计算，完美抗 Service Worker 休眠）
function saveCurrentSession() {
  chrome.storage.local.get(['activeUrl', 'lastCheckTime'], (data) => {
    const activeUrl = data.activeUrl;
    const lastCheckTime = data.lastCheckTime;

    if (!activeUrl || !lastCheckTime) return;

    const now = Date.now();
    const duration = Math.floor((now - lastCheckTime) / 1000); // 计算精准秒数差

    // 更新上一次检查时间戳，防止重复计算
    chrome.storage.local.set({ lastCheckTime: now });

    if (duration < 1) return;

    try {
      const urlObj = new URL(activeUrl);
      const domain = urlObj.hostname;

      // 过滤无效域名和浏览器内部页面
      if (!domain || domain.startsWith('edge://') || domain.startsWith('chrome://') || domain.startsWith('about:')) {
        return;
      }

      // 获取当前日期和小时
      const dateObj = new Date();
      const dateKey = dateObj.toISOString().split('T')[0]; // 例如 "2026-10-24"
      const hourKey = dateObj.getHours().toString();        // 例如 "17"

      // 读取并累加历史记录
      chrome.storage.local.get(['history'], (result) => {
        const history = result.history || {};

        if (!history[dateKey]) history[dateKey] = { hours: {} };
        if (!history[dateKey].hours) history[dateKey].hours = {};
        if (!history[dateKey].hours[hourKey]) history[dateKey].hours[hourKey] = {};

        const currentDomainTime = history[dateKey].hours[hourKey][domain] || 0;
        history[dateKey].hours[hourKey][domain] = currentDomainTime + duration;

        chrome.storage.local.set({ history }, () => {
          console.log(`[FocusCopilot] 存档成功 [${dateKey} ${hourKey}点]: ${domain} +${duration}s`);
        });
      });
    } catch (e) {
      // 忽略无效 URL
    }
  });
}

// 2. 设置定时器：每隔 1 分钟自动触发一次存档
chrome.alarms.get('autoSaveAlarm', (alarm) => {
  if (!alarm) {
    chrome.alarms.create('autoSaveAlarm', { periodInMinutes: 1 });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'autoSaveAlarm') {
    saveCurrentSession();
  }
});

// 3. 切换标签页时触发
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  saveCurrentSession(); // 先保存上一个标签页的时间
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    chrome.storage.local.set({
      activeUrl: tab.url || null,
      lastCheckTime: Date.now()
    });
  } catch (e) {
    chrome.storage.local.set({ activeUrl: null, lastCheckTime: Date.now() });
  }
});

// 4. 标签页网址更新时触发
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) {
    saveCurrentSession();
    chrome.storage.local.set({
      activeUrl: changeInfo.url,
      lastCheckTime: Date.now()
    });
  }
});

// 5. 浏览器窗口焦点改变时触发
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    saveCurrentSession();
    chrome.storage.local.set({ activeUrl: null, lastCheckTime: Date.now() });
  } else {
    saveCurrentSession();
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
      if (tabs.length > 0) {
        chrome.storage.local.set({
          activeUrl: tabs[0].url,
          lastCheckTime: Date.now()
        });
      }
    } catch (e) {
      chrome.storage.local.set({ activeUrl: null, lastCheckTime: Date.now() });
    }
  }
});