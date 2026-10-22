// Проверка в браузере: node farm/tests/storm.js (нужен Playwright)
const path = require('path'), fs = require('fs');
const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farm-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 600 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(PAGE); await p.waitForTimeout(500);
  console.log(await p.evaluate(() => {
    state.firstRain = true; state.coins = 5000; Object.assign(state.bag, { wood: 60, cement: 20, lamp: 3, fence: 10, millPlan: 1 });
    state.sel = 0; state.buildType = 'millPlan'; player.x = 30 * 16 + 8; player.y = 10 * 16 + 10; player.dir = 0; act(); buildSite(state.objs.find(o => o.type === 'mill' && !o.built));
    for (const [tx, ty] of [[20, 19], [22, 19], [24, 19]]) state.objs.push({ type: 'lamp', tx, ty });
    rebuildDyn(); player.x = 22 * 16; player.y = 18 * 16; document.getElementById('toasts').innerHTML = '';
    startRain(0, true);
    return 'storm ' + state.rain.storm + ' fire ' + state.fire.fuel + ' pile ' + state.fire.pile;
  }));
  // walk around outside for a while
  await p.evaluate(() => { keys.KeyD = true; });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { keys.KeyD = false; keys.KeyA = true; });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { keys.KeyA = false; lightning(); });
  await p.waitForTimeout(60);
  await p.screenshot({ path: path.join(SHOTS, 'storm.png') });
  console.log(await p.evaluate(() => `cold ${state.cold.toFixed(1)} fallen lamps ${state.objs.filter(o => o.fallen).length} fire ${state.fire.fuel.toFixed(0)} pile ${state.fire.pile}`));
  // force a fall and capture it
  await p.evaluate(() => { startFall(); }); await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'fall.png') });
  // mill damage + repair
  console.log(await p.evaluate(() => { const m = state.objs.find(o => o.type === 'mill'); m.damaged = true; player.x = (m.tx + 1) * 16 + 8; player.y = (m.ty + 3) * 16 + 10; player.dir = 1; return getAction().hint; }));
  await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, 'mill_damaged.png') });
  console.log(await p.evaluate(() => { repairMill(); return 'repaired ' + !state.objs.find(o => o.type === 'mill').damaged + ' wood ' + state.bag.wood; }));
  // house: fire out -> add log -> warm
  await p.evaluate(() => { state.cold = 70; state.scene = 'house'; player.x = 88; player.y = 70; player.dir = 1; state.fire.fuel = 0; state.fire.relightAt = state.t + 999; state.fire.pile = 0; });
  await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, 'house_cold.png') });
  console.log(await p.evaluate(() => getAction().hint));
  await p.evaluate(() => act()); await p.waitForTimeout(2500);
  console.log(await p.evaluate(() => `after fire: lit ${fireLit()} cold ${state.cold.toFixed(1)}`));
  // woodpile
  console.log(await p.evaluate(() => { player.x = 40; player.y = 70; player.dir = 1; const h = getAction().hint; state.fire.pile = 6; state.fire.fuel = 0; state.fire.relightAt = 0; advanceTime(1); return h + ' | autofeed lit ' + fireLit() + ' pile ' + state.fire.pile; }));
  await p.waitForTimeout(300); await p.screenshot({ path: path.join(SHOTS, 'house_pile.png') });
  // freeze -> game over -> restart
  await p.evaluate(() => { state.scene = 'island'; player.x = 22 * 16; player.y = 18 * 16; state.cold = 99.5; });
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(SHOTS, 'gameover.png') });
  console.log(await p.evaluate(() => 'gameOver ' + gameOver));
  await p.click('#restartBtn'); await p.waitForTimeout(300);
  console.log(await p.evaluate(() => `after restart coins ${state.coins} storm ${state.rain.storm} cold ${state.cold} busy ${busy}`));
  console.log('errors', errs);
  await b.close();
})();
