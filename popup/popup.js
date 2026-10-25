document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('stats-list');
  const totalTimeEl = document.getElementById('total-time');
  const siteCountEl = document.getElementById('site-count');
  const clearBtn = document.getElementById('clear-btn');
  const openDashBtn = document.getElementById('open-dashboard-btn');

  // 将秒数转化为易读格式
  function formatTime(seconds) {
    if (seconds < 60) return `${seconds} 秒`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (mins < 60) {
      return secs > 0 ? `${mins} 分 ${secs} 秒` : `${mins} 分钟`;
    }
    const hrs = Math.floor(mins / 60);
    const remainMins = mins % 60;
    return `${hrs} 小时 ${remainMins} 分`;
  }

  // 从 history 结构中计算出指定日期（默认今天）的域名汇总
  function getDailyAggregate(history, dateKey) {
    const dayData = history[dateKey]?.hours || {};
    const domainTotals = {};

    Object.keys(dayData).forEach((hour) => {
      const hourData = dayData[hour];
      Object.keys(hourData).forEach((domain) => {
        domainTotals[domain] = (domainTotals[domain] || 0) + hourData[domain];
      });
    });

    return domainTotals;
  }

  // 加载并渲染今日数据
  function loadStats() {
    chrome.storage.local.get(['history'], (result) => {
      listEl.innerHTML = '';
      const history = result.history || {};
      const todayKey = new Date().toISOString().split('T')[0]; // 例如 "2026-10-24"

      const todayDomainTotals = getDailyAggregate(history, todayKey);
      const domains = Object.keys(todayDomainTotals);

      if (domains.length === 0) {
        listEl.innerHTML = '<li class="empty-tip">今日暂无浏览数据</li>';
        totalTimeEl.textContent = '0 秒';
        siteCountEl.textContent = '0 个站点';
        return;
      }

      // 按时长降序排列
      domains.sort((a, b) => todayDomainTotals[b] - todayDomainTotals[a]);

      let grandTotalSeconds = 0;

      domains.forEach((domain) => {
        const seconds = todayDomainTotals[domain];
        grandTotalSeconds += seconds;

        const li = document.createElement('li');
        li.innerHTML = `
          <div class="domain-info">
            <span class="domain-name" title="${domain}">${domain}</span>
          </div>
          <span class="time-badge">${formatTime(seconds)}</span>
        `;
        listEl.appendChild(li);
      });

      totalTimeEl.textContent = formatTime(grandTotalSeconds);
      siteCountEl.textContent = `${domains.length} 个站点`;
    });
  }

  // 清空所有历史数据
  clearBtn.addEventListener('click', () => {
    if (confirm('确定要清空所有的历史浏览记录吗？')) {
      chrome.storage.local.clear(() => {
        loadStats();
      });
    }
  });

  // 打开完整 Dashboard 看板
  if (openDashBtn) {
    openDashBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('dashboard/dashboard.html') });
    });
  }

  // 打开分类管理页面
  const classificationBtn = document.getElementById('classification-btn');
  if (classificationBtn) {
    classificationBtn.addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('popup/classification.html') });
    });
  }

  loadStats();
});
