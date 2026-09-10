import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

/**
 * **THE SHAPES THIS GATE COVERS, NAMED SO A FUTURE READER KNOWS THE EDGE WITHOUT REDISCOVERING IT.**
 * Every wait in `tests/browser/` is meant to be bounded by one number, declared once, in
 * `harness.ts`. This file catches a numeric timeout that reappears at:
 *
 * - a call site, in decimal, hex, scientific, decimal-point, or underscore-grouped form, however deep
 *   the comment or string ahead of it tries to hide the separator (`isNumericLiteral`, `stripped`);
 * - a call site reached through a local alias of `until` (`import { until as X } from '<any relative
 *   specifier ending in harness>'`) or through a namespace import (`import * as X from '<the same>'`
 *   then `X.until(...)`), at any directory depth — the specifier match is on the module's name, not
 *   the literal `./harness`, so `../harness` and deeper reach it too (`untilNames`);
 * - a call site nested arbitrarily deep under `tests/browser/`, not just its top level, while still
 *   ignoring a directory whose own name happens to end in `.test.ts` (`testFilesUnder`);
 * - a file-local re-declaration of `until` itself, in either the `function until` form or the
 *   `const until = async (...) =>` form; and
 * - `harness.ts`'s own declared default, read as a whole token rather than truncated at its first
 *   non-digit character, so a hex or scientific default cannot silently read as its leading digit.
 *
 * **What it cannot see, by construction rather than oversight**: a numeric timeout reached through a
 * named constant (`until(p, 'x', SLOW_TIMEOUT)`) or any other symbolic reference; an alias created by
 * a `require`, a re-export, or a barrel file binding the same name under a second local identifier.
 * Seeing through any of these needs type or dataflow analysis, which is disproportionate to what this
 * tier needs.
 */

/**
 * **VITEST'S BROWSER-MODE `testTimeout`, MEASURED RATHER THAN LOOKED UP, AND NOT THE ONE THIS TEST
 * RUNS UNDER.** A test body in the browser project is bounded at 15,000 ms and a hook at 30,000; in the
 * node project — where this file executes — they are 5,000 and 10,000. This constant describes the
 * files being read, not the process reading them. Asking the ambient environment instead would read
 * 5,000 and flag call sites that are fine, which is exactly the wrong-instrument error this gate exists
 * downstream of.
 */
const BROWSER_TEST_TIMEOUT_MS = 15_000

/**
 * The directory scanned. `REDEXTAPE_SCAN_DIR` points it at a checkout of an older tree so the gate's
 * red half can be demonstrated without a worktree or a second `pnpm install` — see this branch's plan,
 * Task 5 Step 6. Unset in every normal run.
 */
const DIR = process.env.REDEXTAPE_SCAN_DIR
  ? `${process.env.REDEXTAPE_SCAN_DIR.replace(/\/?$/, '/')}`
  : fileURLToPath(new URL('../browser/', import.meta.url))

/** Blank out comments and string/template literals so a number inside either is never read as code. */
const stripped = (s: string): string => {
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (c === "'" || c === '"' || c === '`') {
      const q = c
      out.push(' ')
      i += 1
      while (i < s.length && s[i] !== q) {
        if (s[i] === '\\') {
          out.push(' ')
          i += 1
        }
        out.push(s[i] === '\n' ? '\n' : ' ')
        i += 1
      }
      out.push(' ')
      i += 1
    } else if (s.startsWith('//', i)) {
      while (i < s.length && s[i] !== '\n') {
        out.push(' ')
        i += 1
      }
    } else if (s.startsWith('/*', i)) {
      while (i < s.length && !s.startsWith('*/', i)) {
        out.push(s[i] === '\n' ? '\n' : ' ')
        i += 1
      }
      out.push('  ')
      i += 2
    } else {
      out.push(c as string)
      i += 1
    }
  }
  return out.join('')
}

/** Split the argument list starting just past `until(`, tracking nesting. Returns trimmed arguments. */
const argsOf = (s: string, from: number): string[] => {
  const args: string[] = []
  let cur = ''
  let depth = 1
  for (let i = from; i < s.length; i += 1) {
    const c = s[i]
    if (c === '(' || c === '[' || c === '{') depth += 1
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1
      if (depth === 0) break
    }
    if (c === ',' && depth === 1) {
      args.push(cur)
      cur = ''
    } else cur += c
  }
  args.push(cur)
  return args.map((a) => a.trim()).filter((a) => a !== '')
}

