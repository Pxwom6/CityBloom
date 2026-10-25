var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.ts
import { DurableObject } from "cloudflare:workers";

// protocol.ts
var PROTOCOL_VERSION = 1;
var MAX_PLAYERS = 8;
var CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 6;
var MAX_MESSAGE = 3e5;
var SNAPSHOT_PART = 2e5;
var MAX_NAME = 20;
var MAX_CHAT = 280;
var PLAYER_COLORS = [
  "#e4572e",
  "#2e86de",
  "#2bb673",
  "#f2a541",
  "#9b5de5",
  "#00b8a9",
  "#e75a9b",
  "#6c757d"
];
var DIGITS = CODE_ALPHABET.replace(/[A-Z]/g, "");
var LETTERS = CODE_ALPHABET.replace(/[0-9]/g, "");
function cleanName(input) {
  if (typeof input !== "string") return null;
  const s = input.replace(/[\u0000-\u001f\u007f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return s.length ? s : null;
}
__name(cleanName, "cleanName");
function cleanChat(input) {
  if (typeof input !== "string") return null;
  const s = input.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "").trim().slice(0, MAX_CHAT);
  return s.length ? s : null;
}
__name(cleanChat, "cleanChat");
function boundedJson(v, depth = 0) {
  if (depth > 6) return false;
  if (v === null || typeof v === "boolean") return true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "string") return v.length <= 200;
  if (Array.isArray(v)) return v.length <= 600 && v.every((x) => boundedJson(x, depth + 1));
  if (typeof v === "object") {
    const keys = Object.keys(v);
    return keys.length <= 24 && keys.every((k) => k.length <= 40 && boundedJson(v[k], depth + 1));
  }
  return false;
}
__name(boundedJson, "boundedJson");
var isInt = /* @__PURE__ */ __name((v, lo, hi) => typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi, "isInt");
var isSpeed = /* @__PURE__ */ __name((v) => v === 0 || v === 1 || v === 2 || v === 3, "isSpeed");
function parseClientMsg(raw) {
  if (raw.length > MAX_MESSAGE) return null;
  let m;
  try {
    m = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  switch (m.t) {
    case "hello": {
      const name = cleanName(m.name);
      if (!isInt(m.v, 0, 1e6) || !name || !isInt(m.color, 0, PLAYER_COLORS.length - 1)) return null;
      const out = { t: "hello", v: m.v, name, color: m.color };
      if (m.create !== void 0) {
        const c = m.create;
        if (!c || typeof c !== "object" || typeof c.cityName !== "string") return null;
        out.create = { cityName: c.cityName.slice(0, 40) };
      }
      if (m.rejoin !== void 0) {
        const r = m.rejoin;
        if (!r || !isInt(r.id, 1, 1e6) || typeof r.secret !== "string" || r.secret.length > 64 || !isInt(r.seq, -2, 1e12))
          return null;
        out.rejoin = { id: r.id, secret: r.secret, seq: r.seq };
      }
      return out;
    }
    case "cmd": {
      const cmd = m.cmd;
      if (!isInt(m.ref, 0, 1e12) || !cmd || typeof cmd !== "object" || typeof cmd.type !== "string")
        return null;
      if (JSON.stringify(cmd).length > 32e3 || !boundedJson(cmd)) return null;
      return { t: "cmd", ref: m.ref, cmd };
    }
    case "clock":
      return isInt(m.allow, 0, 1e12) ? { t: "clock", allow: m.allow } : null;
    case "status": {
      if (!isInt(m.tick, 0, 1e12) || typeof m.visible !== "boolean") return null;
      const out = { t: "status", tick: m.tick, visible: m.visible };
      if (m.sums !== void 0) {
        if (!Array.isArray(m.sums) || m.sums.length > 64) return null;
        for (const s of m.sums)
          if (!Array.isArray(s) || !isInt(s[0], 0, 1e12) || typeof s[1] !== "string" || s[1].length > 40)
            return null;
        out.sums = m.sums;
      }
      return out;
    }
    case "snap": {
      const meta = m.meta;
      if (!meta || typeof meta !== "object") return null;
      if (typeof meta.id !== "string" || meta.id.length > 40) return null;
      if (!isInt(meta.tick, 0, 1e12) || !isInt(meta.seq, -1, 1e12) || !isInt(meta.parts, 1, 400)) return null;
      if (typeof meta.eventHash !== "number" || !Number.isFinite(meta.eventHash)) return null;
      if (typeof meta.cityName !== "string" || !isInt(meta.population, 0, 1e9)) return null;
      if (!isInt(m.part, 0, meta.parts - 1) || typeof m.data !== "string" || m.data.length > SNAPSHOT_PART)
        return null;
      return {
        t: "snap",
        meta: {
          id: meta.id,
          tick: meta.tick,
          seq: meta.seq,
          eventHash: meta.eventHash,
          parts: meta.parts,
          cityName: meta.cityName.slice(0, 40),
          population: meta.population
        },
        part: m.part,
        data: m.data
      };
    }
    case "speed":
      return isSpeed(m.speed) ? { t: "speed", speed: m.speed } : null;
    case "chat": {
      const text = cleanChat(m.text);
      return text ? { t: "chat", text } : null;
    }
    case "admin": {
      const actions = ["lock", "unlock", "chatOff", "chatOn", "kick"];
      if (typeof m.action !== "string" || !actions.includes(m.action)) return null;
      if (m.player !== void 0 && !isInt(m.player, 1, 1e6)) return null;
      return {
        t: "admin",
        action: m.action,
        ...m.player !== void 0 ? { player: m.player } : {}
      };
    }
    case "bye":
      return { t: "bye" };
    default:
      return null;
  }
}
__name(parseClientMsg, "parseClientMsg");

// room.ts
var MAX_CLOCK_STEP = 30 * 60;
var CAUGHT_UP = 120;
var KEEP_SUMS = 48;
var RATE = 30;
var BURST = 90;
var META_EVERY = 15e3;
var SNAPSHOT_EVERY = 10 * 6e4;
var Room = class {
  constructor(code, kind, store, env) {
    this.store = store;
    this.env = env;
    this.info = { code, kind, locked: false, chat: true, speed: 1, pacer: 0, cityName: "" };
    const meta = store.loadMeta();
    if (meta) this.restore(meta);
  }
  store;
  env;
  static {
    __name(this, "Room");
  }
  info;
  players = /* @__PURE__ */ new Map();
  conns = /* @__PURE__ */ new Map();
  nextPlayer = 1;
  seq = -1;
  allowed = 0;
  events = [];
  kicked = /* @__PURE__ */ new Set();
  /** Snapshot parts arriving, by snapshot id. */
  incoming = /* @__PURE__ */ new Map();
  /** Players waiting for the next snapshot, and why. */
  waiting = /* @__PURE__ */ new Map();
  /** A settle asked of the pacer and not yet answered. */
  settleAsked = null;
  /** Hourly checksums by tick: player → sum. */
  sums = /* @__PURE__ */ new Map();
  metaSaved = 0;
  snapshotSeq = null;
  lastSnapshot = 0;
  /** Messages this room has received, for the free-plan accounting in tests. */
  received = 0;
  /** Does the room hold a city yet? */
  get exists() {
    return this.players.size > 0;
  }
  get online() {
    let n = 0;
    for (const p of this.players.values()) if (p.conn) n++;
    return n;
  }
  /** Brought back from the store and not yet moved on by the pacer. */
  restored = false;
  restore(meta) {
    this.restored = true;
    this.info = { ...meta.info, pacer: 0 };
    for (const p of meta.players)
      this.players.set(p.id, { ...p, visible: false, joining: false, conn: null });
    this.nextPlayer = meta.nextPlayer;
    this.seq = meta.seq;
    this.allowed = meta.allowed;
    this.kicked = new Set(meta.kicked);
    this.snapshotSeq = meta.snapshotSeq;
    this.events = this.store.loadEvents();
    for (const e of this.events) if (e.seq > this.seq) this.seq = e.seq;
  }
  /**
   * After a Durable Object wakes from hibernation: put a socket back with the player it carried.
   * Its game is in step (it was before the room slept).
   */
  reattach(conn, player) {
    const p = this.players.get(player);
    if (!p) return conn.close(4e3, "gone");
    p.conn = conn;
    p.visible = true;
    this.conns.set(conn, { player, tokens: BURST, chatTokens: 3, last: this.env.now() });
    this.choosePacer();
  }
  saveMeta() {
    this.metaSaved = this.env.now();
    this.store.saveMeta({
      info: this.info,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        host: p.host,
        secret: p.secret,
        tick: p.tick
      })),
      nextPlayer: this.nextPlayer,
      seq: this.seq,
      allowed: this.allowed,
      kicked: [...this.kicked],
      snapshotSeq: this.snapshotSeq
    });
  }
  // ---------------------------------------------------------------- connections
  open(conn) {
    this.conns.set(conn, { player: 0, tokens: BURST, chatTokens: 3, last: this.env.now() });
  }
  closed(conn) {
    const st = this.conns.get(conn);
    this.conns.delete(conn);
    if (!st?.player) return;
    const p = this.players.get(st.player);
    if (!p || p.conn !== conn) return;
    p.conn = null;
    this.waiting.delete(p.id);
    this.choosePacer();
    this.broadcastPlayers();
    this.broadcastRoom();
    if (!this.online) this.saveMeta();
  }
  message(conn, raw) {
    if (raw === "ping") return;
    this.received++;
    const st = this.conns.get(conn);
    if (!st) return;
    const now = this.env.now();
    st.tokens = Math.min(BURST, st.tokens + (now - st.last) / 1e3 * RATE);
    st.chatTokens = Math.min(3, st.chatTokens + (now - st.last) / 1e3);
    st.last = now;
    st.tokens--;
    if (st.tokens < -BURST) return this.reject(conn, "rate", "Too many messages");
    if (st.tokens < 0) return;
    const msg = parseClientMsg(raw);
    if (!msg) return this.reject(conn, "bad-message", "A message the room could not read");
    if (msg.t === "hello") return this.hello(conn, msg);
    const p = st.player ? this.players.get(st.player) : null;
    if (!p) return this.reject(conn, "bad-message", "Say hello first");
    this.handle(p, st, msg);
  }
  reject(conn, code, text) {
    conn.send({ t: "error", code, text });
    conn.close(4e3, code);
    this.closed(conn);
  }
  hello(conn, m) {
    if (m.v !== PROTOCOL_VERSION)
      return this.reject(
        conn,
        "version",
        "This room runs a different version of Citybloom: reload to update"
      );
    const st = this.conns.get(conn);
    if (st.player) return;
    if (m.create) {
      if (this.exists) return this.reject(conn, "exists", "That room code is taken");
      const p2 = this.addPlayer(conn, m.name, m.color, true);
      this.info.cityName = m.create.cityName;
      this.info.pacer = p2.id;
      p2.joining = true;
      conn.send(this.welcome(p2, "upload"));
      this.saveMeta();
      return;
    }
    if (!this.exists) return this.reject(conn, "no-room", "No room with that code");
    if (m.rejoin) {
      const p2 = this.players.get(m.rejoin.id);
      if (p2 && p2.secret === m.rejoin.secret && !this.kicked.has(p2.id)) {
        if (p2.conn && p2.conn !== conn) {
          const old = p2.conn;
          this.conns.delete(old);
          old.close(4001, "replaced");
        }
        p2.conn = conn;
        p2.name = m.name;
        p2.color = m.color;
        st.player = p2.id;
        conn.bind?.(p2.id);
        const first = this.events[0]?.seq ?? this.seq + 1;
        if (m.rejoin.seq >= first - 1 && !this.waiting.has(p2.id)) {
          p2.joining = false;
          conn.send(this.welcome(p2, "events"));
          conn.send({ t: "ev", list: this.events.filter((e) => e.seq > m.rejoin.seq), allow: this.allowed });
        } else {
          p2.joining = true;
          conn.send(this.welcome(p2, "snapshot"));
          this.serveSnapshot(p2, "join");
        }
        this.choosePacer();
        this.broadcastPlayers();
        this.broadcastRoom();
        return;
      }
      if (p2 && this.kicked.has(p2.id))
        return this.reject(conn, "kicked", "The host removed you from this room");
    }
    if (this.info.locked) return this.reject(conn, "locked", "The host has locked this room");
    if (this.online >= MAX_PLAYERS)
      return this.reject(conn, "full", `This room is full (${MAX_PLAYERS} players)`);
    const p = this.addPlayer(conn, m.name, m.color, false);
    p.joining = true;
    conn.send(this.welcome(p, "snapshot"));
    this.broadcast({ t: "notice", text: `${p.name} is joining` }, p.id);
    this.serveSnapshot(p, "join");
    this.broadcastPlayers();
    this.saveMeta();
  }
  addPlayer(conn, name, color, host) {
    const secret = Array.from({ length: 4 }, () => Math.floor(this.env.random() * 2 ** 32).toString(36)).join(
      ""
    );
    const p = {
      id: this.nextPlayer++,
      name,
      color,
      host,
      secret,
      tick: this.allowed,
      visible: true,
      joining: false,
      conn
    };
    this.players.set(p.id, p);
    this.conns.get(conn).player = p.id;
    conn.bind?.(p.id);
    return p;
  }
  welcome(p, join) {
    return { t: "welcome", you: p.id, secret: p.secret, room: this.info, players: this.playerList(), join };
  }
  // ---------------------------------------------------------------- messages
  handle(p, st, m) {
    switch (m.t) {
      case "cmd": {
        if (m.cmd.type === "cheat") {
          p.conn?.send({ t: "refused", ref: m.ref, reason: "Cheats are off in a shared city" });
          return;
        }
        this.order({ kind: "cmd", cmd: m.cmd, by: p.id, ref: m.ref });
        return;
      }
      case "clock": {
        if (p.id !== this.info.pacer) return;
        if (m.allow <= this.allowed || m.allow > this.allowed + MAX_CLOCK_STEP) return;
        this.allowed = m.allow;
        this.restored = false;
        this.broadcastEvents([]);
        const now = this.env.now();
        if (now - this.metaSaved > META_EVERY) this.saveMeta();
        if (now - this.lastSnapshot > SNAPSHOT_EVERY && this.events.length) this.askSettle("snapshot");
        return;
      }
      case "status": {
        if (this.restored && m.tick > this.allowed && m.tick <= this.allowed + MAX_CLOCK_STEP)
          this.allowed = m.tick;
        const moved = p.tick !== m.tick;
        p.tick = m.tick;
        if (moved) this.broadcast({ t: "ticks", ticks: [[p.id, p.tick]] }, p.id);
        if (p.joining && !this.waiting.has(p.id) && m.tick >= this.allowed - CAUGHT_UP) {
          p.joining = false;
          this.choosePacer();
          this.broadcastPlayers();
        }
        if (p.visible !== m.visible) {
          p.visible = m.visible;
          this.choosePacer();
          this.broadcastPlayers();
        }
        if (m.sums) for (const [tick, sum] of m.sums) this.checkSum(p, tick, sum);
        return;
      }
      case "snap":
        this.snapPart(p, m);
        return;
      case "speed":
        this.setSpeed(m.speed);
        return;
      case "chat":
        if (!this.info.chat || st.chatTokens < 1) return;
        st.chatTokens--;
        this.broadcast({ t: "chat", from: p.id, text: m.text });
        return;
      case "admin":
        if (!p.host) return;
        this.admin(m.action, m.player);
        return;
      case "bye":
        if (p.conn) {
          const c = p.conn;
          c.close(1e3, "bye");
          this.closed(c);
        }
        return;
    }
  }
  setSpeed(speed) {
    if (this.info.speed === speed) return;
    this.info.speed = speed;
    this.broadcastRoom();
    if (speed === 0) this.saveMeta();
  }
  admin(action, player) {
    if (action === "lock" || action === "unlock") this.info.locked = action === "lock";
    else if (action === "chatOff" || action === "chatOn") this.info.chat = action === "chatOn";
    else if (action === "kick" && player) {
      const target = this.players.get(player);
      if (!target || target.host) return;
      this.kicked.add(player);
      if (target.conn) {
        target.conn.send({ t: "error", code: "kicked", text: "The host removed you from this room" });
        const c = target.conn;
        c.close(4e3, "kicked");
        this.closed(c);
      }
      this.players.delete(player);
      this.broadcast({ t: "notice", text: `${target.name} was removed by the host` });
      this.broadcastPlayers();
    }
    this.broadcastRoom();
    this.saveMeta();
  }
  /** Stamp an event at the frontier and send it to everyone in step. */
  order(ev) {
    const e = { tick: this.allowed, seq: ++this.seq, ev };
    this.events.push(e);
    this.store.appendEvent(e);
    this.broadcastEvents([e]);
    return e;
  }
  broadcastEvents(list) {
    const msg = { t: "ev", list, allow: this.allowed };
    for (const p of this.players.values()) if (p.conn && !this.waiting.has(p.id)) p.conn.send(msg);
  }
  broadcast(msg, except = 0) {
    for (const p of this.players.values()) if (p.conn && p.id !== except) p.conn.send(msg);
  }
  playerList() {
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      online: !!p.conn,
      host: p.host,
      tick: p.tick,
      visible: p.visible,
      joining: p.joining
    }));
  }
  broadcastPlayers() {
    this.broadcast({ t: "players", list: this.playerList() });
  }
  broadcastRoom() {
    this.broadcast({ t: "room", room: this.info });
  }
  /**
   * The pacer: the host while their game is in front, else the first player whose game is, else
   * anyone online and in step. Background tabs are slowed by the browser, so they don't keep time.
   */
  choosePacer() {
    const ready = [...this.players.values()].filter((p) => p.conn && !p.joining).sort((a, b) => a.id - b.id);
    const pick = ready.find((p) => p.host && p.visible) ?? ready.find((p) => p.visible) ?? ready.find((p) => p.host) ?? ready[0];
    const id = pick?.id ?? 0;
    if (id !== this.info.pacer) {
      this.info.pacer = id;
      this.broadcastRoom();
    }
  }
  // ---------------------------------------------------------------- snapshots
  /** Ask the pacer's game to settle and save the city at the frontier. */
  askSettle(reason) {
    const taker = this.info.pacer;
    if (!taker) return false;
    if (this.settleAsked && this.settleAsked.taker === taker) return true;
    const e = this.order({ kind: "settle", taker, reason });
    this.settleAsked = { seq: e.seq, taker };
    this.lastSnapshot = this.env.now();
    return true;
  }
  /** Get a player the city: a fresh snapshot from the pacer if anyone's playing, else the stored one. */
  serveSnapshot(p, reason) {
    this.waiting.set(p.id, reason);
    if (this.info.pacer && this.info.pacer !== p.id && this.askSettle("snapshot")) return;
    const stored = this.snapshotSeq === null ? null : this.store.loadSnapshot();
    if (!stored) return this.reject(p.conn, "gone", "This room has no city yet: ask the host to open it");
    this.sendSnapshot(p, stored, reason);
  }
  sendSnapshot(p, s, reason) {
    this.waiting.delete(p.id);
    if (!p.conn) return;
    s.parts.forEach((data, part) => p.conn.send({ t: "snap", meta: s.meta, part, data, reason }));
    p.conn.send({ t: "ev", list: this.events.filter((e) => e.seq > s.meta.seq), allow: this.allowed });
    p.joining = true;
  }
  snapPart(p, m) {
    const upload = p.host && this.seq === -1 && this.snapshotSeq === null;
    const asked = this.settleAsked && this.settleAsked.taker === p.id && m.meta.seq === this.settleAsked.seq;
    if (!upload && !asked) return;
    let inc = this.incoming.get(m.meta.id);
    if (!inc) {
      inc = { meta: m.meta, parts: new Array(m.meta.parts).fill(null), from: p.id };
      this.incoming.set(m.meta.id, inc);
    }
    if (inc.from !== p.id || inc.meta.parts !== m.meta.parts) return;
    inc.parts[m.part] = m.data;
    if (inc.parts.some((x) => x === null)) return;
    this.incoming.delete(m.meta.id);
    const snap = { meta: inc.meta, parts: inc.parts };
    this.store.saveSnapshot(snap);
    this.snapshotSeq = snap.meta.seq;
    this.events = this.events.filter((e) => e.seq > snap.meta.seq);
    this.lastSnapshot = this.env.now();
    if (upload) {
      this.allowed = snap.meta.tick;
      this.seq = snap.meta.seq;
      this.info.cityName = snap.meta.cityName;
      p.joining = false;
      p.tick = snap.meta.tick;
      p.conn?.send({ t: "ev", list: [], allow: this.allowed });
      this.choosePacer();
      this.broadcastRoom();
      this.broadcastPlayers();
    } else {
      this.settleAsked = null;
      for (const [id, reason] of [...this.waiting]) {
        const w = this.players.get(id);
        if (w) this.sendSnapshot(w, snap, reason);
      }
      this.broadcastPlayers();
    }
    this.saveMeta();
  }
  // ---------------------------------------------------------------- out of step
  /** Compare a player's hourly checksum with the pacer's; resync whoever disagrees with the pacer. */
  checkSum(p, tick, sum) {
    let at = this.sums.get(tick);
    if (!at) {
      at = /* @__PURE__ */ new Map();
      this.sums.set(tick, at);
      if (this.sums.size > KEEP_SUMS) this.sums.delete(this.sums.keys().next().value);
    }
    at.set(p.id, sum);
    const ref = at.get(this.info.pacer);
    if (ref === void 0) return;
    for (const [id, s] of at) {
      if (id === this.info.pacer || s === ref) continue;
      const q = this.players.get(id);
      if (!q?.conn || this.waiting.has(id) || q.joining) continue;
      this.broadcast({ t: "resync", player: id, text: `${q.name}'s game fell out of step; catching up` });
      q.joining = true;
      this.serveSnapshot(q, "resync");
      this.broadcastPlayers();
    }
  }
};

