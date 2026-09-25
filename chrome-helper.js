const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function requestJson(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(
      url,
      {
        method: options.method || 'GET',
        headers: {
          'content-type': 'application/json',
          ...(options.headers || {}),
        },
        timeout: options.timeout || 60000,
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: data ? JSON.parse(data) : null, raw: data });
          } catch (e) {
            reject(new Error(`JSON inválido: ${data.slice(0, 200)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
    if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body));
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function findChromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p)) || null;
}

/**
 * Lanza Chrome real (no el de Playwright) con remote debugging.
 * Suele pasar mejor Turnstile porque no nace marcado como automation.
 */
async function launchRealChrome({ userDataDir, port = 9222, url }) {
  const chrome = findChromePath();
  if (!chrome) throw new Error('No se encontró Google Chrome instalado');

  fs.mkdirSync(userDataDir, { recursive: true });

  // Liberar puerto si quedó un chrome colgado
  try {
    await requestJson(`http://127.0.0.1:${port}/json/version`);
    console.log(`Chrome ya escuchando en :${port}`);
    return { port, alreadyRunning: true };
  } catch {
    // ok, no hay nada
  }

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-blink-features=AutomationControlled',
    '--start-maximized',
    url || 'about:blank',
  ];

  console.log('Lanzando Chrome real...');
  const child = spawn(chrome, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  for (let i = 0; i < 40; i++) {
    try {
      await requestJson(`http://127.0.0.1:${port}/json/version`);
      return { port, pid: child.pid, alreadyRunning: false };
    } catch {
      await sleep(250);
    }
  }
  throw new Error('Chrome no abrió remote debugging a tiempo');
}

/**
 * Resuelve Turnstile vía CapSolver (100% automático).
 * Requiere CAPSOLVER_API_KEY en .env
 * Docs: https://docs.capsolver.com/
 */
async function solveTurnstileCapSolver({ apiKey, siteKey, pageUrl }) {
  console.log('Solicitando token Turnstile a CapSolver...');
  const create = await requestJson(
    'https://api.capsolver.com/createTask',
    { method: 'POST' },
    {
      clientKey: apiKey,
      task: {
        type: 'AntiTurnstileTaskProxyLess',
        websiteURL: pageUrl,
        websiteKey: siteKey,
      },
    }
  );

  if (create.json?.errorId) {
    throw new Error(`CapSolver createTask: ${create.json.errorDescription || create.raw}`);
  }

  const taskId = create.json.taskId;
  if (!taskId) throw new Error(`CapSolver sin taskId: ${create.raw}`);

  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const res = await requestJson(
      'https://api.capsolver.com/getTaskResult',
      { method: 'POST' },
      { clientKey: apiKey, taskId }
    );

    if (res.json?.status === 'ready') {
      const token = res.json.solution?.token;
      if (!token) throw new Error('CapSolver ready sin token');
      console.log('CapSolver: token recibido');
      return token;
    }
    if (res.json?.errorId) {
      throw new Error(`CapSolver: ${res.json.errorDescription || res.raw}`);
    }
    process.stdout.write('.');
  }
  throw new Error('CapSolver timeout');
}

/**
 * Inyecta el token en el campo hidden y dispara callbacks de Turnstile si existen.
 */
async function injectTurnstileToken(page, token) {
  await page.evaluate((t) => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    if (input) {
      input.value = t;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // Algunos widgets escuchan el callback global
    if (typeof window.turnstileCallback === 'function') {
      try {
        window.turnstileCallback(t);
      } catch {
        // ignore
      }
    }

    // Buscar textareas/inputs cf-turnstile-response duplicados
    document.querySelectorAll('[name="cf-turnstile-response"]').forEach((el) => {
      el.value = t;
    });
  }, token);
}

module.exports = {
  launchRealChrome,
  solveTurnstileCapSolver,
  injectTurnstileToken,
  findChromePath,
  requestJson,
  sleep,
};
