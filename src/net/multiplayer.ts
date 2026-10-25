/**
 * Shared cities in the game (M30): hosting a room (online, or peer-to-peer from this browser) or
 * joining one by its code, and the session that keeps this game in it. Nothing here touches the
 * network until the player opens multiplayer.
 */
import { codeKind, formatInvite, makeCode, makeKey, type Invite } from '../../relay/protocol';
import { IS_TEST_BUILD } from '../config';
import type { SimDriver } from './driver';
import { webSocketLink, type Link } from './link';
import { P2PHost, p2pConnect, type Signalling } from './p2p';
import { RoomSession, type SessionOptions } from './session';
import { writeSlot } from '../client/saves';
import { decodeSnapshot } from './snapshot';
import { keepRoomCredentials, roomCredentials, type Profile } from '../client/profile';

/** The online relay's address from the build (`VITE_RELAY_URL`), or null when none is set up. */
export function relayUrl(): string | null {
  const url = (import.meta.env.VITE_RELAY_URL as string | undefined)?.trim();
  return url ? url.replace(/\/$/, '') : null;
}

/**
 * How peer-to-peer players find each other: our relay's signalling if there is one, else Trystero.
 * Test builds can try Trystero against relays on this computer (`VITE_TRYSTERO_RELAYS`, and
 * `citybloom.signal = trystero` in local storage to prefer it over the local relay).
 */
export function signalling(): Signalling {
  const url = relayUrl();
  const relays = (import.meta.env.VITE_TRYSTERO_RELAYS as string | undefined)
    ?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let prefer = false;
  try {
    prefer = IS_TEST_BUILD && localStorage.getItem('citybloom.signal') === 'trystero';
  } catch {
    /* no storage */
  }
  if (url && !prefer) return { kind: 'relay', url };
  return relays?.length ? { kind: 'trystero', relays } : { kind: 'trystero' };
}

/** The invite link for a room (its code, and its key for a room in a player's browser): opens the game straight into it. */
export function inviteLink(invite: string): string {
  return `${location.origin}${location.pathname}?join=${invite}`;
}

export class Multiplayer {
  readonly session: RoomSession;
  readonly kind: 'online' | 'p2p';

  private constructor(
    readonly code: string,
    /** A peer-to-peer room's key (F2), or null for an online room. */
    readonly key: string | null,
    connect: () => Promise<Link>,
    driver: SimDriver,
    opts: SessionOptions,
    readonly host: P2PHost | null,
  ) {
    this.kind = codeKind(code);
    this.session = new RoomSession(driver, connect, {
      ...opts,
      visible: () => typeof document === 'undefined' || document.visibilityState === 'visible',
    });
    const prev = this.session.onChange;
    this.session.onChange = () => {
      const c = this.session.credentials;
      if (c) keepRoomCredentials(code, c.id, c.secret);
      prev?.();
    };
  }

  /** What friends type or follow to join: the code, and the key for a room in this browser. */
  get invite(): string {
    return formatInvite({ code: this.code, key: this.key });
  }

  /** Make a room from the city the driver holds; resolves once it's open with this game in it. */
  static async host(
    kind: 'online' | 'p2p',
    driver: SimDriver,
    profile: Profile,
    cityName: string,
  ): Promise<Multiplayer> {
    const code = makeCode(kind);
    const key = kind === 'p2p' ? makeKey() : null;
    let host: P2PHost | null = null;
    let connect: () => Promise<Link>;
    if (kind === 'online') {
      const url = relayUrl();
      if (!url) throw new Error("Online rooms aren't set up yet: host on this computer instead");
      connect = () => webSocketLink(`${url}/room/${code}`);
    } else {
      // The city lives in this browser: each snapshot the room keeps is saved here too.
      host = new P2PHost(code, key!, signalling(), (s) => {
        try {
          const snap = decodeSnapshot(s.parts);
          void writeSlot(`room${code}`, snap.save, `Shared: ${snap.save.meta.cityName}`).catch(
            () => undefined,
          );
        } catch {
          /* a part that won't decode: the next snapshot will do */
        }
      });
      await host.listen();
      connect = () => host!.connectSelf();
    }
    const mp = new Multiplayer(code, key, connect, driver, { ...profile, create: { cityName } }, host);
    return mp;
  }

  /** Join a room by its invite (a peer-to-peer room's carries its key: see `inviteProblem`). */
  static join(invite: Invite, driver: SimDriver, profile: Profile): Multiplayer {
    const { code, key } = invite;
    const kind = codeKind(code);
    let connect: () => Promise<Link>;
    if (kind === 'online') {
      const url = relayUrl();
      connect = url
        ? () => webSocketLink(`${url}/room/${code}`)
        : () => Promise.reject(new Error("Online rooms aren't set up yet, so this code can't be reached"));
    } else connect = () => p2pConnect(code, key ?? '', signalling());
    const again = roomCredentials(code);
    return new Multiplayer(
      code,
      kind === 'p2p' ? key : null,
      connect,
      driver,
      { ...profile, ...(again ? { rejoin: again } : {}) },
      null,
    );
  }

  leave(): void {
    this.session.leave();
    this.host?.close();
  }
}
