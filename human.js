/**
 * Simulación de comportamiento humano: tiempos, curvas Bezier y tipado variable.
 */

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function randInt(min, max) {
  return Math.floor(rand(min, max + 1));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pausa tipica de lectura / pensamiento (ms). */
async function humanPause(kind = 'short') {
  const ranges = {
    micro: [40, 120],
    short: [180, 450],
    medium: [500, 1200],
    read: [900, 2200],
    think: [1400, 3200],
  };
  const [a, b] = ranges[kind] || ranges.short;
  await sleep(rand(a, b));
}

/** Curva Bezier cubica entre puntos. */
function bezierPoint(t, p0, p1, p2, p3) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/**
 * Mueve el mouse con trayectoria curva (no lineal) y velocidad variable.
 * @param {{x:number,y:number}} from
 * @param {{x:number,y:number}} to
 */
async function moveMouseHuman(page, from, to, opts = {}) {
  const steps = opts.steps || randInt(22, 40);
  const overshoot = opts.overshoot !== false && Math.random() > 0.45;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy) || 1;

  // Puntos de control desplazados (trayectoria natural)
  const mid1 = {
    x: from.x + dx * rand(0.2, 0.4) + rand(-dist * 0.15, dist * 0.15),
    y: from.y + dy * rand(0.1, 0.35) + rand(-dist * 0.2, dist * 0.2),
  };
  const mid2 = {
    x: from.x + dx * rand(0.55, 0.8) + rand(-dist * 0.12, dist * 0.12),
    y: from.y + dy * rand(0.55, 0.85) + rand(-dist * 0.15, dist * 0.15),
  };

  let target = { ...to };
  if (overshoot) {
    target = {
      x: to.x + rand(-8, 8),
      y: to.y + rand(-6, 6),
    };
  }

  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // ease-in-out suave
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const p = bezierPoint(eased, from, mid1, mid2, target);
    await page.mouse.move(p.x, p.y);
    // Más lento al inicio/final (acelera en el medio)
    const edge = Math.min(t, 1 - t);
    await sleep(rand(4, 10) + (edge < 0.15 ? rand(6, 14) : 0));
  }

  if (overshoot) {
    await sleep(rand(30, 80));
    await page.mouse.move(to.x + rand(-2, 2), to.y + rand(-2, 2));
    await sleep(rand(20, 50));
    await page.mouse.move(to.x, to.y);
  }
}

async function currentPos(page) {
  // Playwright no expone getMousePos nativo; usamos última conocida o viewport centro-izq
  if (!page.__lastMouse) {
    page.__lastMouse = { x: rand(80, 200), y: rand(80, 180) };
  }
  return { ...page.__lastMouse };
}

async function humanMoveTo(page, x, y) {
  const from = await currentPos(page);
  const to = { x, y };
  await moveMouseHuman(page, from, to);
  page.__lastMouse = { x, y };
}

async function humanClickAt(page, x, y, opts = {}) {
  await humanMoveTo(page, x + rand(-2, 2), y + rand(-2, 2));
  await humanPause(opts.hesitate || 'short');
  await page.mouse.down();
  await sleep(rand(45, 110));
  await page.mouse.up();
  await humanPause('micro');
}

async function humanClickLocator(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('Elemento sin boundingBox');
  const x = box.x + box.width * rand(0.25, 0.75);
  const y = box.y + box.height * rand(0.3, 0.7);
  await humanClickAt(page, x, y);
}

/** Tipado humano: ritmo variable, pausas ocasionales. */
async function humanType(page, text) {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    await page.keyboard.type(ch, { delay: 0 });
    // Ritmo: 60–180 ms por tecla; más lento en símbolos/números
    let delay = rand(55, 140);
    if (/[0-9@.]/.test(ch)) delay += rand(20, 80);
    if (Math.random() < 0.08) delay += rand(180, 420); // duda
    if (Math.random() < 0.04) await humanPause('short');
    await sleep(delay);
  }
}

