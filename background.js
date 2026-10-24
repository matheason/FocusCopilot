let activeTabId = null;
let activeUrl = null;
let startTime = Date.now();

// 1. 保存当前网站已停留的时间
function saveCurrentSession() {
  if (!activeUrl) return;
  const duration = Math.floor((Date.now() - startTime) / 1000); // 转换为秒
  if (duration < 1) return;

  try {
    const urlObj = new URL(activeUrl);
    const domain = urlObj.hostname; // 获取域名，例如 github.com
    if (!domain || domain.startsWith('edge://') || domain.startsWith('chrome://')) return;

    chrome.storage.local.get([domain], (result) => {
      const totalTime = (result[domain] || 0) + duration;
      chrome.storage.local.set({ [domain]: totalTime }, () => {
        console.log(`[FocusCopilot] 记录: ${domain} +${duration}s (累计: ${totalTime}s)`);
      });
    });
  } catch (e) {
    // 忽略无效的 URL（如 chrome:// 内部页面）
  }
}

// 2. 切换标签页时触发
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  saveCurrentSession();
  
  activeTabId = activeInfo.tabId;
  startTime = Date.now();
  
  try {
    const tab = await chrome.tabs.get(activeTabId);
    activeUrl = tab.url;
  } catch (e) {
    activeUrl = null;
  }
});

// 3. 标签页更新（比如在当前标签页输入新网址或跳转）
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === activeTabId && changeInfo.url) {
    saveCurrentSession();
    activeUrl = changeInfo.url;
    startTime = Date.now();
  }
});

// 4. 浏览器窗口焦点改变（比如最小化浏览器或切换到其他软件）
chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // 用户切出浏览器
    saveCurrentSession();
    activeUrl = null;
  } else {
    // 用户切回浏览器
    startTime = Date.now();
    try {
      const tabs = await chrome.tabs.query({ active: true, windowId: windowId });
      if (tabs.length > 0) {
        activeTabId = tabs[0].id;
        activeUrl = tabs[0].url;
      }
    } catch (e) {
      activeUrl = null;
    }
  }
});