/**
 * Shared cities in the game (M30): hosting a room (online, or peer-to-peer from this browser) or
 * joining one by its code, and the session that keeps this game in it. Nothing here touches the
 * network until the player opens multiplayer.
 */
import { codeKind, makeCode } from '../../relay/protocol';
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

/** How peer-to-peer players find each other: our relay's signalling if there is one, else Trystero. */
export function signalling(): Signalling {
  const url = relayUrl();
  return url ? { kind: 'relay', url } : { kind: 'trystero' };
}

/** The invite link for a room: opens the game straight into it. */
export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?join=${code}`;
}

export class Multiplayer {
  readonly session: RoomSession;
  readonly kind: 'online' | 'p2p';

  private constructor(
    readonly code: string,
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

  /** Make a room from the city the driver holds; resolves once it's open with this game in it. */
  static async host(
    kind: 'online' | 'p2p',
    driver: SimDriver,
    profile: Profile,
    cityName: string,
  ): Promise<Multiplayer> {
    const code = makeCode(Math.random, kind);
    let host: P2PHost | null = null;
    let connect: () => Promise<Link>;
    if (kind === 'online') {
      const url = relayUrl();
      if (!url) throw new Error("Online rooms aren't set up yet: host on this computer instead");
      connect = () => webSocketLink(`${url}/room/${code}`);
    } else {
      // The city lives in this browser: each snapshot the room keeps is saved here too.
      host = new P2PHost(code, signalling(), (s) => {
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
    const mp = new Multiplayer(code, connect, driver, { ...profile, create: { cityName } }, host);
    return mp;
  }

  /** Join a room by its code. */
  static join(code: string, driver: SimDriver, profile: Profile): Multiplayer {
    const kind = codeKind(code);
    let connect: () => Promise<Link>;
    if (kind === 'online') {
      const url = relayUrl();
      connect = url
        ? () => webSocketLink(`${url}/room/${code}`)
        : () => Promise.reject(new Error("Online rooms aren't set up yet, so this code can't be reached"));
    } else connect = () => p2pConnect(code, signalling());
    const again = roomCredentials(code);
    return new Multiplayer(code, connect, driver, { ...profile, ...(again ? { rejoin: again } : {}) }, null);
  }

  leave(): void {
    this.session.leave();
    this.host?.close();
  }
}
