// Проверка в браузере: node farm/tests/islands-mill.js (нужен Playwright)
const path = require('path'), fs = require('fs');
const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farm-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1100, height: 640 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const t0 = Date.now();
  await p.goto(PAGE); await p.waitForTimeout(600);
  console.log('load ms', Date.now() - t0, 'errors', errs);
  const shot = async (name, fn) => { await p.evaluate(fn); await p.waitForTimeout(350); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  console.log(await p.evaluate(() => JSON.stringify(BRIDGES.map(B => ({ id: B.id, a: B.a, b: B.b, sign: B.sign, worker: B.worker, signLand: landV(B.sign.tx + .5, B.sign.ty + .5).toFixed(1), workerLand: landV(B.worker.tx + .5, B.worker.ty + .5).toFixed(1) }))) + ' forest spruces ' + FOREST_WILD.length));
  // sign interaction
  console.log(await p.evaluate(() => { const B = BRIDGES[0]; player.x = B.sign.tx * 16 + 8; player.y = (B.sign.ty + 1) * 16 + 10; player.dir = 1; return getAction().hint; }));
  await shot('bridge0', () => { const B = BRIDGES[0]; player.x = (B.a - 2) * 16; player.y = 19 * 16; });
  await p.evaluate(() => { state.coins = 5000; state.bag.wood = 200; state.bag.cement = 30; upgradeBridge('forest'); upgradeBridge('cows'); });
  await shot('bridge1', () => { player.x = (BRIDGES[0].a + 3) * 16; player.y = 18 * 16 + 10; });
  // walk across forest bridge
  const walked = await p.evaluate(async () => { player.x = (BRIDGES[0].a) * 16 + 8; player.y = 18 * 16 + 12; keys.KeyD = true; await new Promise(r => setTimeout(r, 3500)); keys.KeyD = false; return Math.round(player.x / 16) + ',' + Math.round(player.y / 16) + ' forest v=' + islV(1, player.x / 16, player.y / 16).toFixed(1); });
  console.log('walked to', walked);
  await p.evaluate(() => { upgradeBridge('forest'); upgradeBridge('cows'); });
  await shot('bridge2', () => { player.x = (BRIDGES[0].a + 3) * 16; player.y = 19 * 16 + 10; });
  await p.evaluate(() => { upgradeBridge('forest'); upgradeBridge('cows'); });
  await shot('bridge3_night', () => { state.t = 22 * 60; player.x = (BRIDGES[0].a + 3) * 16; player.y = 19 * 16 + 10; });
  await shot('forest', () => { state.t = 10 * 60; player.x = 64 * 16; player.y = 19 * 16; });
  await shot('cows_bridge', () => { player.x = 17 * 16; player.y = (BRIDGES[1].a + 4) * 16; });
  await shot('cows', () => { player.x = 17 * 16; player.y = 43 * 16; });
  // mill: place and build
  console.log(await p.evaluate(() => {
    state.bag.millPlan = 1; state.sel = 0; state.buildType = 'millPlan';
    let found = null;
    for (let ty = 8; ty < 28 && !found; ty++) for (let tx = 30; tx < 40; tx++) { player.x = tx * 16 + 8; player.y = ty * 16 + 10; player.dir = 0; if (!blocked(player.x, player.y) && planFits('millPlan')) { found = [tx, ty]; break; } }
    act(); buildSite(state.objs.find(o => o.type === 'mill' && !o.built)); const m = state.objs.find(o => o.type === 'mill');
    player.x = (m.tx + 1) * 16 + 8; player.y = (m.ty + 3) * 16 + 10; player.dir = 1;
    return 'mill ' + JSON.stringify(m) + ' door hint: ' + getAction().hint;
  }));
  await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, 'mill_built.png') });
  await p.evaluate(() => act()); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(SHOTS, 'mill1.png') });
  console.log(await p.evaluate(() => { player.x = 120; player.y = 80; player.dir = 1; return state.scene + ' ' + getAction().hint; }));
  await p.evaluate(() => act()); await p.waitForTimeout(800);
  await p.screenshot({ path: path.join(SHOTS, 'mill2.png') });
  console.log(await p.evaluate(() => { player.x = 40; player.y = 62; player.dir = 1; return state.scene + ' ' + getAction().hint; }));
  await p.evaluate(() => act()); await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(SHOTS, 'pano_sea.png') });
  await p.evaluate(() => act()); await p.waitForTimeout(800);
  console.log(await p.evaluate(() => { player.x = 100; player.y = 62; player.dir = 1; return 'pano ' + pano + ' ' + getAction().hint; }));
  await p.evaluate(() => act()); await p.waitForTimeout(900);
  await p.screenshot({ path: path.join(SHOTS, 'pano_island.png') });
  await p.evaluate(() => { state.t = 19 * 60; }); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'pano_sea_eve.png') });
  console.log('errors', errs);
  await b.close();
})();