// worker.ts
var PATH = new RegExp(`^/(room|signal)/([${CODE_ALPHABET}]{${CODE_LENGTH}})$`);
var worker_default = {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/health")
      return new Response("citybloom relay", { headers: { "access-control-allow-origin": "*" } });
    const m = PATH.exec(url.pathname);
    if (!m) return new Response("not found", { status: 404 });
    if (req.headers.get("Upgrade") !== "websocket")
      return new Response("expected a WebSocket", { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") ?? "";
    if (allowed.length && !allowed.includes(origin)) return new Response("forbidden", { status: 403 });
    const ns = m[1] === "room" ? env.ROOMS : env.SIGNALS;
    return ns.get(ns.idFromName(m[2])).fetch(req);
  }
};
var SqlStore = class {
  constructor(sql) {
    this.sql = sql;
    sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)");
    sql.exec("CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, ev TEXT)");
    sql.exec("CREATE TABLE IF NOT EXISTS snap (part INTEGER PRIMARY KEY, data TEXT)");
  }
  sql;
  static {
    __name(this, "SqlStore");
  }
  get(k) {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray();
    return rows[0]?.v ?? null;
  }
  put(k, v) {
    this.sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES (?, ?)", k, v);
  }
  loadMeta() {
    const v = this.get("meta");
    return v ? JSON.parse(v) : null;
  }
  saveMeta(meta) {
    this.put("meta", JSON.stringify(meta));
  }
  loadEvents() {
    return this.sql.exec("SELECT ev FROM events ORDER BY seq").toArray().map((r) => JSON.parse(r.ev));
  }
  appendEvent(e) {
    this.sql.exec("INSERT OR REPLACE INTO events (seq, ev) VALUES (?, ?)", e.seq, JSON.stringify(e));
  }
  saveSnapshot(s) {
    this.sql.exec("DELETE FROM snap");
    s.parts.forEach((data, part) => this.sql.exec("INSERT INTO snap (part, data) VALUES (?, ?)", part, data));
    this.put("snapmeta", JSON.stringify(s.meta));
    this.sql.exec("DELETE FROM events WHERE seq <= ?", s.meta.seq);
  }
  loadSnapshot() {
    const meta = this.get("snapmeta");
    if (!meta) return null;
    const parts = this.sql.exec("SELECT data FROM snap ORDER BY part").toArray().map((r) => r.data);
    return { meta: JSON.parse(meta), parts };
  }
  get code() {
    return this.get("code");
  }
  set code(c) {
    if (c) this.put("code", c);
  }
};
var RoomObject = class extends DurableObject {
  static {
    __name(this, "RoomObject");
  }
  room = null;
  store;
  conns = /* @__PURE__ */ new Map();
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new SqlStore(ctx.storage.sql);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }
  conn(ws) {
    let c = this.conns.get(ws);
    if (!c)
      this.conns.set(
        ws,
        c = {
          send: /* @__PURE__ */ __name((m) => {
            try {
              ws.send(JSON.stringify(m));
            } catch {
            }
          }, "send"),
          close: /* @__PURE__ */ __name((code, reason) => ws.close(code, reason), "close"),
          bind: /* @__PURE__ */ __name((player) => ws.serializeAttachment({ player }), "bind")
        }
      );
    return c;
  }
  /** The room, rebuilt from storage and the sockets still open after a hibernation. */
  ensure(code) {
    if (this.room) return this.room;
    const c = code ?? this.store.code;
    if (!c) return null;
    this.store.code = c;
    this.room = new Room(c, "online", this.store, { now: /* @__PURE__ */ __name(() => Date.now(), "now"), random: Math.random });
    for (const ws of this.ctx.getWebSockets()) {
      const a = ws.deserializeAttachment();
      if (a?.player) this.room.reattach(this.conn(ws), a.player);
      else this.room.open(this.conn(ws));
    }
    return this.room;
  }
  async fetch(req) {
    const code = new URL(req.url).pathname.split("/").pop();
    const room = this.ensure(code);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    room.open(this.conn(server));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    this.ensure()?.message(this.conn(ws), typeof msg === "string" ? msg : "");
  }
  async webSocketClose(ws) {
    this.ensure()?.closed(this.conn(ws));
    this.conns.delete(ws);
  }
  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }
};
var SignalObject = class extends DurableObject {
  static {
    __name(this, "SignalObject");
  }
  constructor(ctx, env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v INTEGER)");
  }
  nextId() {
    const sql = this.ctx.storage.sql;
    const rows = sql.exec("SELECT v FROM kv WHERE k = 'next'").toArray();
    const id = (rows[0]?.v ?? 0) + 1;
    sql.exec("INSERT OR REPLACE INTO kv (k, v) VALUES ('next', ?)", id);
    return id;
  }
  peers() {
    return this.ctx.getWebSockets().map((ws) => ({ ws, ...ws.deserializeAttachment() }));
  }
  async fetch() {
    const pair = new WebSocketPair();
    const peers = this.peers();
    if (peers.length >= 16) return new Response("too many", { status: 429 });
    const id = this.nextId();
    this.ctx.acceptWebSocket(pair[1], [String(id)]);
    pair[1].serializeAttachment({ id, host: false });
    const host = peers.find((p) => p.host)?.id ?? 0;
    pair[1].send(JSON.stringify({ t: "you", id, host }));
    return new Response(null, { status: 101, webSocket: pair[0] });
  }
  async webSocketMessage(ws, raw) {
    if (typeof raw !== "string" || raw.length > 16200) return;
    let m;
    try {
      m = JSON.parse(raw);
    } catch {
      return;
    }
    const me = ws.deserializeAttachment();
    const peers = this.peers();
    if (m.t === "host" && !peers.some((p) => p.host)) {
      ws.serializeAttachment({ ...me, host: true });
      for (const p of peers) if (p.id !== me.id) p.ws.send(JSON.stringify({ t: "host", id: me.id }));
    } else if (m.t === "to" && typeof m.to === "number" && typeof m.data === "string" && m.data.length <= 16e3) {
      for (const ws2 of this.ctx.getWebSockets(String(m.to)))
        ws2.send(JSON.stringify({ t: "from", from: me.id, data: m.data }));
    }
  }
  async webSocketClose(ws) {
    const me = ws.deserializeAttachment();
    if (!me) return;
    for (const p of this.peers()) if (p.id !== me.id) p.ws.send(JSON.stringify({ t: "gone", id: me.id }));
  }
};

// ../../.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-IAHrBS/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [middleware_ensure_req_body_drained_default, middleware_miniflare3_json_error_default];
var middleware_insertion_facade_default = worker_default;

// ../../.npm/_npx/c943b712072b77c4/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-IAHrBS/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(Date.now(), init.cron ?? "", () => {
          });
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(Date.now(), init.cron ?? "", () => {
        });
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(request, this.env, this.ctx, this.#dispatcher, this.#fetchDispatcher);
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  RoomObject,
  SignalObject,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
