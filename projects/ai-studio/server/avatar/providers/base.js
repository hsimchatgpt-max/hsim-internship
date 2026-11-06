export class AvatarUnavailable extends Error {
  constructor(message, { setup } = {}) { super(message); this.name = 'AvatarUnavailable'; this.setup = setup; }
}
/**
 * Provider contract:
 *   id, label, kind ('local' | 'external'), capabilities {lipSync, facialAnimation, headMotion}
 *   status()  -> { ready:boolean, reason?:string, setup?:string }   (cheap, no side effects)
 *   generate({ image, audio, out, options }) -> { file }            (must produce a REAL animated, lip-synced mp4)
 * Providers must never fabricate output (e.g. a still image + audio); the registry also verifies every result.
 */
export const external = (p) => p.kind === 'external';