/**
 * Detect if an argument is a numeric literal in any form: decimal, hex, octal, binary, scientific,
 * or decimal-point. Returns true only for literals, not for identifiers like SLOW_TIMEOUT.
 */
const isNumericLiteral = (arg: string): boolean => {
  const bare = arg.replace(/_/g, '')
  return bare !== '' && !Number.isNaN(Number(bare))
}

/**
 * Every `.test.ts` FILE under `dir`, recursed rather than listed one level deep — the browser project's
 * own `include` is `tests/browser/**\/*.test.ts`, so a call site two directories down runs under the
 * same gate and must be scanned the same way. Checked with `dirent.isFile()` rather than a name filter
 * alone: `tests/browser/__screenshots__/` holds directories named for the test file they belong to
 * (e.g. `app.test.ts/`, holding PNGs), and a name filter alone reads a directory as readily as a file —
 * the same shape of miscount the roadmap already recorded once for a bare `find -name` over this tree.
 */
const testFilesUnder = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      out.push(...testFilesUnder(`${dir}${entry.name}/`))
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(`${dir}${entry.name}`)
    }
  }
  return out
}

/**
 * The name(s) a call in this file may invoke `until` by: `until` itself, any local alias bound by
 * `import { until as X } from '<a relative specifier ending in harness>'`, and any `X.until` reached
 * through `import * as X from '<the same>'`. Reads the RAW source, not the comment/string-stripped form
 * the rest of this scanner uses — the alias and the namespace name both live inside the import's own
 * string literal and quoted specifier, which `stripped()` blanks out along with every other string.
 *
 * **THE SPECIFIER MATCH IS ON THE MODULE'S NAME, NOT THE LITERAL `./harness`.** A file directly under
 * `tests/browser/` reaches the module as `./harness`; one recursed into a subdirectory — which is
 * exactly the shape `testFilesUnder` was added to reach — must write `../harness`, and one two levels
 * down `../../harness`. Anchoring the specifier to `./` alone matched the first and silently stopped
 * matching every other depth the moment this scanner learned to recurse: the two capabilities did not
 * compose. `[^'"]*\bharness` matches any relative prefix in front of the module's own name.
 *
 * A text scanner cannot see an alias created any other way (a `require`, a re-export, a second `import`
 * binding the same name under a different local identifier via a barrel file); this covers the two
 * shapes the tier's own convention uses.
 */
const untilNames = (raw: string): string[] => {
  const names = new Set<string>(['until'])
  const namedRe = /import\s*\{([^}]*)\}\s*from\s*['"][^'"]*\bharness['"]/g
  let m: RegExpExecArray | null = namedRe.exec(raw)
  while (m !== null) {
    for (const spec of (m[1] as string).split(',')) {
      const alias = spec.trim().match(/^until\s+as\s+(\w+)$/)
      if (alias !== null) names.add(alias[1] as string)
    }
    m = namedRe.exec(raw)
  }
  const namespaceRe = /import\s*\*\s*as\s+(\w+)\s*from\s*['"][^'"]*\bharness['"]/g
  let n: RegExpExecArray | null = namespaceRe.exec(raw)
  while (n !== null) {
    names.add(`${n[1]}.until`)
    n = namespaceRe.exec(raw)
  }
  return [...names]
}

/**
 * Scans `dir` (defaulting to the real `tests/browser/`) for a numeric argument at a call site — any
 * numeric argument, not only a timeout. `until`'s fourth parameter is `pollMs`, and the ceiling a wait
 * actually gets is `timeoutMs + pollMs`, since the throw fires only after a sleep returns; a large poll
 * interval reintroduces the defect with `timeoutMs` untouched. Both live in `harness.ts` and neither
 * belongs at a call site, so a failure here names the value rather than assuming which one it is. Takes
 * `dir` as a parameter, rather than closing over `DIR` alone, so a test below can point it at a
 * throwaway directory and prove the recursion and the alias/namespace detection compose, instead of
 * asserting each in isolation the way the defect this file exists to close slipped through.
 */
