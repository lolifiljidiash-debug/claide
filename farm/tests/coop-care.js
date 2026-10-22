// Проверка в браузере: node farm/tests/coop-care.js (нужен Playwright)
// куриные грядки, поилка, ящик для корма, смена поколений кур, работники с лейкой и ведром, домик работника
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
  const shot = async name => { await p.waitForTimeout(350); await p.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  // без дождей и гроз, чтобы работники не прятались
  await ev(() => { window.startRain = () => {}; state.firstRain = true; state.coins = 9000; state.t = 9 * 60; });

  // ---- куриная грядка ----
  const bed = await ev(() => {
    Object.assign(state.bag, { chickBed: 2, seedWheat: 5, seedCarrot: 5 });
    state.sel = 0; state.buildType = 'chickBed';
    const spots = [];
    for (let ty = 19; ty < 27 && spots.length < 2; ty++) for (let tx = 9; tx < 20 && spots.length < 2; tx++) {
      player.x = tx * 16 + 8; player.y = (ty - 1) * 16 + 10; player.dir = 0;
      if (!blocked(player.x, player.y) && canPlace('chickBed', tx, ty)) { act(); spots.push([tx, ty]); }
    }
    const b = state.beds.find(x => x.chick);
    state.sel = 3; state.seedType = 'seedCarrot'; player.x = b.tx * 16 + 8; player.y = (b.ty - 1) * 16 + 10; player.dir = 0;
    const h1 = getAction().hint;
    state.seedType = 'seedWheat'; act();
    return { n: state.beds.filter(x => x.chick).length, h1, crop: b.crop };
  });
  check(bed.n === 2, 'two chicken beds placed');
  check(/только пшеницу/.test(bed.h1) && bed.crop === 'wheat', 'only wheat on chicken bed: ' + bed.h1);
  const grow = await ev(() => { const b = state.beds.find(x => x.chick), n = state.beds.find(x => !x.chick); b.wet = n.wet = WET_MAX; n.crop = 'wheat'; n.prog = 0; b.prog = 0; advanceTime(100); return [Math.round(b.prog), Math.round(n.prog)]; });
  check(grow[0] > grow[1], 'chicken bed grows faster: ' + JSON.stringify(grow));
  const hv = await ev(() => { const b = state.beds.find(x => x.chick); b.prog = 999; const f0 = state.bag.feed, w0 = state.bag.wheat; harvest(b); return [state.bag.feed - f0, state.bag.wheat - w0, ITEMS.feed.sell]; });
  check(hv[0] >= 1 && hv[1] === 0 && hv[2] === undefined, 'harvest gives unsellable feed: ' + JSON.stringify(hv));

  // ---- курятник: домик, кормушка, поилка, ящик для корма ----
  await ev(() => {
    const free = (tx, ty) => canPlace('coop', tx, ty);
    const put = (type, tx, ty, extra) => { const o = Object.assign({ type, tx, ty }, extra); state.objs.push(o); return o; };
    put('coop', 30, 23, { eggs: 3 }); put('feeder', 33, 23, { grain: 0 }); put('waterer', 33, 25, { water: 0 }); put('feedbox', 28, 26, { feed: 0 });
    rebuildDyn();
    state.chickens = [];
    for (let i = 0; i < 2; i++) state.chickens.push({ ctx: 30, cty: 23, x: 30 * 16 + 8, y: 25 * 16, fed: false, layAt: 0, color: i, inside: false, face: 1, age: CHICK_GROW + 100, drankAt: state.t - THIRST - 10 });
  });
  // игрок наливает воду лейкой, кладёт корм в ящик
  const wt = await ev(() => { const o = objAt(33, 25); state.sel = 2; state.water = CAN_MAX; player.x = 33 * 16 + 8; player.y = 26 * 16 + 12; player.dir = 1; const h = getAction().hint; act(); return [h, o.water, state.water]; });
  check(/Налить воды в поилку/.test(wt[0]) && wt[1] === WATERER_CAP_JS(), 'player fills waterer: ' + JSON.stringify(wt));
  function WATERER_CAP_JS() { return 8; }
  await ev(() => { const o = objAt(28, 26); player.x = 28 * 16 + 8; player.y = 27 * 16 + 12; player.dir = 1; state.sel = 0; state.bag.feed = 12; act(); });
  await p.waitForTimeout(150);
  await click('[data-fbput="all"]');
  check(await ev(() => objAt(28, 26).feed === 12 && state.bag.feed === 0), 'feed put into feed box');
  await ev(() => closeModal());
  // курицы пьют сами
  await ev(() => { player.x = 26 * 16; player.y = 22 * 16; });
  await p.waitForTimeout(6000);
  const drank = await ev(() => state.chickens.filter(c => state.t - c.drankAt < 60).length + ' / water ' + objAt(33, 25).water);
  check(/^2 /.test(drank), 'chickens drank from waterer: ' + drank);
  await shot('coop_area');

  // ---- смена поколений ----
  const life = await ev(() => {
    const [a, c] = state.chickens; const o = [];
    a.age = LAY_END - 1; a.drankAt = state.t; c.age = LAY_END - 1; c.drankAt = state.t - 2 * DAY;
    chickenLife(2);
    o.push(state.chickens.length, state.chickens.filter(x => x.age < CHICK_GROW).length);
    // старая курица не несётся
    a.fed = true; a.layAt = 0; const e0 = objAt(30, 23).eggs; layEggs(state.t); o.push(objAt(30, 23).eggs - e0);
    a.age = DIE_AT - 1; c.age = DIE_AT - 1; chickenLife(2);
    o.push(state.chickens.length);
    const chick = state.chickens[0]; chick.age = CHICK_GROW - 1; chickenLife(2); o.push(isAdult(chick));
    return o;
  });
  check(JSON.stringify(life) === '[3,1,0,1,true]', 'hatch with water, none without; old stop laying; die; chick grows: ' + JSON.stringify(life));
  await ev(() => { const ch = state.chickens[0]; ch.age = 10; state.chickens.push({ ctx: 30, cty: 23, x: 31 * 16, y: 25 * 16, fed: true, layAt: 1e9, color: 0, inside: false, face: 1, age: CHICK_GROW + 50, drankAt: state.t }); player.x = 30 * 16; player.y = 26 * 16; });
  await shot('chick');

  // ---- работники ----
  const cabins = await ev(() => {
    Object.assign(state.bag, { wood: 200, cement: 40, cabinPlan: 2, seedbox: 1 });
    const placed = [];
    state.sel = 0; state.buildType = 'cabinPlan';
    for (let ty = 6; ty < 30 && placed.length < 2; ty++) for (let tx = 4; tx < 40 && placed.length < 2; tx++) {
      player.x = tx * 16 + 8; player.y = ty * 16 + 10; player.dir = 0;
      state.buildType = 'cabinPlan';
      if (!blocked(player.x, player.y) && planFits('cabinPlan')) { act(); placed.push([tx, ty]); }
    }
    for (const s of state.objs.filter(o => o.type === 'cabin')) buildSite(s);
    const cs = state.objs.filter(o => o.type === 'cabin' && o.built);
    const mk = (i, c, job, name, fem) => ({ id: i, name, fem, pal: i, x: c.tx * 16 + 8, y: (c.ty + 2) * 16 + 10, dir: 0, mode: 'housed', home: { tx: c.tx, ty: c.ty }, job, inside: false, carry: {}, seed: null, task: null, path: [], full: FULL_MAX, water: 0, cold: 0, dayChecked: dayNum() });
    state.workers = [mk(1, cs[0], 'beds', 'Ваня', 0), mk(2, cs[1], 'coop', 'Оля', 1)];
    return cs.length;
  });
  check(cabins === 2, 'two worker cabins built');
  // выдаём лейку через окно работы
  await ev(() => { state.bag.workerCan = 1; state.bag.bucket = 1; openJobs(state.workers[0]); });
  await p.waitForTimeout(150);
  await p.screenshot({ path: path.join(SHOTS, 'jobs_gear.png') });
  await click('[data-give="workerCan"]');
  await ev(() => { closeModal(); openJobs(state.workers[1]); });
  await click('[data-give="bucket"]');
  await ev(() => closeModal());
  check(await ev(() => state.workers[0].can && state.workers[1].bucket && !state.bag.workerCan && !state.bag.bucket), 'can and bucket given');
  // грядочник поливает сухую грядку; куриный работник собирает яйца, кормит из ящика и поит
  await ev(() => {
    for (const b of state.beds) { b.crop = 'wheat'; b.prog = 10; b.wet = 0; }
    objAt(30, 23).eggs = 3; objAt(33, 23).grain = 0; objAt(33, 25).water = 0; objAt(28, 26).feed = 12;
    state.chest.egg = 0; state.t = 9 * 60;
    player.x = 22 * 16; player.y = 24 * 16;
  });
  let res;
  for (let i = 0; i < 25; i++) {
    await p.waitForTimeout(2000);
    res = await ev(() => ({ wet: state.beds.filter(b => b.wet > 0).length, beds: state.beds.length, eggs: state.chest.egg, coopEggs: objAt(30, 23).eggs, grain: objAt(33, 23).grain, water: objAt(33, 25).water, box: objAt(28, 26).feed, w: state.workers.map(w => [w.task && w.task.kind, w.water, JSON.stringify(w.carry)]) }));
    if (res.wet === res.beds && res.eggs === 3 && res.grain > 0 && res.water > 0) { console.log('done after', (i + 1) * 2, 's'); break; }
  }
  console.log(JSON.stringify(res));
  check(res.wet === res.beds, 'beds worker watered all beds from the well');
  check(res.eggs === 3 && res.coopEggs === 0, 'coop worker delivered eggs to chest');
  check(res.grain > 0 && res.box < 12, 'coop worker fed feeder from feed box');
  check(res.water > 0, 'coop worker filled waterer with bucket');
  await shot('workers_coop');

  // ---- голод: отказ утром, скорость ----
  const sp = await ev(() => { const w = state.workers[0]; w.full = FULL_MAX; const a = workerSpeed(w); w.full = 10; const b2 = workerSpeed(w); w.full = FULL_MAX; return [a, b2]; });
  check(sp[0] > sp[1], 'fed worker walks faster: ' + JSON.stringify(sp));
  const refuse = await ev(() => { const w = state.workers[0], c = cabinOf(w); let n = 0; const R = Math.random; Math.random = () => 0.1; w.full = 5; w.dayChecked = 0; morningCheck(w, c); Math.random = R; n = w.offDay === dayNum(); w.offDay = 0; w.full = FULL_MAX; return n; });
  check(refuse, 'hungry worker refuses to work');

  // ---- домик работника: улучшения, печка, холод ----
  await ev(() => { const c = cabinOf(state.workers[0]); Object.assign(state.bag, { softBed: 1, woodrack: 1, rug: 1, book: 1, wood: 20 }); state.inCabin = { tx: c.tx, ty: c.ty }; state.scene = 'cabin'; player.x = 56; player.y = 80; player.dir = 1; });
  await p.waitForTimeout(300);
  check(await ev(() => !document.getElementById('upgBtn').hidden), 'upgrade button visible in cabin');
  await p.keyboard.press('KeyU'); await p.waitForTimeout(150);
  for (const k of ['softBed', 'woodrack', 'rug', 'book']) await click(`[data-upg="${k}"]`);
  await click('[data-rack="all"]');
  await p.screenshot({ path: path.join(SHOTS, 'cabin_upg_modal.png') });
  const up = await ev(() => { const c = cabinHere(); return [Object.keys(c.upg).sort().join(), c.stove.pile]; });
  check(up[0] === 'book,rug,softBed,woodrack' && up[1] === 10, 'upgrades installed, wood in rack: ' + JSON.stringify(up));
  await ev(() => closeModal());
  await ev(() => { const w = state.workers[0]; w.inside = true; state.t = 21 * 60; });
  await shot('cabin_upgraded');
  const sp2 = await ev(() => workerSpeed(state.workers[0]));
  check(sp2 > sp[0], 'bed and rug make worker faster: ' + sp2);
  // дровник подкидывает дрова в печку
  const rack = await ev(() => { const c = cabinHere(); c.stove.fuel = 0; cabinTick(1, true); return [c.stove.fuel > 0, c.stove.pile]; });
  check(rack[0] && rack[1] === 9, 'woodrack feeds the stove: ' + JSON.stringify(rack));
  // без дров работник мёрзнет и простужается
  const cold = await ev(() => { const c = cabinHere(), w = state.workers[0]; c.stove.fuel = 0; c.stove.pile = 0; w.cold = 0; state.rain.storm = true; cabinTick(320, true); state.rain.storm = false; const s = w.sick; w.dayChecked = 0; morningCheck(w, c); return [Math.round(w.cold), s, w.offDay === dayNum()]; });
  check(cold[1] && cold[2], 'cold worker gets sick and stays home: ' + JSON.stringify(cold));
  // книга: весёлый работник берётся за дело сразу
  check(await ev(() => { const w = state.workers[0]; w.task = { kind: 'fill', tx: WELL.tx, ty: WELL.ty }; w.full = FULL_MAX; doTask(w); return w.cd < 0.5; }), 'book makes worker eager');
  await shot('cabin_cold');
  // рекрутёр продаёт вещи для работника
  await ev(() => { state.scene = 'island'; openRecruiter(); });
  await p.waitForTimeout(200);
  const rec = await ev(() => ['workerCan', 'bucket', 'softBed', 'woodrack', 'rug', 'book'].every(k => document.querySelector(`#modalBody [data-buy="${k}"]`)));
  check(rec, 'recruiter sells worker gear and cabin upgrades');
  await p.screenshot({ path: path.join(SHOTS, 'recruiter_shop.png') });
  // миграция старого сейва
  const mig = await ev(() => { closeModal(); save(); const s = JSON.parse(localStorage.getItem(SAVE_KEY)); const c = s.objs.find(o => o.type === 'cabin'); c.plate = ['potato', 'bread']; delete c.upg; delete c.stove; for (const ch of s.chickens) { delete ch.age; delete ch.drankAt; } const p0 = s.bag.potato; const m = migrate(s); return [m.objs.find(o => o.type === 'cabin').plate.join(), m.bag.potato - p0, !!m.objs.find(o => o.type === 'cabin').stove, m.chickens.every(ch => ch.age >= CHICK_GROW)]; });
  check(JSON.stringify(mig) === '["bread",1,true,true]', 'migrate old save: ' + JSON.stringify(mig));
  console.log('errors', errs);
  await b.close();
  process.exit(fails || errs.length ? 1 : 0);
})();
