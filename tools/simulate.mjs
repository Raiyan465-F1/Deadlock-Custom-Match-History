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

const STORE_KEY = 'cmh_matches_v1';
const WAIT_POLLS = 5;
const OTHER_ACCOUNT = '100001'; // A made-up second account on the same PC.
const FRIEND_ACCOUNT = '100002';
const LEGACY_MATCH = 99000001; // Saved by an older build with no account.
const NOT_MINE_MATCH = '99000002';
const NO_ROWS_MATCH = '99000003';

const storage = new Map(); // one browser profile, shared by every script copy
const localStorage = { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, String(v)) };
const stored = () => JSON.parse(storage.get(STORE_KEY) || '{}');
const seedUnknown = () => {
  const store = stored();
  store['0'] = [[LEGACY_MATCH, 'Standard Match', '2026-11-01 00:00 UTC']];
  storage.set(STORE_KEY, JSON.stringify(store));
};
const pending = [];

let failures = 0;
function check(name, ok) {
  console.log((ok ? 'PASS: ' : 'FAIL: ') + name);
  if (!ok) failures++;
}

function makeWorld(ids, localId) {
  const handlers = new Map();
  const registry = new Map();
  function makePanel(type, id = '') {
    const classes = new Set();
    const p = {
      type, id, text: '', style: {}, children: [], events: {},
      GetParent: () => null, AddClass: (c) => classes.add(c), RemoveClass: (c) => classes.delete(c), BHasClass: (c) => classes.has(c),
      SetHasClass: (c, on) => (on ? classes.add(c) : classes.delete(c)), SetPanelEvent: (n, f) => { p.events[n] = f; },
      RemoveAndDeleteChildren: () => { p.children.length = 0; }, DeleteAsync: () => {},
      FindChildTraverse: (w) => {
        if (w === 'CitadelPostGameNew') return world.postGame;
        if (w === 'SelfName') return world.viewed ? { accountid: Number(world.viewed) } : null;
        return registry.get(w) || null;
      },
      FindChildrenWithClassTraverse: () => [],
      SetURL: (url) => pending.push(runPage(p, url, handlers, world)),
      SetImage: (src) => { p.image = src; },
      SetScaling: (mode) => { p.scaling = mode; },
    };
    return p;
  }
  for (const id of ids) registry.set(id, makePanel('Panel', id));
  const world = {
    registry, dispatched: [], requests: [], postGame: null, viewed: null,
    setPostGame: (matchId, label, { inMatch = true, rows = 41 } = {}) => {
      const page = makePanel('Panel');
      const idLabel = makePanel('Label'); idLabel.text = `Match ${matchId}`;
      const mode = makePanel('Label'); mode.text = label;
      page.FindChildTraverse = (w) => (w === 'MatchID' ? idLabel : null);
      page.FindChildrenWithClassTraverse = (c) => {
        if (c === 'MatchMode') return [mode];
        if (c === 'IsLocalPlayer') return inMatch && rows ? [makePanel('Panel'), makePanel('Panel')] : [];
        if (c === 'Player') return Array.from({ length: rows }, () => makePanel('Panel'));
        return [];
      };
      world.postGame = page;
    },
  };
  const rootPanel = makePanel('Panel', 'root');
  const $ = {
    GetContextPanel: () => rootPanel,
    Msg: (t) => console.log('  ' + t),
    // Only the 2 second post-game poll is kept. The request timeout never fires here.
    Schedule: (s, f) => { if (s < 1) setTimeout(f, 0); else if (s === 2) world.poll = f; },
    CreatePanel: (t, parent, id, props) => {
      const c = makePanel(t, id);
      Object.assign(c, props);
      if (t === 'CitadelUserName' && props?.accountid === 'local') c.accountid = Number(localId);
      parent.children.push(c);
      return c;
    },
    RegisterEventHandler: (n, panel, f) => { const h = handlers.get(panel) || {}; h[n] = f; handlers.set(panel, h); },
    DispatchEvent: (...a) => world.dispatched.push(a.join(' ')),
    Localize: (token) => token,
  };
  vm.runInNewContext(source, { $, setTimeout, BigInt, encodeURIComponent, console });
  return world;
}

async function runPage(panel, url, handlers, world) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('unexpected url ' + url);
  world.requests.push(parsed.hash.slice(1));
  await new Promise((resolve) => {
    const doc = { set title(value) { handlers.get(panel)?.HTMLTitle?.(panel, value); resolve(); } };
    vm.runInNewContext(pageScript, { fetch, document: doc, location: { hash: parsed.hash }, localStorage, AbortController, setTimeout, clearTimeout, console });
  });
}

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 30));
    await Promise.all(pending.splice(0));
  }
};
const poll = async (world, times = 1) => {
  for (let i = 0; i < times; i++) {
    world.poll();
    await settle();
  }
};
const labels = (p) => p.children.flatMap((c) => [c.text, ...labels(c)]).filter(Boolean);
const images = (p) => p.children.flatMap((c) => [c.image, ...images(c)]).filter(Boolean);
const HISTORY_IDS = ['CmhToggle', 'CmhStatus', 'CmhList', 'CmhIdEntry', 'CmhIdOpen'];
const savedIds = (id) => (stored()[id] || []).map((s) => String(s[0]));
const cardText = (world) => world.registry.get('CmhList').children.map((card) => labels(card).join(' | '));
const hasCard = (world, id) => cardText(world).some((text) => text.includes(`Match ${id}`));
const cardFor = (world, id) => world.registry.get('CmhList').children.find((w) => labels(w).includes(`Match ${id}`));
const removeButton = (wrap) => wrap && wrap.children.find((c) => c.BHasClass('cmhRemove'));
const hiddenIds = (id) => (JSON.parse(storage.get('cmh_hidden_v1') || '{}')[id] || []).map(String);