const numericTimeoutSites = (dir: string = DIR): string[] => {
  const hits: string[] = []
  for (const path of testFilesUnder(dir).sort()) {
    const name = path.slice(dir.length)
    const raw = readFileSync(path, 'utf8')
    const code = stripped(raw)
    for (const callee of untilNames(raw)) {
      // `callee` may be a plain name (`until`, an alias) or a dotted namespace call (`h.until`); escape
      // the dot so it is matched literally rather than as "any character".
      const re = new RegExp(`(?<![\\w.])${callee.replace(/\./g, '\\.')}\\(`, 'g')
      let m: RegExpExecArray | null = re.exec(code)
      while (m !== null) {
        const nums = argsOf(code, m.index + m[0].length).filter((a) => isNumericLiteral(a))
        if (nums.length > 0) {
          hits.push(`${name}:${code.slice(0, m.index).split('\n').length} passes ${nums.join(', ')}`)
        }
        m = re.exec(code)
      }
    }
  }
  return hits
}

/**
 * Read `harness.ts`'s `until` signature and return the `timeoutMs` default as a number, or throw if the
 * default is missing or is not a numeric literal the gate can read. Captures the WHOLE token up to the
 * next comma or paren, not `[\d_]+` — that pattern stops at a literal's first non-digit character, so
 * `0xea60` read as `"0"` and `6e4` read as `"6"`, both silently passing a gate meant to reject a default
 * at or above the browser bound. `isNumericLiteral` is the same check the call-site scanner above
 * trusts, applied here to the one declaration the tier is allowed to have.
 */
const declaredTimeoutMsDefault = (src: string): number => {
  const m = src.match(/timeoutMs = ([^,)]+)/)
  if (m === null) throw new Error('harness.ts does not declare a timeoutMs default')
  const token = (m[1] as string).trim()
  if (!isNumericLiteral(token)) {
    throw new Error(`harness.ts's timeoutMs default (${token}) is not a numeric literal`)
  }
  return Number(token.replace(/_/g, ''))
}

/**
 * **THE SCANNER'S OWN TEST, AND IT IS NOT CEREMONY.** An earlier scan of this tier reported "these two
 * call sites and no others" and had found 2 of 18, because it anchored on the end of the argument list
 * and every multi-line call ends with a trailing comma before its closing paren. A count is a claim
 * about the instrument as much as about the tree, so the instrument is fed a known positive of each
 * shape before any count from it is believed. This follows the repository's own convention rather than
 * inventing one: `check-doc-figures` and `check-text-bytes` both run `--self-test` before their scan,
 * for the reason the pre-commit config states — a gate that only ever runs against a passing tree
 * cannot tell you it still works.
 */
it('the scanner finds a numeric timeout in every shape a call site can take', () => {
  const cases = [
    ['multi-line with a trailing comma', "await until(\n  () => x,\n  'what',\n  60_000,\n)\n"],
    ['single line, second position', 'await until(() => x, 30_000)\n'],
    ['single line, third position', "await until(() => x, 'what', 10_000)\n"],
    ['hex literal', "await until(() => x, 'what', 0xea60)\n"],
    ['scientific notation', "await until(() => x, 'what', 6e4)\n"],
    ['decimal-point form', "await until(() => x, 'what', 60000.0)\n"],
  ] as const
  for (const [shape, src] of cases) {
    const nums = argsOf(stripped(src), src.indexOf('until(') + 'until('.length).filter((a) => isNumericLiteral(a))
    expect(nums.length, shape).toBeGreaterThan(0)
  }
})

it('the scanner does not read a number inside a comment or a string as an argument', () => {
  for (const src of ['// await until(() => x, 60_000)\n', "const s = 'until(() => x, 60_000)'\n"]) {
    expect(stripped(src).includes('until(')).toBe(false)
  }
})

/**
 * **THE SHAPE A SELF-TESTED SCANNER STILL MISSED.** A previous scan of this tier tracked string
 * literals but not comments, and reported 17 of the 18 call sites. The one it missed has a comment
 * inside its argument list, and that comment contains an apostrophe — the words "this file's own
 * default" — so the apostrophe opened a string that swallowed the separator before the number. The
 * self-test above proved three shapes of CALL; the missing case was a shape of COMMENT.
 */