/**
 * Recorre la layout como un humano mirando el formulario
 * (logo → google → campos → zona turnstile).
 */
async function exploreLoginLayout(page) {
  console.log('Simulando lectura visual del layout...');
  const viewport = page.viewportSize() || { width: 1280, height: 900 };

  // Entrada desde zona aleatoria superior
  await humanMoveTo(page, rand(100, viewport.width - 100), rand(40, 120));
  await humanPause('read');

  const points = [];

  const logo = page.locator('form img[alt="SUBELO"], form a[href="/"]').first();
  const google = page.locator('form button:has-text("Google")').first();
  const user = page.locator('form input[type="text"]').first();
  const pass = page.locator('form input[type="password"]').first();
  const form = page.locator('form').first();

  for (const loc of [logo, google, user, pass, form]) {
    try {
      const box = await loc.boundingBox({ timeout: 2000 });
      if (box) {
        points.push({
          x: box.x + box.width * rand(0.2, 0.8),
          y: box.y + box.height * rand(0.2, 0.8),
        });
      }
    } catch {
      // skip
    }
  }

  // Puntos extra erráticos sobre la card
  try {
    const formBox = await form.boundingBox();
    if (formBox) {
      for (let i = 0; i < randInt(2, 4); i++) {
        points.push({
          x: formBox.x + rand(20, formBox.width - 20),
          y: formBox.y + rand(40, formBox.height - 40),
        });
      }
    }
  } catch {
    // skip
  }

  for (const p of points) {
    await humanMoveTo(page, p.x, p.y);
    await humanPause(Math.random() > 0.5 ? 'short' : 'medium');
  }
}

/**
 * Localiza el iframe Turnstile (shadow DOM) vía CDP y clickea el checkbox
 * con trayectoria humana previa.
 */
async function humanClickTurnstile(page, opts = {}) {
  const fast = opts.fast !== false; // por defecto rápido
  const client = await page.context().newCDPSession(page);
  const { root } = await client.send('DOM.getDocument', { depth: -1, pierce: true });

  function findIframes(node, acc = []) {
    if (!node) return acc;
    if (node.nodeName === 'IFRAME' || node.nodeName === 'iframe') acc.push(node);
    if (node.children) node.children.forEach((c) => findIframes(c, acc));
    if (node.contentDocument) findIframes(node.contentDocument, acc);
    if (node.shadowRoots) node.shadowRoots.forEach((s) => findIframes(s, acc));
    return acc;
  }

  const iframes = findIframes(root).filter((n) => {
    const attrs = n.attributes || [];
    for (let i = 0; i < attrs.length; i += 2) {
      const key = attrs[i];
      const val = String(attrs[i + 1] || '');
      if (key === 'src' && val.includes('challenges.cloudflare.com')) return true;
      if (key === 'id' && val.includes('cf-chl-widget')) return true;
    }
    return false;
  });

  if (!iframes.length) {
    console.log('Widget Turnstile aún no visible');
    return false;
  }

  const { model } = await client.send('DOM.getBoxModel', { nodeId: iframes[0].nodeId });
  if (!model) return false;

  const [x1, y1, , , , y3] = model.content;
  const height = y3 - y1;
  const checkX = x1 + rand(24, 32);
  const checkY = y1 + height * 0.5;

  if (fast) {
    await page.mouse.move(checkX, checkY);
    await sleep(80);
    await page.mouse.down();
    await sleep(50);
    await page.mouse.up();
    page.__lastMouse = { x: checkX, y: checkY };
    return true;
  }

  await humanMoveTo(page, checkX, checkY);
  await humanPause('short');
  await page.mouse.down();
  await sleep(rand(50, 100));
  await page.mouse.up();
  return true;
}

module.exports = {
  rand,
  randInt,
  sleep,
  humanPause,
  humanMoveTo,
  humanClickAt,
  humanClickLocator,
  humanType,
  exploreLoginLayout,
  humanClickTurnstile,
};
