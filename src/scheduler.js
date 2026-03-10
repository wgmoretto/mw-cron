import { CronJob } from 'cron';
import { getDb, saveDatabase } from './database.js';
import { checkEndpoint } from './checker.js';
import { notify } from './notifier.js';

const jobs = new Map(); // endpoint_id -> CronJob

function getAllActiveEndpoints() {
  const db = getDb();
  const results = db.exec("SELECT * FROM endpoints WHERE is_active = 1");
  if (!results.length) return [];
  return resultsToObjects(results[0]);
}

function resultsToObjects(result) {
  const { columns, values } = result;
  return values.map(row => {
    const obj = {};
    columns.forEach((col, i) => obj[col] = row[i]);
    return obj;
  });
}

async function executeCheck(endpointId) {
  const db = getDb();
  const id = Number(endpointId);
  if (!Number.isInteger(id)) return;
  const stmt = db.prepare("SELECT * FROM endpoints WHERE id = ?");
  stmt.bind([id]);
  if (!stmt.step()) { stmt.free(); return; }
  const endpoint = stmt.getAsObject();
  stmt.free();
  const previousStatus = endpoint.last_status;

  const result = await checkEndpoint(endpoint);

  // Insert log
  db.run(
    "INSERT INTO check_logs (endpoint_id, status, status_code, latency_ms, error_msg) VALUES (?, ?, ?, ?, ?)",
    [endpointId, result.status, result.status_code, result.latency_ms, result.error_msg]
  );

  // Update endpoint
  db.run(
    "UPDATE endpoints SET last_status = ?, last_check_at = datetime('now'), last_latency = ?, updated_at = datetime('now') WHERE id = ?",
    [result.status, result.latency_ms, endpointId]
  );

  saveDatabase();

  // Notify if status changed
  await notify(endpoint, result, previousStatus);
}

function registerJob(endpoint) {
  if (jobs.has(endpoint.id)) {
    jobs.get(endpoint.id).stop();
    jobs.delete(endpoint.id);
  }

  try {
    const job = new CronJob(endpoint.cron_expr, () => {
      executeCheck(endpoint.id).catch(err => {
        console.error(`[Check error] Endpoint ${endpoint.id}:`, err.message);
      });
    });
    job.start();
    jobs.set(endpoint.id, job);
    console.log(`[Scheduler] Registered: ${endpoint.name} (${endpoint.cron_expr})`);
  } catch (err) {
    console.error(`[Scheduler] Failed to register ${endpoint.name}:`, err.message);
  }
}

export function startScheduler() {
  const endpoints = getAllActiveEndpoints();
  for (const ep of endpoints) {
    registerJob(ep);
  }
  console.log(`[Scheduler] Started with ${endpoints.length} active endpoints`);

  // Cleanup old logs daily at midnight
  const cleanupJob = new CronJob('0 0 * * *', () => {
    const db = getDb();
    db.run("DELETE FROM check_logs WHERE checked_at < datetime('now', '-30 days')");
    saveDatabase();
    console.log('[Scheduler] Cleaned up old logs');
  });
  cleanupJob.start();
}

export function reloadEndpoint(endpointId) {
  const db = getDb();
  const id = Number(endpointId);
  if (!Number.isInteger(id)) return;
  const stmt = db.prepare("SELECT * FROM endpoints WHERE id = ?");
  stmt.bind([id]);
  if (!stmt.step()) {
    stmt.free();
    unregisterEndpoint(endpointId);
    return;
  }
  const endpoint = stmt.getAsObject();
  stmt.free();
  if (endpoint.is_active) {
    registerJob(endpoint);
  } else {
    unregisterEndpoint(endpointId);
  }
}

export function stopScheduler() {
  for (const [id, job] of jobs) {
    job.stop();
  }
  jobs.clear();
  console.log('[Scheduler] All jobs stopped');
}

export function unregisterEndpoint(endpointId) {
  if (jobs.has(endpointId)) {
    jobs.get(endpointId).stop();
    jobs.delete(endpointId);
    console.log(`[Scheduler] Unregistered endpoint ${endpointId}`);
  }
}

export { executeCheck };
