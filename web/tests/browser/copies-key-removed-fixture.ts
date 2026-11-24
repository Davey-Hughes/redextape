/**
 * A value under `redextape.buffers` as an older build's writer left it: a λ copy bound to `lambda-0` and a TM copy
 * bound to `tm-0`. A tab still running that build can write it again, so `copies-key-removed.test.ts` and
 * `copies-key-removed-stage.test.ts` seed it before the mount, each with its own workspace. A literal, since no module
 * of the app writes the key.
 *
 * This file is not collected as a test — the browser project's `include` covers only files whose names end in
 * `.test.ts`, and this one does not.
 */
export const STORED_COPIES =
  '{"version":2,"minted":2,"buffers":[{"id":"scratch-1","label":"copy 1","text":"(\\\\a. a) (\\\\b. b)","collapsed":false,"leg":"lambda"},{"id":"scratch-2","label":"copy 2","text":"tapes 1\\nstart s\\nstate s:\\n  [*] -> write [*], move [S], goto halt\\nstate halt: accept\\n","collapsed":false,"leg":"tm"}],"bindings":{"lambda-0":"scratch-1","tm-0":"scratch-2"}}'

/** The key the app removes at every start-up (`program-store.ts`'s `forgetCopies`). */
export const COPIES_KEY = 'redextape.buffers'
