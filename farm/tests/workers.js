// Проверка в браузере: node farm/tests/workers.js (нужен Playwright)
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
  const ev = async f => console.log(await p.evaluate(f));
  await ev(() => {
    state.firstRain = true; state.coins = 9000; Object.assign(state.bag, { wood: 200, cement: 40, cabinPlan: 1, kitchenPlan: 1, seedbox: 1, feeder: 1, potato: 5, carrot: 3, beet: 3, seedWheat: 10, seedCarrot: 5, wheat: 10 });
    document.getElementById('toasts').innerHTML = '';
    const o = [];
    // на лесном острове нельзя
    state.bridges.forest = 1; state.bridges.cows = 1; rebuildDyn();
    state.sel = 0; state.buildType = 'cabinPlan'; player.x = 64 * 16; player.y = 16 * 16; player.dir = 0;
    o.push('forest: ' + getAction().hint);
    const placeAt = (k, tx, ty) => { state.buildType = k; for (let y = ty; y < ty + 8; y++) for (let x = tx; x < tx + 8; x++) { player.x = x * 16 + 8; player.y = y * 16 + 10; player.dir = 0; if (!blocked(player.x, player.y) && planFits(k)) { act(); return [x, y]; } } return null; };
    o.push('cabin at ' + placeAt('cabinPlan', 9, 18) + ' kitchen at ' + placeAt('kitchenPlan', 19, 22));
    for (const s of state.objs.filter(x => x.type === 'cabin' || x.type === 'kitchen')) buildSite(s);
    o.push('built ' + state.objs.filter(x => (x.type === 'cabin' || x.type === 'kitchen') && x.built).length);
    // ящик для семян
    state.buildType = 'seedbox'; player.x = 21 * 16 + 8; player.y = 16 * 16 + 10; player.dir = 0; o.push('box: ' + getAction().hint); act();
    const box = state.objs.find(x => x.type === 'seedbox'); box.seeds.seedWheat = 6; box.seeds.seedCarrot = 3; box.seeds.wheat = 8;
    // вербовщик
    player.x = RECRUITER.tx * 16 - 8; player.y = RECRUITER.ty * 16 + 10; player.dir = 2;
    o.push('recruiter: ' + getAction().hint + ' free cabins ' + freeCabins());
    hire(); o.push('ferry ' + JSON.stringify(state.ferry));
    return o.join('\n');
  });
  await p.waitForTimeout(300);
  await p.screenshot({ path: path.join(SHOTS, 'ferry_leave.png') });
  await p.evaluate(() => { state.ferry.left = 4; });
  await p.waitForTimeout(4600);
  await p.screenshot({ path: path.join(SHOTS, 'dock.png') });
  await ev(() => { const w = state.workers[0]; player.x = w.x - 14; player.y = w.y; player.dir = 2; const h = getAction().hint; act(); return 'worker: ' + JSON.stringify({ name: w.name, mode: w.mode }) + ' hint ' + h; });
  // ведём: игрок стоит у домика, работник идёт сам по мосту
  await ev(() => { const c = state.objs.find(o => o.type === 'cabin'); player.x = c.tx * 16 + 8; player.y = (c.ty + 3) * 16 + 10; state.t = 9 * 60; return 'player at cabin ' + c.tx + ',' + c.ty; });
  for (let i = 0; i < 12; i++) { await p.waitForTimeout(1500); const r = await p.evaluate(() => { const w = state.workers[0]; return [w.mode, Math.round(w.x / 16), Math.round(w.y / 16), w.path.length]; }); if (r[0] === 'housed') { console.log('housed after', (i + 1) * 1.5, 's'); break; } if (i === 11) console.log('not housed', r); }
  // назначаем грядки
  await ev(() => {
    const w = state.workers[0]; w.restUntil = 0;
    for (const b of state.beds) { b.crop = null; b.prog = 0; }
    state.beds[0].crop = 'wheat'; state.beds[0].prog = 999; state.beds[1].crop = 'carrot'; state.beds[1].prog = 999;
    const f = { type: 'feeder', tx: 30, ty: 15, grain: 0 }; state.objs.push(f); rebuildDyn();
    setJob(w, 'beds'); state.t = 9 * 60; return 'job ' + w.job;
  });
  await p.waitForTimeout(25000);
  await ev(() => { const w = state.workers[0]; const box = state.objs.find(x => x.type === 'seedbox'); return `beds: ${state.beds.map(b => b.crop || '-').join(',')} chest ${JSON.stringify(state.chest)} feeder ${state.objs.find(o => o.type === 'feeder').grain} box ${JSON.stringify(box.seeds)} carry ${JSON.stringify(w.carry)} seed ${w.seed}`; });
  await p.screenshot({ path: path.join(SHOTS, 'worker_beds.png') });
  // курятник
  await ev(() => { const w = state.workers[0]; setJob(w, 'coop'); state.objs.find(o => o.type === 'feeder').grain = 0; return 'coop job'; });
  await p.waitForTimeout(12000);
  await ev(() => `feeder after coop job ${state.objs.find(o => o.type === 'feeder').grain} box wheat ${state.objs.find(x => x.type === 'seedbox').seeds.wheat}`);
  // кухня
  await ev(() => {
    const k = state.objs.find(o => o.type === 'kitchen'); state.water = 10;
    cook(k, 'broth'); const c1 = JSON.stringify(k.cook); player.x = k.tx * 16 + 16; player.y = (k.ty + 2) * 16 + 10; player.dir = 1;
    return 'cooking ' + c1 + ' hint ' + getAction().hint;
  });
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(SHOTS, 'kitchen.png') });
  await ev(() => { const k = state.objs.find(o => o.type === 'kitchen'); advanceTime(130); const r = k.ready; act(); state.energy = 20; quickEat(); return 'ready ' + r + ' broth ' + state.bag.broth + ' energy ' + state.energy; });
  // бег
  await ev(() => { state.energy = 50; keys.ShiftLeft = true; keys.KeyD = true; return 'run'; });
  await p.waitForTimeout(1500);
  await ev(() => { keys.ShiftLeft = false; keys.KeyD = false; return 'energy after run ' + state.energy.toFixed(1); });
  // домик изнутри
  await ev(() => { const c = state.objs.find(o => o.type === 'cabin'); const w = state.workers[0]; w.inside = true; w.restUntil = state.t + 999; state.inCabin = { tx: c.tx, ty: c.ty }; state.scene = 'cabin'; player.x = 40; player.y = 82; player.dir = 1; return 'cabin action: ' + (getAction() || {}).hint; });
  await p.waitForTimeout(400); await p.screenshot({ path: path.join(SHOTS, 'cabin_in.png') });
  await ev(() => { state.scene = 'island'; const c = state.objs.find(o => o.type === 'cabin'); player.x = c.tx * 16 + 20; player.y = (c.ty + 3) * 16 + 4; state.workers[0].restUntil = 0; state.t = 12 * 60; return 'ok'; });
  await p.waitForTimeout(1500); await p.screenshot({ path: path.join(SHOTS, 'cabin_out.png') });
  // удержание E
  await ev(() => { const w = state.workers[0]; setJob(w, 'rest'); w.path = []; w.task = null; w.cd = 99; player.x = w.x - 14; player.y = w.y; player.dir = 2; return 'hint: ' + getAction().hint; });
  await p.keyboard.down('KeyE'); await p.waitForTimeout(700); await p.keyboard.up('KeyE');
  await p.waitForTimeout(200); await p.screenshot({ path: path.join(SHOTS, 'jobs.png') });
  await ev(() => 'modal open ' + modalOpen);
  console.log('errors', errs);
  await b.close();
})();
