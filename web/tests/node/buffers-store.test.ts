import { describe, expect, it } from 'vitest'
import { BUFFERS_VERSION, type PersistedBuffers, parseBuffers, serializeBuffers } from '../../src/buffers-store'

/** A valid payload, used as the base every rejection below mutates one field of. */
const VALID: PersistedBuffers = {
  minted: 2,
  buffers: [
    { id: 'scratch-1', label: 'scratch 1', text: '(\\x. x)', collapsed: false, leg: 'lambda' },
    { id: 'scratch-2', label: 'scratch 2', text: '(\\y. y) (\\z. z)', collapsed: true, leg: 'lambda' },
  ],
  bindings: { 'lambda-0': 'scratch-1' },
}

/** Build a raw string with `envelope` merged over a valid one — the shape a hand-edit produces. */
function raw(envelope: Record<string, unknown>): string {
  return JSON.stringify({ version: BUFFERS_VERSION, ...VALID, ...envelope })
}

describe('parseBuffers', () => {
  it('round-trips a valid payload', () => {
    expect(parseBuffers(serializeBuffers(VALID))).toEqual(VALID)
  })

  it('answers null for nothing stored', () => {
    expect(parseBuffers(null)).toBeNull()
  })

  it('answers null for text that is not JSON', () => {
    expect(parseBuffers('{not json')).toBeNull()
  })

  it('answers null for a wrong version', () => {
    expect(parseBuffers(JSON.stringify({ version: BUFFERS_VERSION + 1, ...VALID }))).toBeNull()
  })

  it('answers null for a missing version', () => {
    expect(parseBuffers(JSON.stringify(VALID))).toBeNull()
  })

  it('answers null when buffers is not an array', () => {
    expect(parseBuffers(raw({ buffers: {} }))).toBeNull()
  })

  it('answers null when bindings is not a plain object', () => {
    expect(parseBuffers(raw({ bindings: ['scratch-1'] }))).toBeNull()
  })

  it('answers null for a duplicate id', () => {
    expect(
      parseBuffers(
        raw({
          buffers: [VALID.buffers[0], { ...VALID.buffers[1], id: 'scratch-1' }],
        }),
      ),
    ).toBeNull()
  })

  // THE COLLISION `#minted`'s DOC EXISTS TO PREVENT: a counter below an id it already holds lets the
  // next fork mint `scratch-2` while a live `scratch-2` is on the page.
  it('answers null when minted is below an id the payload already claims', () => {
    expect(parseBuffers(raw({ minted: 1 }))).toBeNull()
  })

  it('accepts a minted above every id, which a retire produces', () => {
    expect(parseBuffers(raw({ minted: 9 }))).not.toBeNull()
  })

  it('answers null for a non-string text', () => {
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], text: 42 }] }))).toBeNull()
  })

  it('answers null for a non-boolean collapsed', () => {
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], collapsed: 'yes' }] }))).toBeNull()
  })

  it('answers null for a leg that is neither lambda nor tm', () => {
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], leg: 'source' }] }))).toBeNull()
  })

  // THE OTHER LEG IS ACCEPTED TOO — this rejects only a leg outside `Leg`, not `'tm'` itself.
  it('accepts a tm buffer', () => {
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], leg: 'tm' }] }))?.buffers[0]?.leg).toBe('tm')
  })

  it('answers null for a binding naming no buffer in the same payload', () => {
    expect(parseBuffers(raw({ bindings: { 'lambda-0': 'scratch-7' } }))).toBeNull()
  })

  it('accepts two leaves bound to one buffer, which two panes on one buffer produce', () => {
    expect(parseBuffers(raw({ bindings: { 'lambda-0': 'scratch-1', 'pane-3': 'scratch-1' } }))).not.toBeNull()
  })

  // NO TEXT CAP, AND THIS TEST IS THE DECISION (design §4.1): the quota is the bound, not a number
  // invented here, and a user may legitimately type a term longer than any constant would allow.
  it('accepts a very long term', () => {
    const long = 'x'.repeat(200_000)
    expect(parseBuffers(raw({ buffers: [{ ...VALID.buffers[0], text: long }] }))?.buffers[0]?.text).toBe(long)
  })

  it('answers null for a version: 1 payload', () => {
    /**
     * Version 1 payloads have no `leg` field on buffers, so parsing them is the only way to detect the old
     * schema. A stale payload is garbage, not something to migrate — the version must be explicit about
     * the contract. This test exercises the version check in parseBuffers, which runs before any buffer
     * validation.
     */
    expect(BUFFERS_VERSION).toBeGreaterThan(1)
    // Literal 1 is correct here: the whole point is that a *stale* version is refused. This test must not
    // use BUFFERS_VERSION or a future bump will silently exercise a different branch.
    expect(parseBuffers(JSON.stringify({ version: 1, ...VALID }))).toBeNull()
  })

  it('answers null for a v2 buffer missing the leg field', () => {
    /**
     * The `leg` field is required on all buffers in version 2. A buffer without it (whether hand-edited or
     * half-migrated) must be rejected, which distinguishes it from a leg with a wrong value. This test
     * exercises the leg membership check in validBuffer, which rejects both missing and invalid leg values.
     */
    expect(
      parseBuffers(
        raw({
          buffers: [{ ...VALID.buffers[0], leg: undefined }],
        }),
      ),
    ).toBeNull()
  })
})
