document.addEventListener('DOMContentLoaded', () => {
  const listEl = document.getElementById('stats-list');

  // 从 chrome.storage.local 获取所有统计数据
  chrome.storage.local.get(null, (items) => {
    listEl.innerHTML = '';
    const keys = Object.keys(items);

    if (keys.length === 0) {
      listEl.innerHTML = '<li style="justify-content:center; color:#999;">暂无浏览数据</li>';
      return;
    }

    // 按停留时间降序排序
    keys.sort((a, b) => items[b] - items[a]);

    keys.forEach((domain) => {
      const seconds = items[domain];
      const minutes = (seconds / 60).toFixed(1); // 转换为分钟
      
      const li = document.createElement('li');
      li.innerHTML = `
        <span class="domain" title="${domain}">${domain}</span>
        <span class="time">${seconds}秒 (${minutes}分钟)</span>
      `;
      listEl.appendChild(li);
    });
  });
});