import { chmod, mkdir } from 'node:fs/promises';

/**
 * Creates `dir` with `mode`, then applies `mode` unconditionally.
 *
 * `mkdir` only honours `mode` for directories it actually creates — on an
 * existing directory the option is ignored, so an install that predates the
 * permission hardening would keep its original (typically 0755) mode forever.
 * The follow-up `chmod` is what tightens those.
 */
export async function ensureDir(dir: string, mode: number): Promise<void> {
  await mkdir(dir, { recursive: true, mode });
  try {
    await chmod(dir, mode);
  } catch (err) {
    // A directory the caller pointed us at (--in/--out) may be owned by
    // someone else. We cannot tighten it, and refusing to dump because of
    // that would be worse than leaving its mode alone. Anything else is a
    // real failure and propagates.
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EPERM' && code !== 'EACCES') throw err;
  }
}
