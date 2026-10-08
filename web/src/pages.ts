import { BUILD, type Build, copyright } from './build-info'

/**
 * THE FOUR PAGES BESIDE THE APP — about, help, licences and privacy (about pages design §4). Each is static HTML; this
 * fills what the HTML cannot know — the build, its source link and the copyright year — wherever a page marks them,
 * the footer every page shares among them. Without it a page still reads, naming a dev build and the first year.
 *
 * Each page calls `initPage` from an inline module script, so no page has an entry file of its own.
 */
export function initPage(root: ParentNode = document, now: Date = new Date(), build: Build = BUILD): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-copyright]')) el.textContent = copyright(now)
  for (const el of root.querySelectorAll<HTMLElement>('[data-build]')) el.textContent = build.label
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[data-source]')) a.href = build.source
}