it('reads a numeric argument that follows a comment containing an apostrophe', () => {
  const src = [
    'await until(',
    '  () => x,',
    "  'the first compile',",
    "  // A wider budget than this file's own default: this test pays for wasm init.",
    '  30_000,',
    ')',
    '',
  ].join('\n')
  const code = stripped(src)
  const nums = argsOf(code, code.indexOf('until(') + 'until('.length).filter((a) => isNumericLiteral(a))
  expect(nums).toEqual(['30_000'])
})

/**
 * A text scanner cannot see through a symbolic reference: `until(p, 'x', SLOW_TIMEOUT)` passes a
 * number at runtime and this gate cannot know it. Catching that needs type or dataflow analysis,
 * which is disproportionate here. This is the gate's named boundary rather than an oversight, and
 * it is stated so that a future reader knows the check's edge instead of discovering it. The
 * tier's own convention is a bare `60_000`-style literal, which is the shape the original defect
 * took in all 18 sites.
 */
it('the scanner correctly ignores a named constant', () => {
  const src = "const SLOW_TIMEOUT = 60_000\nawait until(() => x, 'body ready', SLOW_TIMEOUT)\n"
  const code = stripped(src)
  const nums = argsOf(code, code.indexOf('until(') + 'until('.length).filter((a) => isNumericLiteral(a))
  expect(nums).toEqual([])
})

/**
 * A file that imports `until` under a local name is still calling `until` — `import { until as waitFor }
 * from './harness'` then `waitFor(p, 'x', 60_000)` is a numeric-timeout call site a scanner that only
 * ever looks for the literal text `until(` cannot see. Reading the import statement needs no type
 * analysis; the alias is spelled out in the source line itself.
 */
it('the scanner treats an aliased import of until as another name for it', () => {
  const raw = "import { until as waitFor } from './harness'\nawait waitFor(() => x, 'y', 60_000)\n"
  expect(untilNames(raw)).toContain('waitFor')
  const code = stripped(raw)
  const nums = argsOf(code, code.indexOf('waitFor(') + 'waitFor('.length).filter((a) => isNumericLiteral(a))
  expect(nums).toEqual(['60_000'])
})

/**
 * **THE ALIAS REGEX WAS HARDCODED TO `'./harness'`, WHICH ONLY A TOP-LEVEL FILE WRITES.** A file one
 * directory down under `tests/browser/` — exactly the depth `testFilesUnder`'s recursion was added to
 * reach — must import the module as `../harness`, and one two levels down as `../../harness`. The old
 * regex matched none of those, so recursion and alias detection each had a passing test above and still
 * did not compose.
 */
it('untilNames matches an aliased import reached through a relative parent-directory specifier', () => {
  expect(untilNames("import { until as waitFor } from '../harness'\n")).toContain('waitFor')
  expect(untilNames("import { until as waitFor } from '../../harness'\n")).toContain('waitFor')
})

/**
 * **THE COMBINATION NEITHER OF THE TWO TESTS ABOVE EXERCISES.** `testFilesUnder`'s recursion and
 * `untilNames`'s alias detection each have their own passing test, and the defect this test guards
 * against is exactly that passing both in isolation did not prove they compose: a file reached only by
 * recursing into a subdirectory, importing `until` under a local alias through the one-level-longer
 * relative specifier that depth requires. This runs the real scanner — `numericTimeoutSites`, not a
 * hand-built stand-in — against a throwaway directory built with that exact shape, rather than
 * asserting the two capabilities separately again.
 */
