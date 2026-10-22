// Проверка в браузере: node farm/tests/flour-plate.js (нужен Playwright)
// мельница мелет муку (в грозу быстрее), хлеб на кухне, тарелка с едой для работника
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
  const click = async sel => { await p.click('#modalBody ' + sel); await p.waitForTimeout(50); };
  // строим мельницу, кухню и домик работника
  await ev(() => {
    state.firstRain = true; state.coins = 9000; state.t = 9 * 60;
    Object.assign(state.bag, { wood: 300, cement: 60, millPlan: 1, cabinPlan: 1, kitchenPlan: 1, wheat: 15, egg: 3, potato: 4, bakedPotato: 1 });
    const placeAt = (k, tx, ty) => { state.sel = 0; state.buildType = k; for (let y = ty; y < ty + 10; y++) for (let x = tx; x < tx + 10; x++) { player.x = x * 16 + 8; player.y = y * 16 + 10; player.dir = 0; if (!blocked(player.x, player.y) && planFits(k)) { act(); return [x, y]; } } return null; };
    placeAt('millPlan', 30, 8); placeAt('cabinPlan', 9, 18); placeAt('kitchenPlan', 19, 22);
    for (const s of state.objs.filter(o => o.w && !o.built)) buildSite(s);
  });
  check(await ev(() => state.objs.filter(o => o.w && o.built).length === 3), 'mill, cabin and kitchen built');
  // в мельницу
  await ev(() => { const m = state.objs.find(o => o.type === 'mill'); enterMill(m); });
  await p.waitForTimeout(800);
  const hint0 = await ev(() => { player.x = 72; player.y = 94; player.dir = 1; return getAction().hint; });
  check(/засыпать пшеницу/.test(hint0), 'millstone hint: ' + hint0);
  const shelf0 = await ev(() => { player.x = 30; player.y = 52; player.dir = 1; return getAction().hint; });
  check(/пока пусто/.test(shelf0), 'empty shelf: ' + shelf0);
  await ev(() => { player.x = 72; player.y = 94; player.dir = 1; act(); });
  await p.waitForTimeout(200);
  await click('[data-hopper="2"]'); await click('[data-hopper="all"]');
  check(await ev(() => millHere().hopper === 15 && state.bag.wheat === 0), 'wheat poured into hopper');
  await p.screenshot({ path: path.join(SHOTS, 'millstone_modal.png') });
  await ev(() => closeModal());
  // обычная скорость: 40 минут — 1 мешок
  check(await ev(() => { advanceTime(GRIND_TIME + 1); const m = millHere(); return m.flour === 1 && m.hopper === 13; }), 'one sack after ' + 40 + ' min');
  // в грозу втрое быстрее
  const storm = await ev(() => { startRain(500, true); const m = millHere(), f0 = m.flour; advanceTime(GRIND_TIME); return m.flour - f0; });
  check(storm === 3, 'storm grinds 3 sacks per 40 min: ' + storm);
  // повреждённая мельница стоит
  const dmg = await ev(() => { const m = millHere(); m.damaged = true; const f0 = m.flour; advanceTime(200); const r = m.flour - f0; const h = (player.x = 72, player.y = 94, player.dir = 1, getAction().hint); m.damaged = false; state.rain.on = false; state.rain.storm = false; return r + ' / ' + h; });
  check(dmg.startsWith('0 / ') && /повреждена/.test(dmg), 'damaged mill stops: ' + dmg);
  await ev(() => advanceTime(GRIND_TIME * 2));
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(SHOTS, 'mill1_flour.png') });
  // забрать муку с полки
  const took = await ev(() => { const m = millHere(), n = m.flour; player.x = 30; player.y = 52; player.dir = 1; const h = getAction().hint; act(); return [n, state.bag.flour, m.flour, h]; });
  check(took[0] > 0 && took[1] === took[0] && took[2] === 0, 'flour taken from shelf: ' + JSON.stringify(took));
  // ночёвка тоже мелет
  check(await ev(() => { const m = millHere(); m.hopper = 4; exitMill(); return true; }), 'exit mill');
  await p.waitForTimeout(800);
  // сундук принимает муку
  check(await ev(() => PRODUCE.includes('flour') && state.chest.flour === 0), 'flour sellable via chest');
  // хлеб на кухне
  const bread = await ev(() => { const k = state.objs.find(o => o.type === 'kitchen'); state.water = 10; const f0 = state.bag.flour; cook(k, 'bread'); advanceTime(91); const r = k.ready; player.x = k.tx * 16 + 16; player.y = (k.ty + 2) * 16 + 10; state.bag[r]++; k.ready = null; return [r, f0 - state.bag.flour, state.bag.bread]; });
  check(bread[0] === 'bread' && bread[1] === 1 && bread[2] === 1, 'bread baked: ' + JSON.stringify(bread));
  // работник и тарелка
  await ev(() => {
    const c = state.objs.find(o => o.type === 'cabin');
    state.workers.push({ id: 1, name: 'Даша', fem: 1, pal: 1, x: c.tx * 16 + 8, y: (c.ty + 2) * 16 + 10, dir: 0, mode: 'housed', home: { tx: c.tx, ty: c.ty }, job: 'beds', inside: false, carry: {}, seed: null, task: null, path: [], full: 30 });
    state.t = 10 * 60;
    state.inCabin = { tx: c.tx, ty: c.ty }; state.scene = 'cabin'; player.x = 50; player.y = 76; player.dir = 1;
  });
  const ph = await ev(() => getAction().hint);
  check(/Тарелка: пусто/.test(ph), 'plate hint: ' + ph);
  await ev(() => act()); await p.waitForTimeout(200);
  await click('[data-plate="bread"]'); await click('[data-plate="potato"]'); await click('[data-plate="potato"]');
  await p.screenshot({ path: path.join(SHOTS, 'plate_modal.png') });
  check(await ev(() => { const c = cabinHere(); return c.plate.join() === 'bread,potato,potato' && state.bag.bread === 0 && state.bag.potato === 2; }), 'food on plate');
  await ev(() => closeModal());
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'cabin_plate.png') });
  // работник голоден (30 < 35) — днём сам идёт домой и ест
  await p.waitForTimeout(6000);
  const ate = await ev(() => { const w = state.workers[0], c = cabinHere(); return [Math.round(w.full), c.plate.join(), w.inside]; });
  check(ate[0] >= 70 && ate[1] === 'potato,potato', 'hungry worker went home and ate: ' + JSON.stringify(ate));
  // голод во время работы
  const hungry = await ev(() => { const w = state.workers[0]; w.inside = false; w.full = 30; w.restUntil = 0; cabinHere().plate = []; state.t = 10 * 60; advanceTime(300); return [Math.round(w.full), getAction() && getAction().hint]; });
  check(hungry[0] === 0, 'worker drains while working: ' + JSON.stringify(hungry));
  const hint = await ev(() => { state.scene = 'island'; const w = state.workers[0]; w.inside = false; player.x = w.x - 14; player.y = w.y; player.dir = 2; return getAction().hint; });
  check(/голодна/.test(hint), 'hungry hint: ' + hint);
  // сохранение и миграция старого сейва
  const mig = await ev(() => { save(); const s = JSON.parse(localStorage.getItem(SAVE_KEY)); delete s.chest.flour; delete s.bag.flour; delete s.bag.bread; for (const w of s.workers) delete w.full; for (const o of s.objs) { delete o.plate; delete o.hopper; delete o.flour; } const m = migrate(s); return [m.chest.flour, m.bag.bread, m.workers[0].full, m.objs.find(o => o.type === 'cabin').plate.length, m.objs.find(o => o.type === 'mill').hopper]; });
  check(JSON.stringify(mig) === '[0,0,100,0,0]', 'migrate old save: ' + JSON.stringify(mig));
  console.log('errors', errs);
  await b.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
