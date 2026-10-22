// Who may do what (port of mcommatrix/access.py). Everything in this browser is the local operator
// (as loopback is for the Python server); a link carrying a panel token (?k=) is limited to that panel.
// Tokens are HMACs of the port number with a per-installation secret kept in the engine's storage.

export interface Role { admin: boolean; gid: number | null }
export const ADMIN: Role = { admin: true, gid: null };
export const mayOperate = (r: Role, gid: number) => r.admin || r.gid === gid;

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export class Access {
  private byToken = new Map<string, number>();
  private tokens: string[] = [];
  private adminTok = '';

  static async create(secret: Uint8Array, ports: number): Promise<Access> {
    const a = new Access();
    const key = await crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = async (msg: string) => b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msg))).subarray(0, 12));
    a.adminTok = await mac('admin');
    a.tokens = await Promise.all(Array.from({ length: ports }, (_, i) => mac(`panel:${i + 1}`)));
    a.tokens.forEach((t, i) => a.byToken.set(t, i + 1));
    return a;
  }

  panelToken(gid: number): string { return this.tokens[gid - 1]; }
  adminToken(): string { return this.adminTok; }

  /** This browser is the local operator; a valid panel token narrows the role to that panel. */
  role(token: string | null): Role {
    if (token) {
      if (token === this.adminTok) return ADMIN;
      const gid = this.byToken.get(token);
      if (gid) return { admin: false, gid };
    }
    return ADMIN;
  }
}

export function newSecret(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}
