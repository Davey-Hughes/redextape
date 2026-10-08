/**
 * WHICH BUILD THIS IS, WHERE ITS SOURCE IS, AND WHOSE IT IS — the about menu's foot and every page's footer read
 * these (about pages design §5, §6, §7), so the two cannot name different commits or different years.
 *
 * `VITE_COMMIT_HASH` is defined by `vite.config.ts` from the `COMMIT_HASH` the Docker build receives (CI passes
 * `--build-arg COMMIT_HASH="$SHA"`). It is empty in `pnpm dev`, in a local `pnpm build` and in a `docker build`
 * without the argument, and `buildOf` reads empty and absent alike as a dev build.
 */

/** The public mirror the forge pushes to on every commit; the forge itself sends visitors to a login page. */
export const MIRROR = 'https://github.com/Davey-Hughes/redextape'

/** What the menu and the footers say about the build, and where its source link points. */
export type Build = { readonly label: string; readonly source: string }

/**
 * `commit` as a build: `build abc1234` and the mirror's tree at that commit, or `dev build` and the mirror's `main`
 * for anything that is not a 7-to-40-digit hex hash, so a stray value never reaches a link.
 */
export function buildOf(commit: string | undefined): Build {
  const hash = commit?.trim().toLowerCase() ?? ''
  if (!/^[0-9a-f]{7,40}$/.test(hash)) return { label: 'dev build', source: `${MIRROR}/tree/main` }
  return { label: `build ${hash.slice(0, 7)}`, source: `${MIRROR}/tree/${hash}` }
}

/** This build. */
export const BUILD: Build = buildOf(import.meta.env.VITE_COMMIT_HASH)

/** The year redextape was first published, which every copyright line keeps. */
export const FIRST_YEAR = 2026

/** Who holds the copyright, as every copyright line names them. */
export const HOLDER = 'Davey Hughes'

/**
 * The copyright line on `now`: `© 2026 Davey Hughes` in 2026 and `© 2026–YYYY Davey Hughes` after it (design §7).
 * The end of the range is the viewer's clock and is never written into a file.
 */
export function copyright(now: Date): string {
  const year = now.getFullYear()
  return year > FIRST_YEAR ? `© ${FIRST_YEAR}–${year} ${HOLDER}` : `© ${FIRST_YEAR} ${HOLDER}`
}