seedUnknown();

console.log('1. Custom match ends (lobby page copy of the script)');
const lobby = makeWorld([], account);
await settle();
lobby.setPostGame(newMatch, 'Street Brawl (Lobby)');
await poll(lobby);
check('saved under the logged-in account on the first check', savedIds(account).includes(newMatch));

console.log('2. A normal match screen is ignored');
lobby.setPostGame('128652285', 'Standard Match');
await poll(lobby, WAIT_POLLS);
check('normal match not saved', !savedIds(account).includes('128652285'));

console.log('3. Same custom match seen again is not saved twice');
lobby.setPostGame(newMatch, 'Street Brawl (Lobby)');
await poll(lobby);
check('saved once', savedIds(account).filter((id) => id === newMatch).length === 1);

console.log('4. A custom match the player was not in is skipped');
lobby.setPostGame(NOT_MINE_MATCH, 'Standard Match (Lobby)', { inMatch: false });
await poll(lobby, WAIT_POLLS);
check('not saved', !JSON.stringify(stored()).includes(NOT_MINE_MATCH));

console.log('5. A custom match with no scoreboard rows is kept');
lobby.setPostGame(NO_ROWS_MATCH, 'Standard Match (Lobby)', { rows: 0 });
await poll(lobby, WAIT_POLLS - 1);
check('waits before deciding', !savedIds(account).includes(NO_ROWS_MATCH));
await poll(lobby);
check('saved after the wait', savedIds(account).includes(NO_ROWS_MATCH));
console.log('STORED:', storage.get(STORE_KEY));

console.log('6. Player opens Custom Matches (history page copy of the script)');
const page = makeWorld(HISTORY_IDS, account);
await settle();
page.registry.get('CmhToggle').events.onactivate();
await settle();
const list = page.registry.get('CmhList');
console.log('STATUS:', page.registry.get('CmhStatus').text);
for (const card of list.children) console.log('CARD:', labels(card).join(' | '), '|', images(card).join(' '));
check('matches with no account now belong to this account', savedIds(account).includes(String(LEGACY_MATCH)) && !stored()['0']);
check('the moved match is listed', hasCard(page, LEGACY_MATCH));

console.log('7. Click the first card, then paste an ID');
list.children[0].children[0].events.onactivate();
page.registry.get('CmhIdEntry').text = ` ${newMatch} `;
page.registry.get('CmhIdOpen').events.onactivate();
page.registry.get('CmhIdEntry').text = 'hello';
page.registry.get('CmhIdOpen').events.onactivate();
console.log('DISPATCHED:', page.dispatched);
console.log('STATUS:', page.registry.get('CmhStatus').text);

console.log('8. Opening a custom match saves it, and the list must keep every match');
const before = list.children.length;
page.setPostGame(newMatch, 'Standard Match (Lobby)');
await poll(page);
check(`card count stays (${before} -> ${list.children.length})`, list.children.length >= before);

console.log('9. The same page shows a friend, with no matches moving to them');
seedUnknown();
page.viewed = FRIEND_ACCOUNT;
await poll(page);
check('asks for the friend without claiming', page.requests.at(-1) === `view:${FRIEND_ACCOUNT}`);
check('no cards from this PC', list.children.length === 0);
console.log('STATUS:', page.registry.get('CmhStatus').text);
check('unknown matches stay unclaimed', !!stored()['0'] && !savedIds(FRIEND_ACCOUNT).length);
page.viewed = account;
await poll(page);
check('returns to the player', page.requests.at(-1) === `list:${account}` && hasCard(page, newMatch));
check('then claims them', !stored()['0']);
check('own cards have a remove button', list.children.length > 0 && list.children.every((w) => removeButton(w)));

console.log('10. A second account on this PC sees none of the first account\'s matches');
const other = makeWorld(HISTORY_IDS, OTHER_ACCOUNT);
await settle();
other.setPostGame('99000004', 'Standard Match (Lobby)');
await poll(other);
other.registry.get('CmhToggle').events.onactivate();
await settle();
for (const text of cardText(other)) console.log('CARD:', text);
check('its own save is under its own account', savedIds(OTHER_ACCOUNT).includes('99000004'));
check('it sees its own match', hasCard(other, '99000004'));
check('it does not see the first account\'s matches', !hasCard(other, newMatch) && !hasCard(other, LEGACY_MATCH));

console.log('11. Removing a match needs two clicks, and opening it again brings it back');
const button = removeButton(cardFor(page, LEGACY_MATCH));
button.events.onactivate();
await settle();
check('first click only asks to confirm', hasCard(page, LEGACY_MATCH) && /Confirm/.test(page.registry.get('CmhStatus').text));
removeButton(cardFor(page, LEGACY_MATCH)).events.onactivate();
await settle();
console.log('STATUS:', page.registry.get('CmhStatus').text);
check('second click removes it', !hasCard(page, LEGACY_MATCH) && !savedIds(account).includes(String(LEGACY_MATCH)));
check('it is remembered as removed', hiddenIds(account).includes(String(LEGACY_MATCH)));
check('other matches stay', hasCard(page, newMatch));
page.setPostGame(String(LEGACY_MATCH), 'Standard Match (Lobby)');
await poll(page);
check('opening it again saves it and lists it', savedIds(account).includes(String(LEGACY_MATCH)) && !hiddenIds(account).includes(String(LEGACY_MATCH)) && hasCard(page, LEGACY_MATCH));

console.log(failures ? `${failures} CHECK(S) FAILED` : 'ALL CHECKS PASSED');
if (failures) process.exit(1);
