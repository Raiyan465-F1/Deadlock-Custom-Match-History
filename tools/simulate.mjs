// Runs the mod script and docs/index.html outside the game, with fake panels and browser
// storage, so the save and list flow can be checked. The page calls the real Deadlock API.
// usage: node tools/simulate.mjs <account id> <new match id>
import fs from 'node:fs';
import vm from 'node:vm';

const [account, newMatch] = process.argv.slice(2);
if (!account || !newMatch) {
  console.error('usage: node tools/simulate.mjs <account id> <new match id>');
  process.exit(1);
}
const source = fs.readFileSync(new URL('../content/panorama/scripts/custom_match_history.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../docs/index.html', import.meta.url), 'utf8');
const pageScript = html.match(/<script>([\s\S]*)<\/script>/)[1];

const storage = new Map(); // one browser profile, shared by both script copies
const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
const pending = [];

function makeWorld(ids, postGame) {
  const handlers = new Map();
  const registry = new Map();
  function makePanel(type, id = '') {
    const classes = new Set();
    const p = {
      type, id, text: '', style: {}, children: [], events: {},
      GetParent: () => null, AddClass: (c) => classes.add(c), RemoveClass: (c) => classes.delete(c), BHasClass: (c) => classes.has(c),
      SetHasClass: (c, on) => (on ? classes.add(c) : classes.delete(c)), SetPanelEvent: (n, f) => { p.events[n] = f; },
      RemoveAndDeleteChildren: () => { p.children.length = 0; }, DeleteAsync: () => {},
      FindChildTraverse: (w) => (w === 'CitadelPostGameNew' ? world.postGame : registry.get(w) || null),
      FindChildrenWithClassTraverse: (c) => (c === 'FriendID' ? [friend] : []),
      SetURL: (url) => pending.push(runPage(p, url, handlers)),
    };
    return p;
  }
  for (const id of ids) registry.set(id, makePanel('Panel', id));
  const friend = makePanel('Label');
  friend.text = `Friend ID: ${account}`;
  const world = { registry, dispatched: [], postGame: null, makePanel };
  if (postGame) world.setPostGame = (matchId, label) => {
    const page = makePanel('Panel');
    const id = makePanel('Label'); id.text = `Match ${matchId}`;
    const mode = makePanel('Label'); mode.text = label;
    page.FindChildTraverse = (w) => (w === 'MatchID' ? id : null);
    page.FindChildrenWithClassTraverse = (c) => (c === 'MatchMode' ? [mode] : []);
    world.postGame = page;
  };
  const rootPanel = makePanel('Panel', 'root');
  const $ = {
    GetContextPanel: () => rootPanel,
    Msg: (t) => console.log('  ' + t),
    Schedule: (s, f) => { if (s < 1) setTimeout(f, 0); else world.poll = f; },
    CreatePanel: (t, parent, id) => { const c = makePanel(t, id); parent.children.push(c); return c; },
    RegisterEventHandler: (n, panel, f) => { const h = handlers.get(panel) || {}; h[n] = f; handlers.set(panel, h); },
    DispatchEvent: (...a) => world.dispatched.push(a.join(' ')),
  };
  vm.runInNewContext(source, { $, setTimeout, BigInt, encodeURIComponent, console });
  return world;
}

async function runPage(panel, url, handlers) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('unexpected url ' + url);
  await new Promise((resolve) => {
    const doc = { set title(value) { handlers.get(panel)?.HTMLTitle?.(panel, value); resolve(); } };
    vm.runInNewContext(pageScript, { fetch, document: doc, location: { hash: parsed.hash }, localStorage, AbortController, setTimeout, clearTimeout, console });
  });
}

const settle = async () => {
  await new Promise((r) => setTimeout(r, 30));
  await Promise.all(pending.splice(0));
};
const labels = (p) => p.children.flatMap((c) => [c.text, ...labels(c)]).filter(Boolean);

console.log('1. Custom match ends (end-of-match copy of the script)');
const hud = makeWorld([], true);
await settle();
hud.setPostGame(newMatch, 'Street Brawl (Lobby)');
hud.poll();
await settle();
console.log('2. A normal match screen is ignored');
hud.setPostGame('128652285', 'Standard Match');
hud.poll();
await settle();
console.log('3. Same custom match seen again is not saved twice');
hud.setPostGame(newMatch, 'Street Brawl (Lobby)');
hud.poll();
await settle();
console.log('STORED:', storage.get('cmh_matches_v1'));

console.log('4. Player opens Custom Matches (history page copy of the script)');
const page = makeWorld(['CmhToggle', 'CmhStatus', 'CmhList', 'CmhIdEntry', 'CmhIdOpen']);
await settle();
page.registry.get('CmhToggle').events.onactivate();
await settle();
const list = page.registry.get('CmhList');
console.log('STATUS:', page.registry.get('CmhStatus').text);
for (const card of list.children) console.log('CARD:', labels(card).join(' | '));

console.log('5. Click the first card, then paste an ID');
list.children[0].events.onactivate();
page.registry.get('CmhIdEntry').text = ` ${newMatch} `;
page.registry.get('CmhIdOpen').events.onactivate();
page.registry.get('CmhIdEntry').text = 'hello';
page.registry.get('CmhIdOpen').events.onactivate();
console.log('DISPATCHED:', page.dispatched);
console.log('STATUS:', page.registry.get('CmhStatus').text);
