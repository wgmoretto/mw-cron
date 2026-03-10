export async function checkEndpoint(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (endpoint.timeout_sec || 10) * 1000);

  const start = Date.now();

  try {
    let headers = {};
    try {
      headers = JSON.parse(endpoint.headers || '{}');
    } catch {}

    const options = {
      method: endpoint.method || 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'MW-Cron Healthcheck/1.0',
        ...headers,
      },
    };

    if (endpoint.method === 'POST' && endpoint.post_body) {
      options.body = endpoint.post_body;
      if (!headers['Content-Type']) {
        options.headers['Content-Type'] = 'application/json';
      }
    }

    const response = await fetch(endpoint.url, options);
    const latency = Date.now() - start;

    const status = response.status === (endpoint.expected_code || 200) ? 'up' : 'down';

    return {
      status,
      status_code: response.status,
      latency_ms: latency,
      error_msg: status === 'down' ? `Expected ${endpoint.expected_code}, got ${response.status}` : '',
    };
  } catch (err) {
    const latency = Date.now() - start;
    return {
      status: 'down',
      status_code: 0,
      latency_ms: latency,
      error_msg: err.name === 'AbortError' ? 'Timeout' : err.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}
