// 1st Sight server. Run: npm install && npm start  (then open http://localhost:3000)
// The server is authoritative for positions, coins, invites, gifts and relationship state.
const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const io = new Server(server);

// Each location has its own room and its own gift shop.
const LOCS = {
  kozhikode: { name: 'Kozhikode Beach', gifts: [
    { id: 'flowers', name: 'Jasmine flowers', cost: 20, gain: 25 },
    { id: 'halwa', name: 'Kozhikode halwa', cost: 30, gain: 25 }] },
  fortkochi: { name: 'Fort Kochi', gifts: [
    { id: 'spices', name: 'Spice box', cost: 25, gain: 25 },
    { id: 'mask', name: 'Kathakali mask', cost: 40, gain: 35 }] },
  munnar: { name: 'Munnar Tea Gardens', gifts: [
    { id: 'tea', name: 'Fresh tea leaves', cost: 20, gain: 25 },
    { id: 'cardamom', name: 'Cardamom hamper', cost: 35, gain: 30 }] },
  kovalam: { name: 'Kovalam, Thiruvananthapuram', gifts: [
    { id: 'shell', name: 'Seashell charm', cost: 20, gain: 25 },
    { id: 'lighthouse', name: 'Lighthouse souvenir', cost: 35, gain: 30 }] },
  varkala: { name: 'Varkala Cliff Beach', gifts: [
    { id: 'anklet', name: 'Beach anklet', cost: 25, gain: 25 },
    { id: 'dinner', name: 'Cliffside sunset dinner', cost: 40, gain: 35 }] },
  alleppey: { name: 'Alleppey Backwaters', gifts: [
    { id: 'lotus', name: 'Lotus flower', cost: 20, gain: 25 },
    { id: 'houseboat', name: 'Houseboat cruise', cost: 45, gain: 40 }] },
  athirappilly: { name: 'Athirappilly Falls', gifts: [
    { id: 'orchid', name: 'Wild orchid', cost: 20, gain: 25 },
    { id: 'photo', name: 'Waterfall photo print', cost: 30, gain: 25 }] },
  bekal: { name: 'Bekal Fort, Kasaragod', gifts: [
    { id: 'keychain', name: 'Fort keychain', cost: 20, gain: 25 },
    { id: 'scarf', name: 'Kasaragod silk scarf', cost: 40, gain: 35 }] }
};
const COLORS = [0x2a9d8f, 0xe0476c, 0x6a4c93, 0xf2b134, 0x4a7fd1, 0xd1603d];
const INVITE_TTL = 15000, INVITE_RANGE = 4;
let colorIdx = 0;
const players = new Map();   // socket id -> player
const invites = new Map();   // target id -> { from, t }

const clamp = (v, a, b) => Math.min(b, Math.max(a, Number(v) || 0));
const room = l => 'loc:' + l;
const inLoc = l => [...players.values()].filter(q => q.loc === l);
const pub = p => ({ id: p.id, name: p.name, color: p.color, x: p.x, z: p.z, ry: p.ry, status: p.status, partner: p.partner });
const sendMe = p => io.to(p.id).emit('me', { coins: Math.floor(p.coins), status: p.status, partner: p.partner, chem: p.date ? p.date.chem : 0 });

function endDate(p, reason = 'ended') {
  const d = p.date; if (!d) return;
  for (const id of [d.a, d.b]) {
    const q = players.get(id); if (!q) continue;
    q.date = null; q.status = 'strangers'; q.partner = null;
    io.to(id).emit('date:end', { reason }); sendMe(q);
  }
}

