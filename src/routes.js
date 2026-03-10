import { Hono } from 'hono';
import { config } from './config.js';
import { getDb, saveDatabase } from './database.js';
import { createSession, authMiddleware, apiAuthMiddleware, COOKIE_NAME } from './auth.js';
import { reloadEndpoint, unregisterEndpoint, executeCheck } from './scheduler.js';
import { sendTestNotification } from './notifier.js';
import { CronJob } from 'cron';

function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function validateEndpointInput(body) {
  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    return 'Name is required';
  }
  if (!body.url || typeof body.url !== 'string') {
    return 'URL is required';
  }
  try {
    const u = new URL(body.url);
    if (!['http:', 'https:'].includes(u.protocol)) return 'URL must be http or https';
  } catch {
    return 'Invalid URL format';
  }
  if (body.cron_expr) {
    try {
      new CronJob(body.cron_expr, () => {});
    } catch {
      return 'Invalid cron expression';
    }
  }
  if (body.method && !['GET', 'POST', 'HEAD'].includes(body.method)) {
    return 'Method must be GET, POST, or HEAD';
  }
  return null;
}

function resultsToObjects(result) {
  if (!result) return [];
  const { columns, values } = result;
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

function queryAll(sql, params = []) {
  const db = getDb();
  if (params.length) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
  const results = db.exec(sql);
  return results.length ? resultsToObjects(results[0]) : [];
}

function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows[0] || null;
}

