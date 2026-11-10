// 依赖 ../shared/categories.js 提供的全局函数

// 先让后台结算当前正在计时的这段时间，再读数据
function flushThen(fn) {
  try {
    chrome.runtime.sendMessage({ type: 'flush' }, () => {
      void chrome.runtime.lastError;
      fn();
    });
  } catch (e) {
    fn();
  }
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'style') node.style.cssText = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function categoryTag(cat) {
  return el('span', { className: 'cat-tag', style: `--c:${cat.color}` }, cat.name);
}

const WEEKDAY_NAMES = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

let todayChart = null;
let weekChart = null;
let state = { history: {}, cfg: null, weekOffset: 0 };

document.addEventListener('DOMContentLoaded', () => {
  // ---------- Tab 切换 ----------
  const tabs = document.querySelectorAll('.tab');
  function showTab(name) {
    if (!document.getElementById(`tab-${name}`)) name = 'today';
    tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${name}`));
    if (location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
    renderAll();
  }
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ---------- 数据加载 ----------
  function reload() {
    flushThen(async () => {
      const [r, cfg] = await Promise.all([
        new Promise((res) => chrome.storage.local.get(['history'], res)),
        loadCategoryConfig(),
      ]);
      state.history = r.history || {};
      state.cfg = cfg;
      showTab(location.hash.slice(1) || 'today');
    });
  }

  async function saveCfg() {
    await saveCategoryConfig(state.cfg);
    renderAll();
  }

  function renderAll() {
    if (!state.cfg) return;
    const active = document.querySelector('.tab.active')?.dataset.tab;
    if (active === 'today') renderToday();
    if (active === 'week') renderWeek();
    if (active === 'settings') renderSettings();
  }

  // ================= 今日概览 =================
  function renderToday() {
    const { history, cfg } = state;
    const totals = dailySiteTotals(history, localDateKey(new Date()));
    const domains = Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
    const tbody = document.getElementById('table-body');

    if (domains.length === 0) {
      document.getElementById('total-time').textContent = '0 秒';
      document.getElementById('total-sites').textContent = '0';
      document.getElementById('top-site').textContent = '-';
      tbody.replaceChildren(el('tr', {}, el('td', { colSpan: 4, className: 'empty-cell' }, '今日暂无浏览数据')));
      if (todayChart) { todayChart.destroy(); todayChart = null; }
      return;
    }

    const grand = domains.reduce((s, d) => s + totals[d], 0);
    document.getElementById('total-time').textContent = formatDuration(grand);
    document.getElementById('total-sites').textContent = domains.length;
    document.getElementById('top-site').textContent = domains[0];

    tbody.replaceChildren(...domains.map((domain) => {
      const pct = ((totals[domain] / grand) * 100).toFixed(1);
      const cat = categoryById(cfg, categoryIdOf(domain, cfg));
      return el('tr', {}, [
        el('td', {}, el('strong', {}, domain)),
        el('td', {}, categoryTag(cat)),
        el('td', {}, formatDuration(totals[domain])),
        el('td', { style: 'width:120px' }, [
          `${pct}%`,
          el('div', { className: 'progress-bar-bg' },
            el('div', { className: 'progress-bar-fill', style: `width:${pct}%` })),
        ]),
      ]);
    }));

    if (typeof Chart === 'undefined') return;
    const top = domains.slice(0, 5);
    const labels = [...top];
    const data = top.map((d) => totals[d]);
    if (domains.length > 5) {
      labels.push('其他');
      data.push(domains.slice(5).reduce((s, d) => s + totals[d], 0));
    }
    if (todayChart) todayChart.destroy();
    todayChart = new Chart(document.getElementById('timeChart'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data,
          backgroundColor: ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#94a3b8'],
          borderWidth: 2,
          borderColor: '#ffffff',
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (c) => ` ${c.label}: ${formatDuration(c.raw)}` } },
        },
      },
    });
  }

  // ================= 每周分类 =================
  function renderWeek() {
    const { history, cfg } = state;
    const now = new Date();
    const todayKey = localDateKey(now);
    const start = weekStart(now);
    start.setDate(start.getDate() + state.weekOffset * 7);
    const days = weekDays(start);
    const dayKeys = days.map(localDateKey);
    const isCurrentWeek = state.weekOffset === 0;
    const weekOver = dayKeys[6] < todayKey;
    const weekFuture = dayKeys[0] > todayKey;

    document.getElementById('week-label').textContent =
      `${dayKeys[0]} ~ ${dayKeys[6]}${isCurrentWeek ? '（本周）' : ''}`;
    document.getElementById('next-week').disabled = state.weekOffset >= 0;
    document.getElementById('this-week').style.display = isCurrentWeek ? 'none' : '';

    const perDay = dayKeys.map((k) => dailyCategoryTotals(history, k, cfg));
    const weekTotals = {};
    perDay.forEach((t) => {
      for (const [id, sec] of Object.entries(t)) weekTotals[id] = (weekTotals[id] || 0) + sec;
    });
    const cats = allCategories(cfg);

    // ---- 目标卡片 ----
    const goalGrid = document.getElementById('goal-grid');
    const goalCats = cfg.categories.filter((c) => c.goal);
    if (goalCats.length === 0) {
      goalGrid.replaceChildren(el('div', { className: 'card empty-cell' },
        '还没有设置任何目标，去「⚙️ 分类与目标」里给分类设置一个吧'));
    } else {
      goalGrid.replaceChildren(...goalCats.map((cat) =>
        cat.goal.period === 'week'
          ? weeklyGoalCard(cat, weekTotals[cat.id] || 0, { isOver: weekOver, isFuture: weekFuture })
          : dailyGoalCard(cat, perDay, dayKeys, todayKey)));
    }

    // ---- 汇总表 ----
    const grand = Object.values(weekTotals).reduce((s, v) => s + v, 0);
    const tbody = document.getElementById('week-table-body');
    const rows = cats.filter((c) => weekTotals[c.id]).sort((a, b) => weekTotals[b.id] - weekTotals[a.id]);
    if (rows.length === 0) {
      tbody.replaceChildren(el('tr', {}, el('td', { colSpan: 3, className: 'empty-cell' }, '这周暂无浏览数据')));
    } else {
      tbody.replaceChildren(...rows.map((c) => {
        const pct = ((weekTotals[c.id] / grand) * 100).toFixed(1);
        return el('tr', {}, [
          el('td', {}, categoryTag(c)),
          el('td', {}, formatDuration(weekTotals[c.id])),
          el('td', { style: 'width:120px' }, [
            `${pct}%`,
            el('div', { className: 'progress-bar-bg' },
              el('div', { className: 'progress-bar-fill', style: `width:${pct}%;background:${c.color}` })),
          ]),
        ]);
      }), el('tr', { className: 'total-row' }, [
        el('td', {}, '合计'), el('td', {}, formatDuration(grand)), el('td', {}, '100%'),
      ]));
    }

    // ---- 堆叠柱状图 ----
    if (typeof Chart === 'undefined') return;
    if (weekChart) weekChart.destroy();
    weekChart = new Chart(document.getElementById('weekChart'), {
      type: 'bar',
      data: {
        labels: days.map((d, i) => `${WEEKDAY_NAMES[i]} ${d.getMonth() + 1}/${d.getDate()}`),
        datasets: cats.filter((c) => weekTotals[c.id]).map((c) => ({
          label: c.name,
          data: perDay.map((t) => +((t[c.id] || 0) / 3600).toFixed(2)),
          backgroundColor: c.color,
          borderRadius: 4,
        })),
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { stacked: true },
          y: { stacked: true, title: { display: true, text: '小时' } },
        },
        plugins: {
          legend: { position: 'bottom' },
          tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${formatDuration(c.raw * 3600)}` } },
        },
      },
    });
  }

  function statusText(goal, ev) {
    switch (ev.status) {
      case 'done': return '✅ 已达成';
      case 'fail': return goal.type === 'max' ? '⚠️ 已超出' : '❌ 未达成';
      case 'progress':
        return goal.type === 'min'
          ? `⏳ 还差 ${formatDuration(ev.target - ev.actual)}`
          : `🟢 还剩 ${formatDuration(ev.target - ev.actual)}`;
      default: return '—';
    }
  }

  function progressBar(cat, ev) {
    const pct = ev.target ? Math.min(100, (ev.actual / ev.target) * 100) : 0;
    return el('div', { className: 'goal-bar' },
      el('div', { className: `goal-bar-fill status-${ev.status}`, style: `width:${pct}%;--c:${cat.color}` }));
  }

  function weeklyGoalCard(cat, actual, opts) {
    const ev = evaluateGoal(cat.goal, actual, opts);
    return el('div', { className: 'card goal-card' }, [
      el('div', { className: 'goal-head' }, [categoryTag(cat), el('span', { className: 'goal-desc' }, describeGoal(cat.goal))]),
      el('div', { className: 'goal-numbers' }, [
        el('strong', {}, formatDuration(actual)), ` / ${cat.goal.hours} 小时`,
      ]),
      progressBar(cat, ev),
      el('div', { className: `goal-status status-${ev.status}` }, statusText(cat.goal, ev)),
    ]);
  }

  function dailyGoalCard(cat, perDay, dayKeys, todayKey) {
    const evs = dayKeys.map((k, i) => evaluateGoal(cat.goal, perDay[i][cat.id] || 0, {
      isOver: k < todayKey, isFuture: k > todayKey,
    }));
    const counted = evs.filter((e) => e.status !== 'future');
    const doneDays = evs.filter((e) => e.status === 'done').length;
    const todayIdx = dayKeys.indexOf(todayKey);
    // 本周看今天；以前的周看平均
    let focus;
    let focusLabel;
    if (todayIdx >= 0) {
      focus = evs[todayIdx];
      focusLabel = '今天';
    } else {
      const avg = counted.length ? counted.reduce((s, e) => s + e.actual, 0) / counted.length : 0;
      focus = evaluateGoal(cat.goal, avg, { isOver: true, isFuture: counted.length === 0 });
      focusLabel = '日均';
    }

    return el('div', { className: 'card goal-card' }, [
      el('div', { className: 'goal-head' }, [categoryTag(cat), el('span', { className: 'goal-desc' }, describeGoal(cat.goal))]),
      el('div', { className: 'goal-numbers' }, [
        `${focusLabel} `, el('strong', {}, formatDuration(focus.actual)), ` / ${cat.goal.hours} 小时`,
      ]),
      progressBar(cat, focus),
      el('div', { className: 'day-dots' }, evs.map((e, i) =>
        el('div', { className: `day-dot status-${e.status}`, title: `${dayKeys[i]}：${formatDuration(e.actual)}` }, [
          el('span', { className: 'dot' }, e.status === 'done' ? '✓' : e.status === 'fail' ? '✗' : ''),
          el('span', { className: 'dot-label' }, WEEKDAY_NAMES[i].slice(1)),
        ]))),
      el('div', { className: 'goal-status' }, [
        `本周达成 ${doneDays}/${counted.length} 天`,
        todayIdx >= 0 ? el('span', { className: `status-${focus.status}` }, ` · 今天 ${statusText(cat.goal, focus)}`) : null,
      ]),
    ]);
  }

  document.getElementById('prev-week').addEventListener('click', () => { state.weekOffset--; renderWeek(); });
  document.getElementById('next-week').addEventListener('click', () => {
    if (state.weekOffset < 0) state.weekOffset++;
    renderWeek();
  });
  document.getElementById('this-week').addEventListener('click', () => { state.weekOffset = 0; renderWeek(); });

  // ================= 分类与目标 =================
  const GOAL_OPTIONS = [
    ['', '无目标'],
    ['day:min', '每天至少'],
    ['day:max', '每天最多'],
    ['week:min', '每周至少'],
    ['week:max', '每周最多'],
  ];

  function categoryOptions(selectedId) {
    return allCategories(state.cfg).map((c) =>
      el('option', { value: c.id, selected: c.id === selectedId }, c.name));
  }

  function renderSettings() {
    renderCategoryList();
    document.getElementById('rule-category').replaceChildren(...categoryOptions(state.cfg.categories[0]?.id));
    renderSiteTable();
    renderRuleList();
  }

  function renderCategoryList() {
    const { cfg } = state;
    const list = document.getElementById('category-list');
    const ruleCount = {};
    Object.values(cfg.sites).forEach((id) => { ruleCount[id] = (ruleCount[id] || 0) + 1; });

    list.replaceChildren(...cfg.categories.map((cat) => {
      const color = el('input', { type: 'color', value: cat.color, className: 'color-input', title: '颜色' });
      color.addEventListener('change', () => { cat.color = color.value; saveCfg(); });

      const name = el('input', { type: 'text', value: cat.name, className: 'name-input', maxLength: 20 });
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (v) { cat.name = v; saveCfg(); } else name.value = cat.name;
      });

      const goalSel = el('select', {}, GOAL_OPTIONS.map(([v, t]) =>
        el('option', { value: v, selected: cat.goal ? `${cat.goal.period}:${cat.goal.type}` === v : v === '' }, t)));
      const hours = el('input', {
        type: 'number', min: 0.5, max: 168, step: 0.5, className: 'hours-input',
        value: cat.goal ? cat.goal.hours : 2, disabled: !cat.goal,
      });
      const applyGoal = () => {
        if (!goalSel.value) { cat.goal = null; } else {
          const [period, type] = goalSel.value.split(':');
          let h = parseFloat(hours.value);
          if (!(h > 0)) h = 1;
          h = Math.min(h, period === 'day' ? 24 : 168);
          hours.value = h;
          cat.goal = { period, type, hours: h };
        }
        hours.disabled = !cat.goal;
        saveCfg();
      };
      goalSel.addEventListener('change', applyGoal);
      hours.addEventListener('change', applyGoal);

      const del = el('button', { className: 'btn btn-danger btn-sm', title: '删除分类' }, '删除');
      del.addEventListener('click', () => {
        if (!confirm(`删除分类「${cat.name}」？属于它的 ${ruleCount[cat.id] || 0} 条网站规则也会一起删除，这些网站将变成未分类。`)) return;
        cfg.categories = cfg.categories.filter((c) => c !== cat);
        for (const [rule, id] of Object.entries(cfg.sites)) if (id === cat.id) delete cfg.sites[rule];
        saveCfg();
      });

      return el('div', { className: 'category-row' }, [
        color, name,
        el('span', { className: 'rule-count' }, `${ruleCount[cat.id] || 0} 个网站`),
        el('span', { className: 'goal-edit' }, [goalSel, hours, el('span', {}, '小时')]),
        del,
      ]);
    }));
  }

  document.getElementById('add-category').addEventListener('click', () => {
    const palette = ['#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6', '#f97316', '#84cc16'];
    const used = new Set(state.cfg.categories.map((c) => c.color));
    state.cfg.categories.push({
      id: newCategoryId(),
      name: `新分类 ${state.cfg.categories.length + 1}`,
      color: palette.find((c) => !used.has(c)) || palette[0],
      goal: null,
    });
    saveCfg().then(() => {
      const inputs = document.querySelectorAll('#category-list .name-input');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });
  });

  // 所有出现过的网站及累计时长
  function allSiteTotals() {
    const totals = {};
    for (const dateKey of Object.keys(state.history)) {
      for (const [site, sec] of Object.entries(dailySiteTotals(state.history, dateKey))) {
        totals[site] = (totals[site] || 0) + sec;
      }
    }
    return totals;
  }

  function setSiteCategory(site, id) {
    const { cfg } = state;
    const rule = normalizeSiteRule(site);
    delete cfg.sites[rule];
    delete cfg.sites[site];
    if (id === UNCATEGORIZED_ID) {
      // 如果还被上级域名规则匹配到，加一条例外规则
      if (categoryIdOf(site, cfg) !== UNCATEGORIZED_ID) cfg.sites[site] = UNCATEGORIZED_ID;
    } else if (categoryIdOf(site, cfg) !== id) {
      cfg.sites[rule] = id;
    }
    saveCfg();
  }

  function renderSiteTable() {
    const { cfg } = state;
    const totals = allSiteTotals();
    const q = document.getElementById('site-search').value.trim().toLowerCase();
    const onlyNone = document.getElementById('only-uncategorized').checked;
    const sites = Object.keys(totals)
      .filter((s) => !q || s.toLowerCase().includes(q))
      .filter((s) => !onlyNone || categoryIdOf(s, cfg) === UNCATEGORIZED_ID)
      .sort((a, b) => totals[b] - totals[a]);

    const tbody = document.getElementById('site-table-body');
    if (sites.length === 0) {
      tbody.replaceChildren(el('tr', {}, el('td', { colSpan: 4, className: 'empty-cell' }, '没有匹配的网站')));
      return;
    }
    tbody.replaceChildren(...sites.map((site) => {
      const id = categoryIdOf(site, cfg);
      const rule = matchSiteRule(site, cfg.sites);
      const sel = el('select', { className: 'cat-select', style: `--c:${categoryById(cfg, id).color}` }, categoryOptions(id));
      sel.addEventListener('change', () => setSiteCategory(site, sel.value));
      return el('tr', { className: id === UNCATEGORIZED_ID ? 'row-none' : '' }, [
        el('td', {}, el('strong', {}, site)),
        el('td', {}, formatDuration(totals[site])),
        el('td', { className: 'muted' }, rule || '—'),
        el('td', {}, sel),
      ]);
    }));
  }

  document.getElementById('site-search').addEventListener('input', renderSiteTable);
  document.getElementById('only-uncategorized').addEventListener('change', renderSiteTable);

  function renderRuleList() {
    const { cfg } = state;
    const rules = Object.keys(cfg.sites).sort();
    const list = document.getElementById('rule-list');
    if (rules.length === 0) {
      list.replaceChildren(el('div', { className: 'muted' }, '暂无规则'));
      return;
    }
    list.replaceChildren(...rules.map((rule) => {
      const x = el('button', { className: 'chip-x', title: '删除规则' }, '×');
      x.addEventListener('click', () => { delete cfg.sites[rule]; saveCfg(); });
      const cat = categoryById(cfg, cfg.sites[rule]);
      const label = cfg.sites[rule] === UNCATEGORIZED_ID ? '不归类' : cat.name;
      return el('span', { className: 'rule-chip', style: `--c:${cat.color}` }, [rule, el('em', {}, label), x]);
    }));
  }

  document.getElementById('rule-add-btn').addEventListener('click', () => {
    const input = document.getElementById('rule-input');
    const rule = normalizeSiteRule(input.value);
    if (!rule) { input.focus(); return; }
    state.cfg.sites[rule] = document.getElementById('rule-category').value;
    input.value = '';
    saveCfg();
  });
  document.getElementById('rule-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('rule-add-btn').click();
  });

  // ---------- 顶栏按钮 ----------
  document.getElementById('refresh-btn').addEventListener('click', reload);
  document.getElementById('clear-btn').addEventListener('click', () => {
    if (confirm('确定要清空所有的历史浏览记录吗？（分类和目标设置会保留）')) {
      chrome.storage.local.remove(['history', 'tracker'], reload);
    }
  });

  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

  reload();
});
