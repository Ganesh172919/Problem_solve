import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const DEFAULT_PORT = 3100;
const BASE_TIMEOUT_MS = 60_000;

function spawnNpm(args, options) {
  if (process.platform === 'win32') {
    return spawn('cmd.exe', ['/c', 'npm', ...args], options);
  }
  return spawn('npm', args, options);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function findAvailablePort(preferredPort) {
  return await new Promise((resolve) => {
    const tryListen = (port) => {
      const srv = createServer();
      srv.unref();
      srv.once('error', () => {
        try {
          srv.close();
        } catch {
          // ignore (server may not be listening)
        }
        if (port === 0) resolve(preferredPort); // should not happen
        else tryListen(0);
      });
      srv.listen(port, '127.0.0.1', () => {
        const address = srv.address();
        const resolved = typeof address === 'object' && address ? address.port : port;
        srv.close(() => resolve(resolved));
      });
    };
    tryListen(preferredPort);
  });
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.headers ?? {}),
        ...(options.json ? { 'content-type': 'application/json' } : {}),
      },
      body: options.json ? JSON.stringify(options.json) : options.body,
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { res, data, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealthy(baseUrl, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { res, data } = await fetchJson(`${baseUrl}/api/health`, { timeoutMs: 5_000 });
      if (res.ok && data && typeof data === 'object' && data.status) return data;
    } catch {
      // ignore and retry
    }
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health`);
}

function extractCookie(setCookieHeader) {
  if (!setCookieHeader) return null;
  // Keep only the first cookie pair: "admin_token=...".
  return String(setCookieHeader).split(';')[0] || null;
}

async function main() {
  const mode = (process.env.SMOKE_MODE ?? 'dev').toLowerCase(); // dev | start
  const requestedPort = Number.parseInt(process.env.PORT ?? '', 10) || DEFAULT_PORT;
  const port = await findAvailablePort(requestedPort);
  const baseUrl = `http://localhost:${port}`;

  const npmArgs = mode === 'start'
    ? ['run', 'start', '--', '-p', String(port)]
    : ['run', 'dev', '--', '-p', String(port)];

  console.log(`[smoke] starting (${mode}) on ${baseUrl}`);

  const child = spawnNpm(npmArgs, {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: { ...process.env },
  });

  try {
    const health = await waitForHealthy(baseUrl, BASE_TIMEOUT_MS);
    console.log('[smoke] health ok:', health.status);

    const postsBefore = await fetchJson(`${baseUrl}/api/posts?limit=5`);
    if (!postsBefore.res.ok) throw new Error(`posts before failed: ${postsBefore.res.status} ${postsBefore.text}`);

    const login = await fetchJson(`${baseUrl}/api/auth`, {
      method: 'POST',
      json: { username: 'admin', password: 'admin123' },
    });
    if (!login.res.ok) throw new Error(`login failed: ${login.res.status} ${login.text}`);

    const cookie = extractCookie(login.res.headers.get('set-cookie'));
    if (!cookie) throw new Error('missing admin auth cookie from /api/auth');

    const admin = await fetchJson(`${baseUrl}/api/admin`, { headers: { cookie } });
    if (!admin.res.ok) throw new Error(`admin failed: ${admin.res.status} ${admin.text}`);

    const gen = await fetchJson(`${baseUrl}/api/generate`, { method: 'POST', headers: { cookie }, timeoutMs: 60_000 });
    if (!gen.res.ok) throw new Error(`generate failed: ${gen.res.status} ${gen.text}`);
    if (!gen.data || gen.data.success !== true) throw new Error(`generate returned non-success: ${JSON.stringify(gen.data)}`);

    const postsAfter = await fetchJson(`${baseUrl}/api/posts?limit=5`);
    if (!postsAfter.res.ok) throw new Error(`posts after failed: ${postsAfter.res.status} ${postsAfter.text}`);

    console.log('[smoke] ok:', {
      postsBefore: Array.isArray(postsBefore.data?.posts) ? postsBefore.data.posts.length : null,
      postsAfter: Array.isArray(postsAfter.data?.posts) ? postsAfter.data.posts.length : null,
      totalPosts: admin.data?.total ?? null,
    });
  } finally {
    // Best-effort shutdown; `npm` may spawn child processes depending on platform.
    if (process.platform === 'win32' && child.pid) {
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  }
}

main().catch((err) => {
  console.error('[smoke] failed:', err?.stack || err);
  process.exitCode = 1;
});