export function createRoutes() {
  const app = new Hono();

  // ─── Auth Routes ───
  app.post('/login', async (c) => {
    const body = await c.req.parseBody();
    const { username, password } = body;

    if (username === config.adminUser && password === config.adminPass) {
      const token = createSession(username);
      c.header('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
      return c.redirect('/');
    }
    return c.html(loginPage('Invalid credentials'));
  });

  app.get('/logout', (c) => {
    c.header('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
    return c.redirect('/login');
  });

  // ─── Login Page (public) ───
  app.get('/login', (c) => c.html(loginPage()));

  // ─── Protected Pages ───
  const pages = new Hono();
  pages.use('*', authMiddleware());

  pages.get('/', (c) => c.redirect('/dashboard'));
  pages.get('/dashboard', (c) => c.html(dashboardPage()));
  pages.get('/endpoints', (c) => c.html(endpointsPage()));
  pages.get('/logs', (c) => c.html(logsPage()));
  pages.get('/settings', (c) => c.html(settingsPage()));

  app.route('/', pages);

  // ─── API Routes ───
  const api = new Hono();
  api.use('*', apiAuthMiddleware());

  // Endpoints CRUD
  api.get('/endpoints', (c) => {
    const endpoints = queryAll("SELECT * FROM endpoints ORDER BY created_at DESC");
    return c.json(endpoints);
  });

  api.post('/endpoints', async (c) => {
    const body = await c.req.json();
    const validationError = validateEndpointInput(body);
    if (validationError) return c.json({ error: validationError }, 400);
    const db = getDb();
    db.run(
      "INSERT INTO endpoints (name, url, method, expected_code, timeout_sec, cron_expr, post_body, headers, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [body.name, body.url, body.method || 'GET', body.expected_code || 200, body.timeout_sec || 10, body.cron_expr || '*/5 * * * *', body.post_body || '', body.headers || '{}', body.is_active !== undefined ? (body.is_active ? 1 : 0) : 1]
    );
    const id = db.exec("SELECT last_insert_rowid() as id")[0].values[0][0];
    saveDatabase();
    reloadEndpoint(id);
    return c.json({ id, message: 'Created' }, 201);
  });

  api.put('/endpoints/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    const body = await c.req.json();
    const validationError = validateEndpointInput(body);
    if (validationError) return c.json({ error: validationError }, 400);
    const db = getDb();
    db.run(
      "UPDATE endpoints SET name=?, url=?, method=?, expected_code=?, timeout_sec=?, cron_expr=?, post_body=?, headers=?, is_active=?, updated_at=datetime('now') WHERE id=?",
      [body.name, body.url, body.method || 'GET', body.expected_code || 200, body.timeout_sec || 10, body.cron_expr || '*/5 * * * *', body.post_body || '', body.headers || '{}', body.is_active ? 1 : 0, id]
    );
    saveDatabase();
    reloadEndpoint(id);
    return c.json({ message: 'Updated' });
  });

  api.delete('/endpoints/:id', (c) => {
    const id = parseInt(c.req.param('id'));
    const db = getDb();
    unregisterEndpoint(id);
    db.run("DELETE FROM endpoints WHERE id = ?", [id]);
    saveDatabase();
    return c.json({ message: 'Deleted' });
  });

  api.post('/endpoints/:id/check', async (c) => {
    const id = parseInt(c.req.param('id'));
    await executeCheck(id);
    const endpoint = queryOne("SELECT * FROM endpoints WHERE id = ?", [id]);
    return c.json(endpoint);
  });

  // Logs
  api.get('/logs', (c) => {
    const url = new URL(c.req.url);
    const endpointId = url.searchParams.get('endpoint_id');
    const status = url.searchParams.get('status');
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    let where = [];
    let params = [];

    if (endpointId) {
      where.push("cl.endpoint_id = ?");
      params.push(parseInt(endpointId));
    }
    if (status) {
      where.push("cl.status = ?");
      params.push(status);
    }

    const whereClause = where.length ? 'WHERE ' + where.join(' AND ') : '';

    const countResult = queryAll(`SELECT COUNT(*) as total FROM check_logs cl ${whereClause}`, params);
    const total = countResult[0]?.total || 0;

    const logs = queryAll(
      `SELECT cl.*, e.name as endpoint_name, e.url as endpoint_url
       FROM check_logs cl
       LEFT JOIN endpoints e ON e.id = cl.endpoint_id
       ${whereClause}
       ORDER BY cl.checked_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    return c.json({ logs, total, page, limit });
  });

  api.get('/logs/stats', (c) => {
    const stats = queryAll(`
      SELECT
        e.id,
        e.name,
        e.last_status,
        COUNT(cl.id) as total_checks,
        SUM(CASE WHEN cl.status = 'up' THEN 1 ELSE 0 END) as up_checks,
        ROUND(AVG(cl.latency_ms)) as avg_latency
      FROM endpoints e
      LEFT JOIN check_logs cl ON cl.endpoint_id = e.id
      GROUP BY e.id
    `);
    return c.json(stats);
  });

  // Dashboard summary
  api.get('/dashboard/summary', (c) => {
    const endpoints = queryAll("SELECT * FROM endpoints ORDER BY name");
    const totalUp = endpoints.filter(e => e.last_status === 'up').length;
    const totalDown = endpoints.filter(e => e.last_status === 'down').length;
    const totalUnknown = endpoints.filter(e => e.last_status === 'unknown').length;

    const recentLogs = queryAll(`
      SELECT cl.*, e.name as endpoint_name
      FROM check_logs cl
      LEFT JOIN endpoints e ON e.id = cl.endpoint_id
      ORDER BY cl.checked_at DESC
      LIMIT 10
    `);

    return c.json({ endpoints, totalUp, totalDown, totalUnknown, total: endpoints.length, recentLogs });
  });

  // Settings
  api.get('/settings', (c) => {
    const configs = queryAll("SELECT * FROM notification_configs");
    return c.json(configs);
  });

  api.put('/settings/:channel', async (c) => {
    const channel = c.req.param('channel');
    const body = await c.req.json();
    const db = getDb();
    db.run(
      "UPDATE notification_configs SET enabled=?, webhook_url=?, bot_token=?, chat_id=?, notify_on_down=?, notify_on_up=?, updated_at=datetime('now') WHERE channel=?",
      [body.enabled ? 1 : 0, body.webhook_url || '', body.bot_token || '', body.chat_id || '', body.notify_on_down ? 1 : 0, body.notify_on_up ? 1 : 0, channel]
    );
    saveDatabase();
    return c.json({ message: 'Updated' });
  });

  api.post('/settings/:channel/test', async (c) => {
    const channel = c.req.param('channel');
    try {
      await sendTestNotification(channel);
      return c.json({ message: 'Test notification sent' });
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  app.route('/api', api);

  return app;
}

// ─── HTML Pages ───

function layout(title, content, activePage = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — MW-Cron</title>
  <link rel="stylesheet" href="/static/css/style.css">
</head>
<body>
  <div class="app-layout">
    <nav class="sidebar">
      <div class="sidebar-header">
        <div class="logo">
          <span class="logo-icon">⚡</span>
          <span class="logo-text">MW-Cron</span>
        </div>
      </div>
      <ul class="nav-links">
        <li><a href="/dashboard" class="${activePage === 'dashboard' ? 'active' : ''}">
          <span class="nav-icon">📊</span> Dashboard
        </a></li>
        <li><a href="/endpoints" class="${activePage === 'endpoints' ? 'active' : ''}">
          <span class="nav-icon">🔗</span> Endpoints
        </a></li>
        <li><a href="/logs" class="${activePage === 'logs' ? 'active' : ''}">
          <span class="nav-icon">📋</span> Logs
        </a></li>
        <li><a href="/settings" class="${activePage === 'settings' ? 'active' : ''}">
          <span class="nav-icon">⚙️</span> Settings
        </a></li>
      </ul>
      <div class="sidebar-footer">
        <a href="/logout" class="logout-btn">🚪 Logout</a>
      </div>
    </nav>
    <main class="main-content">
      <div class="page-header">
        <h1>${title}</h1>
      </div>
      <div class="page-content">
        ${content}
      </div>
    </main>
  </div>
  <script src="/static/js/app.js"></script>
</body>
</html>`;
}

function loginPage(error = '') {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login — MW-Cron</title>
  <link rel="stylesheet" href="/static/css/style.css">
</head>
<body class="login-body">
  <div class="login-container">
    <div class="login-card">
      <div class="login-header">
        <span class="login-logo">⚡</span>
        <h1>MW-Cron</h1>
        <p>Healthcheck Monitor</p>
      </div>
      ${error ? `<div class="alert alert-error">${escapeHtml(error)}</div>` : ''}
      <form method="POST" action="/login" class="login-form">
        <div class="form-group">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required autofocus>
        </div>
        <div class="form-group">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required>
        </div>
        <button type="submit" class="btn btn-primary btn-block">Sign In</button>
      </form>
    </div>
    <div class="login-particles"></div>
  </div>
</body>
</html>`;
}

function dashboardPage() {
  return layout('Dashboard', `
    <div class="stats-grid" id="stats-grid">
      <div class="stat-card stat-total"><div class="stat-number" id="stat-total">-</div><div class="stat-label">Total</div></div>
      <div class="stat-card stat-up"><div class="stat-number" id="stat-up">-</div><div class="stat-label">Up</div></div>
      <div class="stat-card stat-down"><div class="stat-number" id="stat-down">-</div><div class="stat-label">Down</div></div>
      <div class="stat-card stat-unknown"><div class="stat-number" id="stat-unknown">-</div><div class="stat-label">Unknown</div></div>
    </div>
    <div class="section">
      <h2>Endpoints Status</h2>
      <div class="endpoints-grid" id="endpoints-grid">
        <p class="text-muted">Loading...</p>
      </div>
    </div>
    <div class="section">
      <h2>Recent Activity</h2>
      <div class="table-container">
        <table class="data-table">
          <thead><tr><th>Endpoint</th><th>Status</th><th>Code</th><th>Latency</th><th>Time</th></tr></thead>
          <tbody id="recent-logs"><tr><td colspan="5" class="text-muted">Loading...</td></tr></tbody>
        </table>
      </div>
    </div>
    <script>
      loadDashboard();
      setInterval(loadDashboard, 30000);
    </script>
  `, 'dashboard');
}

function endpointsPage() {
  return layout('Endpoints', `
    <div class="page-actions">
      <button class="btn btn-primary" onclick="openEndpointModal()">+ New Endpoint</button>
    </div>
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr>
            <th>Name</th><th>URL</th><th>Method</th><th>Cron</th><th>Status</th><th>Latency</th><th>Active</th><th>Actions</th>
          </tr>
        </thead>
        <tbody id="endpoints-table"><tr><td colspan="8" class="text-muted">Loading...</td></tr></tbody>
      </table>
    </div>

    <!-- Modal -->
    <div class="modal-overlay" id="endpoint-modal" style="display:none">
      <div class="modal">
        <div class="modal-header">
          <h2 id="modal-title">New Endpoint</h2>
          <button class="modal-close" onclick="closeEndpointModal()">&times;</button>
        </div>
        <form id="endpoint-form" onsubmit="saveEndpoint(event)">
          <input type="hidden" id="ep-id">
          <div class="form-row">
            <div class="form-group">
              <label>Name</label>
              <input type="text" id="ep-name" required>
            </div>
            <div class="form-group">
              <label>URL</label>
              <input type="url" id="ep-url" required>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Method</label>
              <select id="ep-method"><option>GET</option><option>POST</option><option>HEAD</option></select>
            </div>
            <div class="form-group">
              <label>Expected Code</label>
              <input type="number" id="ep-code" value="200">
            </div>
            <div class="form-group">
              <label>Timeout (s)</label>
              <input type="number" id="ep-timeout" value="10">
            </div>
          </div>
          <div class="form-group">
            <label>Cron Expression</label>
            <input type="text" id="ep-cron" value="*/5 * * * *" required>
            <small class="form-help">Examples: */5 * * * * (every 5min), */30 * * * * (every 30min), 0 * * * * (hourly)</small>
          </div>
          <div class="form-group">
            <label>POST Body (JSON)</label>
            <textarea id="ep-body" rows="3"></textarea>
          </div>
          <div class="form-group">
            <label>Custom Headers (JSON)</label>
            <textarea id="ep-headers" rows="2">{}</textarea>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="ep-active" checked> Active
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" onclick="closeEndpointModal()">Cancel</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>

    <script>loadEndpoints();</script>
  `, 'endpoints');
}

function logsPage() {
  return layout('Logs', `
    <div class="filters-bar">
      <select id="log-filter-endpoint" onchange="loadLogs()">
        <option value="">All Endpoints</option>
      </select>
      <select id="log-filter-status" onchange="loadLogs()">
        <option value="">All Status</option>
        <option value="up">Up</option>
        <option value="down">Down</option>
      </select>
      <button class="btn btn-ghost" onclick="loadLogs()">Refresh</button>
    </div>
    <div class="table-container">
      <table class="data-table">
        <thead>
          <tr><th>Endpoint</th><th>Status</th><th>Code</th><th>Latency</th><th>Error</th><th>Time</th></tr>
        </thead>
        <tbody id="logs-table"><tr><td colspan="6" class="text-muted">Loading...</td></tr></tbody>
      </table>
    </div>
    <div class="pagination" id="logs-pagination"></div>
    <script>loadLogFilters(); loadLogs();</script>
  `, 'logs');
}

function settingsPage() {
  return layout('Settings', `
    <div class="settings-grid">
      <div class="settings-card">
        <h3>🎮 Discord Webhook</h3>
        <form id="discord-form" onsubmit="saveSettings(event, 'discord')">
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="discord-enabled"> Enabled
            </label>
          </div>
          <div class="form-group">
            <label>Webhook URL</label>
            <input type="url" id="discord-webhook" placeholder="https://discord.com/api/webhooks/...">
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="discord-notify-down" checked> Notify on Down
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="discord-notify-up" checked> Notify on Recovery
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" onclick="testNotification('discord')">Test</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>

      <div class="settings-card">
        <h3>📨 Telegram Bot</h3>
        <form id="telegram-form" onsubmit="saveSettings(event, 'telegram')">
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="telegram-enabled"> Enabled
            </label>
          </div>
          <div class="form-group">
            <label>Bot Token</label>
            <input type="text" id="telegram-token" placeholder="123456:ABC-DEF...">
          </div>
          <div class="form-group">
            <label>Chat ID</label>
            <input type="text" id="telegram-chatid" placeholder="-1001234567890">
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="telegram-notify-down" checked> Notify on Down
            </label>
          </div>
          <div class="form-group">
            <label class="checkbox-label">
              <input type="checkbox" id="telegram-notify-up" checked> Notify on Recovery
            </label>
          </div>
          <div class="form-actions">
            <button type="button" class="btn btn-ghost" onclick="testNotification('telegram')">Test</button>
            <button type="submit" class="btn btn-primary">Save</button>
          </div>
        </form>
      </div>
    </div>
    <script>loadSettings();</script>
  `, 'settings');
}
