let myChart = null;

document.addEventListener('DOMContentLoaded', () => {
    const totalTimeEl = document.getElementById('total-time');
    const totalSitesEl = document.getElementById('total-sites');
    const topSiteEl = document.getElementById('top-site');
    const tableBodyEl = document.getElementById('table-body');
    const refreshBtn = document.getElementById('refresh-btn');
    const clearBtn = document.getElementById('clear-btn');

    function formatTime(seconds) {
        if (seconds < 60) return `${seconds} 秒`;
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        if (mins < 60) return `${mins}分 ${secs}秒`;
        const hrs = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hrs}小时 ${remainMins}分`;
    }

    // 从 history 提取当天的域名数据
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

    // 读取并渲染数据
    function loadDashboardData() {
        chrome.storage.local.get(['history'], (result) => {
            const history = result.history || {};
            const todayKey = new Date().toISOString().split('T')[0];
            const todayTotals = getDailyAggregate(history, todayKey);
            const domains = Object.keys(todayTotals);

            if (domains.length === 0) {
                totalTimeEl.textContent = '0 秒';
                totalSitesEl.textContent = '0';
                topSiteEl.textContent = '-';
                tableBodyEl.innerHTML = '<tr><td colspan="3" class="empty-cell">今日暂无浏览数据</td></tr>';
                if (myChart) myChart.destroy();
                return;
            }

            // 降序排列
            domains.sort((a, b) => todayTotals[b] - todayTotals[a]);

            let grandTotalSeconds = 0;
            domains.forEach(d => grandTotalSeconds += todayTotals[d]);

            // 更新顶部统计卡片
            totalTimeEl.textContent = formatTime(grandTotalSeconds);
            totalSitesEl.textContent = domains.length;
            topSiteEl.textContent = domains[0];

            // 渲染数据表格
            tableBodyEl.innerHTML = '';
            domains.forEach((domain) => {
                const seconds = todayTotals[domain];
                const percentage = ((seconds / grandTotalSeconds) * 100).toFixed(1);

                const tr = document.createElement('tr');
                tr.innerHTML = `
          <td><strong>${domain}</strong></td>
          <td>${formatTime(seconds)}</td>
          <td style="width: 120px;">
            ${percentage}%
            <div class="progress-bar-bg">
              <div class="progress-bar-fill" style="width: ${percentage}%;"></div>
            </div>
          </td>
        `;
                tableBodyEl.appendChild(tr);
            });

            // 渲染图表
            renderChart(domains, todayTotals);
        });
    }

    // 渲染环形图
    function renderChart(domains, totals) {
        const ctx = document.getElementById('timeChart').getContext('2d');

        const topDomains = domains.slice(0, 5);
        const labels = [...topDomains];
        const data = topDomains.map(d => totals[d]);

        if (domains.length > 5) {
            let otherTotal = 0;
            for (let i = 5; i < domains.length; i++) {
                otherTotal += totals[domains[i]];
            }
            labels.push('其他');
            data.push(otherTotal);
        }

        if (myChart) myChart.destroy();

        myChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: [
                        '#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#94a3b8'
                    ],
                    borderWidth: 2,
                    borderColor: '#ffffff'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' }
                }
            }
        });
    }

    refreshBtn.addEventListener('click', loadDashboardData);
    clearBtn.addEventListener('click', () => {
        if (confirm('确定要清空所有的历史浏览记录吗？')) {
            chrome.storage.local.clear(() => {
                loadDashboardData();
            });
        }
    });

    loadDashboardData();
});