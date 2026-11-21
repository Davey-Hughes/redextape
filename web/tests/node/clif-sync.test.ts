import { describe, expect, it } from 'vitest'
import { ClifSync } from '../../src/clif-sync'
import type { Listing } from '../../src/protocol'

/** A sync whose posts are collected, in order. */
function sync(): { readonly s: ClifSync; readonly posts: (Listing | null)[] } {
  const posts: (Listing | null)[] = []
  return { s: new ClifSync((listing) => posts.push(listing)), posts }
}

describe('ClifSync', () => {
  it('posts nothing while a run is awaited, and what is wanted once it settles', () => {
    const { s, posts } = sync()
    s.ran(null)
    s.want('as-built')
    expect(posts, 'before the run settled').toEqual([])
    s.settled()
    expect(posts).toEqual(['as-built'])
  })

  it('posts a change once, and each change after it', () => {
    const { s, posts } = sync()
    s.ran(null)
    s.settled()
    s.want('as-built')
    s.want('as-built')
    s.want(null)
    expect(posts).toEqual(['as-built', null])
  })

  it('posts nothing when the run carried what is wanted', () => {
    const { s, posts } = sync()
    s.ran('as-built')
    s.want('as-built')
    s.settled()
    expect(posts).toEqual([])
  })

  it('posts what is wanted again on a retry, and nothing on one while nothing is wanted', () => {
    const { s, posts } = sync()
    s.ran(null)
    s.settled()
    s.want('as-built')
    s.retry()
    s.want(null)
    s.retry()
    expect(posts).toEqual(['as-built', 'as-built', null])
  })

  it('posts nothing from a schedule until its run settles, which then carries what is wanted', () => {
    const { s, posts } = sync()
    s.scheduled()
    s.want('as-built')
    s.retry()
    expect(posts, 'before the run was posted').toEqual([])
    s.ran('as-built')
    s.settled()
    expect(posts).toEqual([])
  })

  it('posts what is wanted once a run that carried something else settles', () => {
    const { s, posts } = sync()
    s.ran('as-built')
    s.want('as-built')
    s.settled()
    s.scheduled()
    s.ran('as-built')
    s.want(null)
    expect(posts, 'while the run was in flight').toEqual([])
    s.settled()
    expect(posts).toEqual([null])
  })
})
