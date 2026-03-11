// ─── Toast System ───
function showToast(message, type = 'success') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ─── API Helper ───
async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Time Helpers ───
function timeAgo(dateStr) {
  if (!dateStr) return 'Never';
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function badgeHtml(status) {
  const labels = { up: 'UP', down: 'DOWN', unknown: '—' };
  return `<span class="badge badge-${status}">${labels[status] || status}</span>`;
}

// ─── Dashboard ───
async function loadDashboard() {
  try {
    const data = await api('/dashboard/summary');

    const statTotal = document.getElementById('stat-total');
    const statUp = document.getElementById('stat-up');
    const statDown = document.getElementById('stat-down');
    const statUnknown = document.getElementById('stat-unknown');

    if (statTotal) statTotal.textContent = data.total;
    if (statUp) statUp.textContent = data.totalUp;
    if (statDown) statDown.textContent = data.totalDown;
    if (statUnknown) statUnknown.textContent = data.totalUnknown;

    const grid = document.getElementById('endpoints-grid');
    if (grid) {
      if (!data.endpoints.length) {
        grid.innerHTML = '<p class="text-muted">No endpoints configured. <a href="/endpoints">Add one</a></p>';
      } else {
        grid.innerHTML = data.endpoints.map(ep => `
          <div class="endpoint-card status-${ep.last_status}">
            <div class="endpoint-card-header">
              <span class="endpoint-card-name">${esc(ep.name)}</span>
              ${badgeHtml(ep.last_status)}
            </div>
            <div class="endpoint-card-url">${esc(ep.url)}</div>
            <div class="endpoint-card-stats">
              <span>${ep.method}</span>
              <span>${ep.last_latency || 0}ms</span>
              <span>${timeAgo(ep.last_check_at)}</span>
              <span>${esc(ep.cron_expr)}</span>
            </div>
          </div>
        `).join('');
      }
    }

    const logsBody = document.getElementById('recent-logs');
    if (logsBody) {
      if (!data.recentLogs.length) {
        logsBody.innerHTML = '<tr><td colspan="5" class="text-muted">No recent activity</td></tr>';
      } else {
        logsBody.innerHTML = data.recentLogs.map(log => `
          <tr>
            <td>${esc(log.endpoint_name || '—')}</td>
            <td>${badgeHtml(log.status)}</td>
            <td>${log.status_code || '—'}</td>
            <td>${log.latency_ms}ms</td>
            <td>${timeAgo(log.checked_at)}</td>
          </tr>
        `).join('');
      }
    }
  } catch (err) {
    console.error('Dashboard load error:', err);
  }
}

// ─── Endpoints ───
async function loadEndpoints() {
  try {
    const endpoints = await api('/endpoints');
    const tbody = document.getElementById('endpoints-table');
    if (!tbody) return;

    if (!endpoints.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="text-muted">No endpoints yet</td></tr>';
      return;
    }

    tbody.innerHTML = endpoints.map(ep => `
      <tr>
        <td><strong>${esc(ep.name)}</strong></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(ep.url)}">${esc(ep.url)}</td>
        <td>${ep.method}</td>
        <td><code>${esc(ep.cron_expr)}</code></td>
        <td>${badgeHtml(ep.last_status)}</td>
        <td>${ep.last_latency || 0}ms</td>
        <td>${ep.is_active ? '✅' : '⏸️'}</td>
        <td class="actions-cell">
          <button class="btn btn-sm btn-ghost" onclick="manualCheck(${ep.id})" title="Check now">▶</button>
          <button class="btn btn-sm btn-ghost" onclick="editEndpoint(${ep.id})" title="Edit">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="deleteEndpoint(${ep.id}, '${esc(ep.name)}')" title="Delete">🗑</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error('Endpoints load error:', err);
  }
}

function openEndpointModal(data = null) {
  const modal = document.getElementById('endpoint-modal');
  const title = document.getElementById('modal-title');

  document.getElementById('ep-id').value = data?.id || '';
  document.getElementById('ep-name').value = data?.name || '';
  document.getElementById('ep-url').value = data?.url || '';
  document.getElementById('ep-method').value = data?.method || 'GET';
  document.getElementById('ep-code').value = data?.expected_code || 200;
  document.getElementById('ep-timeout').value = data?.timeout_sec || 10;
  document.getElementById('ep-cron').value = data?.cron_expr || '*/5 * * * *';
  document.getElementById('ep-body').value = data?.post_body || '';
  document.getElementById('ep-headers').value = data?.headers || '{}';
  document.getElementById('ep-active').checked = data ? !!data.is_active : true;

  title.textContent = data ? 'Edit Endpoint' : 'New Endpoint';
  modal.style.display = 'flex';
  updateCronUI();
}

function closeEndpointModal() {
  document.getElementById('endpoint-modal').style.display = 'none';
}

async function saveEndpoint(e) {
  e.preventDefault();
  const id = document.getElementById('ep-id').value;
  const body = {
    name: document.getElementById('ep-name').value,
    url: document.getElementById('ep-url').value,
    method: document.getElementById('ep-method').value,
    expected_code: parseInt(document.getElementById('ep-code').value),
    timeout_sec: parseInt(document.getElementById('ep-timeout').value),
    cron_expr: document.getElementById('ep-cron').value,
    post_body: document.getElementById('ep-body').value,
    headers: document.getElementById('ep-headers').value,
    is_active: document.getElementById('ep-active').checked,
  };

  try {
    if (id) {
      await api(`/endpoints/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      showToast('Endpoint updated');
    } else {
      await api('/endpoints', { method: 'POST', body: JSON.stringify(body) });
      showToast('Endpoint created');
    }
    closeEndpointModal();
    loadEndpoints();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function editEndpoint(id) {
  try {
    const endpoints = await api('/endpoints');
    const ep = endpoints.find(e => e.id === id);
    if (ep) openEndpointModal(ep);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function deleteEndpoint(id, name) {
  if (!confirm(`Delete endpoint "${name}"?`)) return;
  try {
    await api(`/endpoints/${id}`, { method: 'DELETE' });
    showToast('Endpoint deleted');
    loadEndpoints();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function manualCheck(id) {
  try {
    showToast('Checking...', 'success');
    await api(`/endpoints/${id}/check`, { method: 'POST' });
    showToast('Check complete');
    loadEndpoints();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Logs ───
let currentLogPage = 1;

async function loadLogFilters() {
  try {
    const endpoints = await api('/endpoints');
    const select = document.getElementById('log-filter-endpoint');
    if (!select) return;
    endpoints.forEach(ep => {
      const opt = document.createElement('option');
      opt.value = ep.id;
      opt.textContent = ep.name;
      select.appendChild(opt);
    });
  } catch {}
}

async function loadLogs(page = 1) {
  currentLogPage = page;
  try {
    const endpointId = document.getElementById('log-filter-endpoint')?.value || '';
    const status = document.getElementById('log-filter-status')?.value || '';

    let url = `/logs?page=${page}&limit=50`;
    if (endpointId) url += `&endpoint_id=${endpointId}`;
    if (status) url += `&status=${status}`;

    const data = await api(url);
    const tbody = document.getElementById('logs-table');
    if (!tbody) return;

    if (!data.logs.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-muted">No logs found</td></tr>';
    } else {
      tbody.innerHTML = data.logs.map(log => `
        <tr>
          <td>${esc(log.endpoint_name || '—')}</td>
          <td>${badgeHtml(log.status)}</td>
          <td>${log.status_code || '—'}</td>
          <td>${log.latency_ms}ms</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis" title="${esc(log.error_msg || '')}">${esc(log.error_msg || '—')}</td>
          <td>${timeAgo(log.checked_at)}</td>
        </tr>
      `).join('');
    }

    // Pagination
    const totalPages = Math.ceil(data.total / data.limit);
    const pagination = document.getElementById('logs-pagination');
    if (pagination && totalPages > 1) {
      let html = '';
      for (let i = 1; i <= Math.min(totalPages, 10); i++) {
        html += `<button class="${i === page ? 'active' : ''}" onclick="loadLogs(${i})">${i}</button>`;
      }
      pagination.innerHTML = html;
    } else if (pagination) {
      pagination.innerHTML = '';
    }
  } catch (err) {
    console.error('Logs load error:', err);
  }
}

// ─── Settings ───
async function loadSettings() {
  try {
    const configs = await api('/settings');
    configs.forEach(cfg => {
      if (cfg.channel === 'discord') {
        document.getElementById('discord-enabled').checked = !!cfg.enabled;
        document.getElementById('discord-webhook').value = cfg.webhook_url || '';
        document.getElementById('discord-notify-down').checked = !!cfg.notify_on_down;
        document.getElementById('discord-notify-up').checked = !!cfg.notify_on_up;
      } else if (cfg.channel === 'telegram') {
        document.getElementById('telegram-enabled').checked = !!cfg.enabled;
        document.getElementById('telegram-token').value = cfg.bot_token || '';
        document.getElementById('telegram-chatid').value = cfg.chat_id || '';
        document.getElementById('telegram-notify-down').checked = !!cfg.notify_on_down;
        document.getElementById('telegram-notify-up').checked = !!cfg.notify_on_up;
      }
    });
  } catch (err) {
    console.error('Settings load error:', err);
  }
}

async function saveSettings(e, channel) {
  e.preventDefault();
  let body;

  if (channel === 'discord') {
    body = {
      enabled: document.getElementById('discord-enabled').checked,
      webhook_url: document.getElementById('discord-webhook').value,
      notify_on_down: document.getElementById('discord-notify-down').checked,
      notify_on_up: document.getElementById('discord-notify-up').checked,
    };
  } else {
    body = {
      enabled: document.getElementById('telegram-enabled').checked,
      bot_token: document.getElementById('telegram-token').value,
      chat_id: document.getElementById('telegram-chatid').value,
      notify_on_down: document.getElementById('telegram-notify-down').checked,
      notify_on_up: document.getElementById('telegram-notify-up').checked,
    };
  }

  try {
    await api(`/settings/${channel}`, { method: 'PUT', body: JSON.stringify(body) });
    showToast(`${channel} settings saved`);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function testNotification(channel) {
  try {
    showToast('Sending test...', 'success');
    await api(`/settings/${channel}/test`, { method: 'POST' });
    showToast('Test notification sent!');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Cron Presets ───
const cronDescriptions = {
  '*/1 * * * *': 'Every minute',
  '*/5 * * * *': 'Every 5 minutes',
  '*/10 * * * *': 'Every 10 minutes',
  '*/15 * * * *': 'Every 15 minutes',
  '*/30 * * * *': 'Every 30 minutes',
  '0 * * * *': 'Every hour',
  '0 */2 * * *': 'Every 2 hours',
  '0 */6 * * *': 'Every 6 hours',
  '0 */12 * * *': 'Every 12 hours',
  '0 0 * * *': 'Daily at midnight',
  '0 0 * * 0': 'Weekly on Sunday',
};

function describeCron(expr) {
  if (cronDescriptions[expr]) return cronDescriptions[expr];
  const parts = expr.split(' ');
  if (parts.length !== 5) return 'Custom schedule';
  const [min, hour, dom, mon, dow] = parts;
  if (min.startsWith('*/') && hour === '*') return `Every ${min.slice(2)} minutes`;
  if (min === '0' && hour.startsWith('*/')) return `Every ${hour.slice(2)} hours`;
  if (min === '0' && hour === '0' && dom === '*') return 'Daily at midnight';
  return 'Custom schedule';
}

function updateCronUI() {
  const input = document.getElementById('ep-cron');
  const desc = document.getElementById('cron-description');
  if (!input || !desc) return;
  desc.textContent = describeCron(input.value.trim());
  document.querySelectorAll('.cron-preset').forEach(btn => {
    btn.classList.toggle('selected', btn.dataset.cron === input.value.trim());
  });
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('cron-preset')) {
    const input = document.getElementById('ep-cron');
    if (input) {
      input.value = e.target.dataset.cron;
      updateCronUI();
    }
  }
});

document.addEventListener('input', (e) => {
  if (e.target.id === 'ep-cron') updateCronUI();
});

// ─── Utility ───
function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.style.display = 'none';
  }
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
  }
});
