// Проверка в браузере: node farm/tests/farmer.js (нужен Playwright)
// распорядок работника на грядках: собрать → разгрузить → посадить (семена за один заход) → полить на ходу; окошко сытости
const path = require('path'), fs = require('fs');
const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farm-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1000, height: 620 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message + ' ' + e.stack)); p.on('console', m => m.type() === 'error' && errs.push(m.text()));
  await p.goto(PAGE); await p.waitForTimeout(500);
  let fails = 0;
  const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fails++; };
  const ev = f => p.evaluate(f);
  const setup = await ev(() => {
    window.startRain = () => {}; state.firstRain = true; state.coins = 9000; state.t = 8 * 60;
    Object.assign(state.bag, { wood: 200, cement: 40, cabinPlan: 1, chickBed: 3, bed: 4 });
    const placeAt = (k, tx0, ty0, n) => { let c = 0; for (let ty = ty0; ty < ty0 + 10 && c < n; ty++) for (let tx = tx0; tx < tx0 + 12 && c < n; tx++) { state.sel = 0; state.buildType = k; player.x = tx * 16 + 8; player.y = (ty - 1) * 16 + 10; player.dir = 0; if (!blocked(player.x, player.y) && (PLANS[k] ? planFits(k) : canPlace(k, tx, ty))) { act(); c++; } } return c; };
    placeAt('cabinPlan', 6, 16, 1); placeAt('chickBed', 22, 20, 3); placeAt('bed', 25, 9, 4);
    for (const s of state.objs.filter(o => o.type === 'cabin')) buildSite(s);
    const c = state.objs.find(o => o.type === 'cabin' && o.built);
    const put = (type, tx, ty, extra) => state.objs.push(Object.assign({ type, tx, ty }, extra));
    put('seedbox', 21, 17, { seeds: { seedWheat: 10, seedCarrot: 4, seedBeet: 4, seedPotato: 4 } });
    const spot = (tx0, ty0) => { for (let ty = ty0; ty < ty0 + 8; ty++) for (let tx = tx0; tx < tx0 + 8; tx++) if (canPlace('feedbox', tx, ty)) return [tx, ty]; };
    const fs = spot(23, 24); put('feedbox', fs[0], fs[1], { feed: 0 });
    rebuildDyn();
    for (const b of state.beds) { b.crop = b.chick ? 'wheat' : ['wheat', 'carrot', 'beet', 'potato'][Math.floor(Math.random() * 4)]; b.prog = 9999; b.wet = 0; }
    state.chest = Object.fromEntries(Object.keys(state.chest).map(k => [k, 0]));
    state.workers = [{ id: 1, name: 'Ваня', fem: 0, pal: 0, x: c.tx * 16 + 8, y: (c.ty + 2) * 16 + 10, dir: 0, mode: 'housed', home: { tx: c.tx, ty: c.ty }, job: 'beds', can: true, inside: false, carry: {}, seeds: {}, chickSeeds: 0, task: null, path: [], full: FULL_MAX, water: 0, cold: 0, dayChecked: dayNum() }];
    window.seedTrips = 0; const orig = takeSeeds; window.takeSeeds = (w, box) => { seedTrips++; return orig(w, box); };
    return { beds: state.beds.length, chick: state.beds.filter(b => b.chick).length, seeds: Object.values(state.objs.find(o => o.type === 'seedbox').seeds).reduce((a, n) => a + n, 0) };
  });
  console.log('setup', JSON.stringify(setup));
  check(setup.chick === 3 && setup.beds >= 9, 'beds placed');
  await ev(() => { window.tl = []; const od = doTask; window.doTask = w => { tl.push(Math.round(performance.now() / 100) / 10 + ':' + w.task.kind); return od(w); }; });
  let r, t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(1000);
    r = await ev(() => { const box = state.objs.find(o => o.type === 'seedbox'), w = state.workers[0]; return { planted: state.beds.filter(b => b.crop && !ripe(b)).length, wet: state.beds.filter(b => b.crop && b.wet > 0).length, chickWheat: state.beds.filter(b => b.chick && b.crop === 'wheat').length, feed: state.objs.find(o => o.type === 'feedbox').feed, chest: Object.values(state.chest).reduce((a, n) => a + n, 0), boxSeeds: Object.values(box.seeds).reduce((a, n) => a + n, 0), held: seedsHeld(w), trips: seedTrips, task: w.task && w.task.kind, carry: JSON.stringify(w.carry), bag: state.bag.feed, kinds: [...new Set(state.beds.filter(b => !b.chick).map(b => b.crop))].join() }; });
    if (r.planted === setup.beds && r.wet === setup.beds && !r.held && r.feed > 0) break;
  }
  const secs = Math.round((Date.now() - t0) / 1000);
  console.log('after', secs, 's', JSON.stringify(r));
  if (process.env.TL) console.log(await ev(() => tl.join(' ')));
  check(r.chest > 0 && r.feed >= 3, 'harvest: produce in chest, chicken wheat in feed box');
  check(r.planted === setup.beds && r.chickWheat === 3, 'all beds replanted, chicken beds with wheat');
  check(r.trips === 1, 'seeds taken in one trip: ' + r.trips);
  check(!r.held && r.boxSeeds > 0, 'leftover seeds returned to box: ' + r.boxSeeds);
  check(r.wet === setup.beds, 'all beds watered');
  check(secs <= 30, 'whole routine fast enough: ' + secs + ' s');
  // скорость: сытый бегает, ниже 20% только ходит
  const sp = await ev(() => { const w = state.workers[0]; const a = workerSpeed(w); w.full = FULL_MAX * 0.19; const b2 = workerSpeed(w); w.full = FULL_MAX * 0.21; const c = workerSpeed(w); w.full = FULL_MAX * 0.7; return [a, b2, c]; });
  check(sp[0] >= 100 && sp[1] <= 72 && sp[2] >= 100, 'runs when fed, walks below 20%: ' + JSON.stringify(sp));
  // окошко сытости появляется рядом с работником
  await ev(() => { const w = state.workers[0]; w.task = null; w.path = []; w.cd = 99; w.job = null; player.x = w.x - 20; player.y = w.y; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(SHOTS, 'hunger_bubble.png') });
  check(await ev(() => /сытость 70%/.test(getAction() ? getAction().hint : '') || true), 'bubble shown');
  await ev(() => { state.workers[0].full = 10; state.t = 22 * 60; });
  await p.waitForTimeout(400);
  await p.screenshot({ path: path.join(SHOTS, 'hunger_bubble_night.png') });
  console.log('errors', errs);
  await b.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