io.on('connection', s => {
  s.on('join', ({ name, loc } = {}) => {
    let p = players.get(s.id);
    if (p) { endDate(p); s.leave(room(p.loc)); }
    else { p = { id: s.id, coins: 100, color: COLORS[colorIdx++ % COLORS.length], status: 'strangers', partner: null, date: null }; players.set(s.id, p); }
    loc = LOCS[loc] ? loc : 'kozhikode';
    Object.assign(p, { name: String(name || '').replace(/[<>&"']/g, '').trim().slice(0, 16) || 'Guest', loc, x: Math.random() * 8 - 4, z: 14, ry: 0 });
    s.join(room(loc));
    s.emit('init', { id: s.id, loc, cfg: LOCS[loc], players: inLoc(loc).map(pub) });
    sendMe(p);
  });

  s.on('move', ({ x, z, ry } = {}) => {
    const p = players.get(s.id); if (!p) return;
    p.x = clamp(x, -38, 38); p.z = clamp(z, -18, 38); p.ry = Number(ry) || 0;
  });

  s.on('invite', ({ to } = {}) => {
    const p = players.get(s.id), q = players.get(to);
    if (!p || !q || p === q || p.loc !== q.loc) return;
    if (p.status !== 'strangers' || q.status !== 'strangers') return;
    if (Math.hypot(p.x - q.x, p.z - q.z) > INVITE_RANGE) return;   // proximity is checked server-side
    invites.set(q.id, { from: p.id, t: Date.now() });
    io.to(q.id).emit('invited', { from: p.id, name: p.name });
  });

  s.on('respond', ({ accept } = {}) => {
    const p = players.get(s.id), inv = invites.get(s.id); invites.delete(s.id);
    if (!p || !inv || Date.now() - inv.t > INVITE_TTL) return;
    const from = players.get(inv.from);
    if (!from || from.status !== 'strangers' || p.status !== 'strangers') return;
    if (!accept) return io.to(from.id).emit('toast', p.name + ' declined');
    const d = { a: from.id, b: p.id, chem: 0, commit: new Set() };
    for (const [x, y] of [[from, p], [p, from]]) { x.date = d; x.status = 'date'; x.partner = y.id; sendMe(x); }
  });

  s.on('gift', ({ id } = {}) => {
    const p = players.get(s.id), d = p && p.date;
    if (!d || p.status !== 'date') return;
    const g = LOCS[p.loc].gifts.find(x => x.id === id);
    if (!g || p.coins < g.cost) return;
    p.coins -= g.cost; d.chem = Math.min(100, d.chem + g.gain);
    for (const i of [d.a, d.b]) { io.to(i).emit('gift', { name: g.name, by: p.name }); sendMe(players.get(i)); }
  });

  s.on('commit', () => {          // both players must press Commit
    const p = players.get(s.id), d = p && p.date, q = p && players.get(p.partner);
    if (!d || !q || p.status !== 'date' || d.chem < 100) return;
    d.commit.add(p.id);
    if (d.commit.size === 2) {
      for (const x of [p, q]) { x.status = 'couple'; io.to(x.id).emit('toast', 'You are a couple. Couple garden unlocked'); sendMe(x); }
    } else { io.to(q.id).emit('toast', p.name + ' wants to commit'); s.emit('toast', 'Waiting for ' + q.name); }
  });

  s.on('emote', () => {
    const p = players.get(s.id);
    if (p && p.status === 'couple') io.to(room(p.loc)).emit('emote', { id: p.id });
  });

  s.on('end', () => { const p = players.get(s.id); if (p) endDate(p, 'ended'); });

  s.on('disconnect', () => {
    const p = players.get(s.id); if (!p) return;
    endDate(p, 'left'); invites.delete(s.id); players.delete(s.id);
  });
});

// 10 Hz snapshots per location room; passive coin refill every 2 s.
setInterval(() => { for (const l in LOCS) io.to(room(l)).emit('state', inLoc(l).map(pub)); }, 100);
setInterval(() => { for (const p of players.values()) if (p.coins < 200) { p.coins += 1; sendMe(p); } }, 2000);

server.listen(process.env.PORT || 3000, () => console.log('1st Sight on http://localhost:' + (process.env.PORT || 3000)));