it('the scanner sees a numeric timeout reached through both recursion and an aliased relative import', () => {
  const root = mkdtempSync(join(tmpdir(), 'redextape-timeout-gate-'))
  try {
    const dir = `${root}/`
    mkdirSync(`${dir}sub`)
    writeFileSync(
      `${dir}sub/zz.test.ts`,
      "import { until as waitFor } from '../harness'\nawait waitFor(() => true, 'x', 60_000)\n",
    )
    expect(numericTimeoutSites(dir)).toEqual([expect.stringMatching(/^sub\/zz\.test\.ts:\d+ passes 60_000$/)])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

/**
 * `import * as h from './harness'` then `h.until(p, 'x', 60_000)` is a numeric-timeout call site under a
 * namespace binding rather than a named one — nothing claimed to cover this shape until now, so it was a
 * gap rather than a broken promise, but it shares the same import-specifier logic as the alias fix above
 * and is cheap to close alongside it. `untilNames` returns the dotted name `h.until` for it, and the
 * call-site regex escapes the dot so it matches only that exact qualified name, proved here against an
 * unrelated `other.until(...)` in the same file, which must stay invisible exactly as a bare
 * `foo.until(...)` already was before namespace imports were covered at all.
 */
it('untilNames returns the dotted namespace-qualified name for a namespace import of harness', () => {
  const raw = "import * as h from './harness'\nawait h.until(() => x, 'y', 60_000)\n"
  expect(untilNames(raw)).toContain('h.until')
  const code = stripped(raw)
  const nums = argsOf(code, code.indexOf('h.until(') + 'h.until('.length).filter((a) => isNumericLiteral(a))
  expect(nums).toEqual(['60_000'])
})

it('the scanner sees a namespaced until call and still ignores an unrelated member call named until', () => {
  const root = mkdtempSync(join(tmpdir(), 'redextape-timeout-gate-'))
  try {
    const dir = `${root}/`
    writeFileSync(
      `${dir}zz.test.ts`,
      [
        "import * as h from './harness'",
        'const other = { until: async () => {} }',
        "await h.until(() => x, 'y', 60_000)",
        "await other.until(() => x, 'y', 30_000)",
        '',
      ].join('\n'),
    )
    expect(numericTimeoutSites(dir)).toEqual([expect.stringMatching(/^zz\.test\.ts:\d+ passes 60_000$/)])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('no until call site under tests/browser passes a numeric timeout or poll interval', () => {
  expect(numericTimeoutSites()).toEqual([])
})

/**
 * **A DECLARATION DEFAULT IS NOT A CALL-SITE ARGUMENT, AND THE SCANNER ABOVE CANNOT SEE ONE.** The
 * original defect's dominant shape — twelve of the tier's twenty-three `until` bodies — was a file-local
 * `timeoutMs = 60_000` default, not a numeric argument at a call site; `numericTimeoutSites` only ever
 * looks inside an argument list. A file that re-declares `until` locally, in either the `function until`
 * form the original twelve took or the `const until = async (...) =>` form `two-lambda-panes.test.ts`
 * shipped before this branch, is invisible to that scanner no matter what its own default is. This is
 * the check the roadmap entry for this branch ran once by hand
 * (`grep -rl "function until\|const until = async"`) and left wired to nothing; it is wired here.
 */
it('no file under tests/browser re-declares until locally', () => {
  const offenders = testFilesUnder(DIR)
    .filter((path) => /function\s+until\s*\(|const\s+until\s*=\s*async/.test(stripped(readFileSync(path, 'utf8'))))
    .map((path) => path.slice(DIR.length))
    .sort()
  expect(offenders).toEqual([])
})

it('the shared until default is below vitest browser testTimeout', () => {
  const src = readFileSync(fileURLToPath(new URL('../browser/harness.ts', import.meta.url)), 'utf8')
  expect(declaredTimeoutMsDefault(src)).toBeLessThan(BROWSER_TEST_TIMEOUT_MS)
})

/**
 * **THE GATE'S OWN SECOND NUMERIC READER HAD THE SAME BLIND SPOT THE FIRST ONE WAS FIXED FOR.**
 * `isNumericLiteral` exists because `/^[\d_]+$/` let `0xea60` and `6e4` through as call-site arguments;
 * the declaration-default reader above used `/timeoutMs = ([\d_]+)/` right next to it and had the
 * identical gap — `[\d_]+` stops at the first non-digit, so `timeoutMs = 0xea60` was captured as `"0"`
 * and `timeoutMs = 6e4` as `"6"`, both far enough under 15,000 to pass a gate that exists to catch a
 * default at or above it. These two sabotage the declaration exactly as the earlier hex/scientific
 * cases (above) sabotage the call site, and the existing sabotage the plan shipped (`15_000`, decimal)
 * could only ever exercise the half of the reader that already worked.
 */
it('the default reader captures a hex timeoutMs default in full, not its leading digit', () => {
  const src = 'export async function until(predicate, what, timeoutMs = 0xea60, pollMs = 20) {}'
  expect(declaredTimeoutMsDefault(src)).toBe(60_000)
})

it('the default reader captures a scientific-notation timeoutMs default in full, not its leading digit', () => {
  const src = 'export async function until(predicate, what, timeoutMs = 6e4, pollMs = 20) {}'
  expect(declaredTimeoutMsDefault(src)).toBe(60_000)
})
