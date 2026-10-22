// Проверка в браузере: node farm/tests/chickens.js (нужен Playwright)
const path = require('path'), fs = require('fs');
const PAGE = 'file://' + path.resolve(__dirname, '../index.html');
const SHOTS = process.env.SHOTS || path.join(require('os').tmpdir(), 'farm-shots');
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = require(require('child_process').execSync('npm root -g').toString().trim() + '/playwright');
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 900, height: 560 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(PAGE); await p.waitForTimeout(400);
  // worst case: feeder pressed to the south fence, one chicken without a coop, one stuck in a fence
  await p.evaluate(() => {
    state.objs = state.objs.filter(o => o.type !== 'spruce');
    const F = (tx, ty, type = 'fence') => state.objs.push({ type, tx, ty, open: false, eggs: 0, grain: 0 });
    for (let x = 26; x <= 31; x++) { F(x, 12); F(x, 17, x === 28 ? 'gate' : 'fence'); }
    for (let y = 13; y <= 16; y++) { F(26, y); F(31, y); }
    F(27, 14, 'coop'); state.objs.push({ type: 'feeder', tx: 30, ty: 16, grain: 6 }); rebuildDyn();
    state.chickens.push({ ctx: 27, cty: 14, x: 28 * 16, y: 14 * 16, fed: false, layAt: 0, color: 0, inside: false, face: 1 });
    state.chickens.push({ ctx: 99, cty: 99, x: 29 * 16, y: 15 * 16, fed: false, layAt: 0, color: 1, inside: false, face: 1 });
    state.chickens.push({ ctx: 27, cty: 14, x: 31 * 16 + 8, y: 15 * 16 + 11, fed: false, layAt: 0, color: 0, inside: false, face: 1 });
    window.P0 = state.chickens.map(c => [Math.round(c.x), Math.round(c.y)]);
    state.t = 8 * 60;
  });
  await p.waitForTimeout(9000);
  console.log(await p.evaluate(() => 'start ' + JSON.stringify(P0) + '\nnow ' + JSON.stringify(state.chickens.map(c => [Math.round(c.x), Math.round(c.y), c.fed, c.ctx])) + '\nfeeder grain ' + state.objs.find(o => o.type === 'feeder').grain));
  await p.evaluate(() => { state.t += 400; }); await p.waitForTimeout(300);
  console.log(await p.evaluate(() => 'eggs ' + state.objs.find(o => o.type === 'coop').eggs));
  console.log('errors', errs);
  await b.close();
})();
