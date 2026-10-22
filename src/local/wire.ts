// Messages between pages and the engine worker (one MessagePort per page, multiplexed by id).
export type ToEngine =
  | { k: 'open'; id: number; token: string | null; page: string }
  | { k: 'msg'; id: number; data: string | ArrayBuffer }
  | { k: 'close'; id: number }
  | { k: 'clip'; id: number; token: string | null; clip: number }
  | { k: 'link'; id: number; facility: number }
  | { k: 'ltx'; id: number; bytes: Uint8Array }
  | { k: 'lclose'; id: number }
  | { k: 'ping' }
  | { k: 'bye' };

export type FromEngine =
  | { k: 'open'; id: number }
  | { k: 'msg'; id: number; data: string | ArrayBuffer }
  | { k: 'closed'; id: number; reason?: string }
  | { k: 'clip'; id: number; wav: ArrayBuffer | null }
  | { k: 'lrx'; id: number; bytes: Uint8Array };
