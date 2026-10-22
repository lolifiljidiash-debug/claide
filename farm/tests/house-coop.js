// Проверка в браузере: node farm/tests/house-coop.js (нужен Playwright)
const path = require('path'), fs = require('fs');
const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farm-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(PAGE); await p.waitForTimeout(500);
  const out = await p.evaluate(() => {
    const o = [];
    const face = (tx, ty, dir) => { const [dx, dy] = DIRV[dir]; player.x = (tx - dx) * 16 + 8; player.y = (ty - dy) * 16 + 10; player.dir = dir; };
    state.coins = 1000;
    Object.assign(state.bag, { coop: 1, feeder: 1, fence: 30, gate: 1, wheat: 10, seedBeet: 2, seedPotato: 2, bed: 4 });
    // pen: x 26..31, y 12..17 fence ring, gate at (28,17)
    state.sel = 0;
    const put = (type, tx, ty) => { state.buildType = type; face(tx, ty, 0); const a = getAction(); if (!a || !a.run) o.push(`fail ${type} ${tx},${ty}: ${a && a.hint}`); else a.run(); };
    for (let x = 26; x <= 31; x++) { put('fence', x, 12); put(x === 28 ? 'gate' : 'fence', x, 17); }
    for (let y = 13; y <= 16; y++) { put('fence', 26, y); put('fence', 31, y); }
    put('coop', 27, 14); put('feeder', 30, 14);
    o.push('objs ' + state.objs.length);
    // buy chickens
    for (let i = 0; i < 3; i++) buyChicken();
    o.push('chickens ' + state.chickens.length + ' free ' + freeCoopPlaces());
    // feeder fill
    face(30, 14, 0); state.sel = 2; o.push(getAction().hint); getAction().run();
    // gate
    face(28, 17, 1); state.sel = 2; o.push(getAction().hint);
    // beet plant
    face(24, 14, 0); state.sel = 3; state.seedType = 'seedBeet'; o.push(getAction().hint); getAction().run();
    player.x = 24 * 16; player.y = 20 * 16; player.dir = 0;
    state.t = 6 * 60 + 2 * 60;
    return o;
  });
  console.log(out.join('\n'));
  await p.waitForTimeout(6000);
  console.log(await p.evaluate(() => JSON.stringify(state.chickens.map(c => ({ x: Math.round(c.x), y: Math.round(c.y), fed: c.fed })) ) + ' feeder ' + state.objs.find(o => o.type === 'feeder').grain));
  await p.evaluate(() => { player.x = 28.5 * 16; player.y = 19 * 16; });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'pen.png') });
  // fast-forward to lay eggs
  await p.evaluate(() => { state.t += 400; });
  await p.waitForTimeout(400);
  console.log(await p.evaluate(() => 'eggs ' + state.objs.find(o => o.type === 'coop').eggs));
  await p.screenshot({ path: path.join(SHOTS, 'eggs.png') });
  // house
  await p.evaluate(() => { player.x = 17.5 * 16; player.y = 16 * 16 + 8; player.dir = 1; act(); });
  await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(SHOTS, 'house_day.png') });
  await p.evaluate(() => { state.t = Math.floor(state.t / 1440) * 1440 + 22 * 60; player.x = 136; player.y = 80; player.dir = 2; });
  await p.waitForTimeout(400);
  console.log(await p.evaluate(() => 'house hint: ' + getAction().hint));
  await p.screenshot({ path: path.join(SHOTS, 'house_night.png') });
  await p.evaluate(() => act()); await p.waitForTimeout(2200);
  console.log(await p.evaluate(() => `after sleep scene ${state.scene} day ${dayNum()} h ${hourOf().toFixed(1)}`));
  await p.evaluate(() => { player.x = 88; player.y = 130; player.dir = 0; keys.KeyS = true; });
  await p.waitForTimeout(800);
  await p.evaluate(() => { keys.KeyS = false; });
  await p.waitForTimeout(600);
  console.log(await p.evaluate(() => `exit scene ${state.scene} pos ${Math.round(player.x)},${Math.round(player.y)}`));
  await p.evaluate(() => { player.x = 28.5 * 16; player.y = 31 * 16 + 10; player.dir = 0; act(); });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'shop2.png'), fullPage: false });
  console.log('errors', errs);
  await b.close();
})();
