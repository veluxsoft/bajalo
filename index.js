require('dotenv').config();
const { chromium } = require('patchright');
const path = require('path');
const fs = require('fs');
const { sleep, humanClickTurnstile } = require('./human');
const {
  launchRealChrome,
  solveTurnstileCapSolver,
  injectTurnstileToken,
} = require('./chrome-helper');

const LOGIN_URL = process.env.LOGIN_URL || 'https://subelo.lol/login';
const USER = process.env.SUBELO_USER;
const PASS = process.env.SUBELO_PASS;
const SITEKEY = process.env.TURNSTILE_SITEKEY || '0x4AAAAAAEzWu-1po3ovlJXX';
const CAPSOLVER_API_KEY = process.env.CAPSOLVER_API_KEY || '';
const CDP_PORT = Number(process.env.CDP_PORT || 9222);
const KEEP_OPEN_MS = Number(process.env.KEEP_OPEN_MS || 8000);

if (!USER || !PASS) {
  console.error('Faltan SUBELO_USER o SUBELO_PASS en el archivo .env');
  process.exit(1);
}

async function getTurnstileToken(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[name="cf-turnstile-response"]');
    return input ? input.value.trim() : '';
  });
}

async function isTurnstileFailed(page) {
  return page.evaluate(() => {
    const text = (document.body?.innerText || '').toLowerCase();
    return text.includes('la verificación falló') || text.includes('verification failed');
  });
}

async function waitToken(page, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const token = await getTurnstileToken(page);
    if (token.length > 20) return token;
    if (await isTurnstileFailed(page)) return null;
    await sleep(200);
  }
  return null;
}

async function fillCredentialsFast(page) {
  const userInput = page.locator('form input[type="text"], form input[autocomplete="username"]').first();
  const passInput = page.locator('form input[type="password"]').first();
  await userInput.waitFor({ state: 'visible', timeout: 30000 });

  console.log('Rellenando campos...');
  await userInput.fill(USER);
  await passInput.fill(PASS);
}

async function solveTurnstileFast(page) {
  console.log('Esperando Cloudflare...');
  let token = await waitToken(page, 8000);
  if (token) {
    console.log('Cloudflare OK');
    return token;
  }

  // Un clic rápido al widget si managed no resolvió solo
  console.log('Marcando Turnstile...');
  await humanClickTurnstile(page, { fast: true }).catch(() => false);
  token = await waitToken(page, 12000);
  if (token) {
    console.log('Cloudflare OK');
    return token;
  }

  if (!CAPSOLVER_API_KEY) {
    throw new Error('Cloudflare no pasó. Añade CAPSOLVER_API_KEY en .env o reintenta.');
  }

  const solved = await solveTurnstileCapSolver({
    apiKey: CAPSOLVER_API_KEY,
    siteKey: SITEKEY,
    pageUrl: LOGIN_URL,
  });
  await injectTurnstileToken(page, solved);
  token = await getTurnstileToken(page);
  if (token.length < 20) throw new Error('No se inyectó el token CapSolver');
  console.log('Cloudflare OK (CapSolver)');
  return token;
}

async function login() {
  const screenshotsDir = path.join(__dirname, 'screenshots');
  const chromeProfile = path.join(__dirname, '.chrome-real-profile');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  await launchRealChrome({
    userDataDir: chromeProfile,
    port: CDP_PORT,
    url: 'about:blank',
  });

  console.log('Conectando a Chrome...');
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const context = browser.contexts()[0] || (await browser.newContext());
  const page = context.pages()[0] || (await context.newPage());

  try {
    console.log(`Navegando a ${LOGIN_URL}...`);
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    await fillCredentialsFast(page);
    await solveTurnstileFast(page);

    console.log('Entrando...');
    await page.locator('form button[type="submit"]').click();

    await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null);
    await page.screenshot({ path: path.join(screenshotsDir, 'despues-entrar.png'), fullPage: true }).catch(() => {});

    console.log(`Listo. URL: ${page.url()}`);
    await sleep(KEEP_OPEN_MS);
  } catch (err) {
    console.error('Error:', err.message);
    await page.screenshot({ path: path.join(screenshotsDir, 'error.png'), fullPage: true }).catch(() => {});
    throw err;
  } finally {
    await browser.close().catch(() => {});
  }
}

login().catch((err) => {
  console.error(err);
  process.exit(1);
});
