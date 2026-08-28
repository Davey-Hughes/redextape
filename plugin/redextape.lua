-- Neovim support for this repository's four tree-sitter grammars, carried by the repository itself.
--
-- WHY THIS FILE IS AT THE REPOSITORY ROOT RATHER THAN IN SOMEONE'S DOTFILES. lazy.nvim sources
-- `plugin/**/*.lua` from a plugin's root directory when it loads that plugin, so
-- `{ "Davey-Hughes/redextape", lazy = false }` is the whole user-side configuration — no snippet to
-- copy, and nothing to keep in step with `grammars/` by hand.
--
-- `lazy = false` is load-bearing. Filetype registration has to happen at startup, and a lazy-loaded
-- spec would not register the extensions until something had already loaded it — which nothing would,
-- since loading is what the filetype is for.
--
-- THIS FILE TARGETS NVIM-TREESITTER'S `main` BRANCH, which needs Neovim 0.12+. `main` and `master` are
-- incompatible plugins sharing a name: `master` wants `get_parser_configs()` and never fires
-- `User TSUpdate`, so the registration below silently does nothing there. That is not left to be
-- discovered — the FileType handler at the bottom detects a missing parser and says so once, naming
-- the two reasons it can happen.
--
-- THIS FILE IS NOT AUTHORITATIVE ABOUT ANYTHING. It installs grammars that
-- `crates/redextape-grammar-check` already holds span-for-span against `classify_source`. It cannot
-- make a wrong program; the worst it can do is a wrong colour.

if vim.g.loaded_redextape then
  return
end
vim.g.loaded_redextape = true

-- Resolved from this script's own path rather than hardcoded, so the same file works from a lazy.nvim
-- clone, a manual clone and a local development checkout without knowing which it is in.
--
-- The `@` test is not decoration. Lua sets `source` to `"@" .. path` only for a chunk loaded FROM A
-- FILE; a chunk built with `load()` from a string carries the source text itself, and blindly calling
-- `:sub(2)` there would strip a real character and hand `install_info.path` a directory that does not
-- exist — which surfaces four commits later as `Error during "tree-sitter build"` with nothing
-- pointing at the cause.
local chunk = debug.getinfo(1, "S").source
if chunk:sub(1, 1) ~= "@" then
  return
end
local ROOT = vim.fs.normalize(vim.fn.fnamemodify(chunk:sub(2), ":p:h:h"))

-- Keyed by PARSER NAME, which is not a free choice: every editor loads a parser by looking up the C
-- symbol `tree_sitter_<name>`, so these four must match what `src/parser.c` exports in each directory.
-- Getting one wrong loads a different language rather than failing to find one, because all four are
-- built from this one checkout. `scripts/check-lua.sh` is what actually holds the two in step.
local GRAMMARS = {
  redextape = "tree-sitter-redextape",
  redextape_asm = "tree-sitter-redextape-asm",
  redextape_lambda = "tree-sitter-redextape-lambda",
  redextape_tm = "tree-sitter-redextape-tm",
}

local FILETYPES = { "redextape", "redextape_asm", "redextape_lambda", "redextape_tm" }

local group = vim.api.nvim_create_augroup("redextape", { clear = true })

-- REGISTRATION MUST HAPPEN INSIDE THIS AUTOCMD. nvim-treesitter's installer calls `reload_parsers()`
-- before every install, which drops `package.loaded["nvim-treesitter.parsers"]` and then fires
-- `User TSUpdate` — so a table assigned at startup is discarded before the install ever reads it, and
-- `:TSInstall` answers with four `skipping unsupported language` warnings having done nothing.
--
-- `pcall` because nvim-treesitter is not a hard dependency of this repository: someone cloning it for
-- the Rust workspace and happening to have this on their runtimepath should get nothing, not an error.
vim.api.nvim_create_autocmd("User", {
  group = group,
  pattern = "TSUpdate",
  callback = function()
    local ok, parsers = pcall(require, "nvim-treesitter.parsers")
    if not ok or type(parsers) ~= "table" then
      return
    end
    for lang, dir in pairs(GRAMMARS) do
      parsers[lang] = {
        install_info = {
          -- `path` rather than `url`: build straight out of this checkout. It skips downloading the
          -- whole repository once per grammar, and it is what makes the installer SYMLINK the query
          -- files instead of copying them.
          --
          -- TWO CONSEQUENCES OF THAT SYMLINK, AND ONLY ONE OF THEM IS PLEASANT. An edit to a
          -- `queries/highlights.scm` here reaches the editor on the next `:e` with no reinstall.
          -- But the compiled `parser.so` is a SNAPSHOT taken at install time, so after a
          -- `:Lazy update` that adds a node type and a query pattern using it, the new query is
          -- read against the old parser and `vim.treesitter.query.parse` raises `Invalid node
          -- type` until `:TSUpdate` runs. Pair a grammar update with `:TSUpdate`.
          --
          -- Also: with no `revision` to compare, nvim-treesitter's `needs_update` can never answer
          -- "no", so every `:TSUpdate` rebuilds all four and rewrites `grammars/*/parser.so` into
          -- this checkout. `.gitignore` covers those four; the rebuild cost is real but small.
          path = ROOT,
          location = "grammars/" .. dir,
          -- JOINED TO `ROOT`, NOT TO `location`. The installer applies `location` to the compile
          -- directory and resolves `queries` against the clone root separately, so the intuitive
          -- short form `queries = "queries"` points at a directory that does not exist here.
          -- Nothing errors; the highlights simply do not get installed.
          queries = "grammars/" .. dir .. "/queries",
        },
      }
    end
  end,
})

-- TWO EXTENSIONS ARE OURS ALONE AND TWO ARE CONTESTED, SO THEY ARE CLAIMED TWO DIFFERENT WAYS.
--
-- `.rxt` and `.rxlambda` are unique to this project, so a plain extension mapping is right.
--
-- `.asm` and `.tm` are not. Neovim already maps `.asm` to `asm` and `.tm` to `tcl` — TeXmacs is the
-- collision the asm and TM READMEs name for `.tm`, but Neovim's own answer is `tcl`, a second one.
--
-- SO THEY ARE CLAIMED BY A PATTERN-KEYED FUNCTION THAT SNIFFS THE BUFFER, AND THE DIFFERENCE BETWEEN
-- THE TWO KEYS IS THE WHOLE DESIGN. A function under `extension` REPLACES the built-in mapping, and
-- returning `nil` from it does not fall back — measured, a NASM listing and a TeXmacs document both
-- came back with an EMPTY filetype under that shape. A function under `pattern` does fall back:
-- returning `nil` leaves `asm` and `tcl` exactly as they were. Measured over a corpus of six Tcl
-- modules, two MASM listings (one of them ARM64, which also writes `#` immediates), a NASM listing
-- and a TeXmacs document: none is touched, and every artifact this project emits is claimed —
-- including from a directory with no `redextape` component in its path.
--
-- The path test is a fallback for the case content cannot answer: a NEW, EMPTY `.tm` or `.asm` buffer
-- inside a checkout has nothing to sniff yet.
--
-- Neither route helps an uppercase `.ASM` or `.TM`. `redextape run` dispatches on extension
-- ASCII-case-insensitively and will happily run `P.ASM`; these patterns are case-sensitive.
local function head(bufnr)
  return table.concat(vim.api.nvim_buf_get_lines(bufnr, 0, 60, false), "\n")
end

local function sniff_tm(path, bufnr)
  local text = head(bufnr)
  -- `tapes N` opens every machine `print_tm_inner` writes; `state <name>:` opens every block.
  if text:match("%f[%w]tapes%s+%d") or text:match("%f[%w]state%s+[%w_.]+%s*:") then
    return "redextape_tm"
  end
  if path:match("/redextape/") then
    return "redextape_tm"
  end
end

local function sniff_asm(path, bufnr)
  local text = head(bufnr)
  -- The emitted header, then the `result` type line, then mnemonics no real assembler has. `mov`,
  -- `add`, `jmp`, `ret` and `cmp` are all x86 or ARM as well, so none of them is a signal on its own.
  if text:match("Register%-assembly listing") then
    return "redextape_asm"
  end
  if text:match("^result%s+%u") or text:match("\nresult%s+%u") then
    return "redextape_asm"
  end
  for _, pat in ipairs({
    "%f[%w]li%s+[ra][r%d]",
    "%f[%w]cmp[a-z][a-z]%s+[ra][r%d]",
    "%f[%w]isempty%s+[ra][r%d]",
    "%f[%w]box_[gs]et%s+[ra][r%d]",
    "%f[%w]cons%s+[ra][r%d]",
    "%f[%w]head%s+[ra][r%d]",
    "%f[%w]tail%s+[ra][r%d]",
    "%f[%w]nil%s+[ra][r%d]",
  }) do
    if text:match(pat) then
      return "redextape_asm"
    end
  end
  if path:match("/redextape/") then
    return "redextape_asm"
  end
end

vim.filetype.add({
  extension = {
    rxt = "redextape",
    rxlambda = "redextape_lambda",
  },
  pattern = {
    [".*%.tm"] = sniff_tm,
    [".*%.asm"] = sniff_asm,
  },
})

-- INSTALLING A PARSER IS NOT THE SAME AS TURNING HIGHLIGHTING ON, AND NOTHING ELSE HERE DOES IT.
-- Neovim auto-starts treesitter only from its own bundled ftplugins — lua, markdown, help, query —
-- and nvim-treesitter `main` ships no FileType autocmd at all. Without this block the one-line spec
-- installs four parsers, claims four filetypes, and produces no colour whatsoever: the buffer opens
-- with the right `filetype` and `vim.treesitter.highlighter.active[buf]` nil. That was measured, and
-- it was measured only after a review pointed out that every earlier check had supplied its own
-- FileType autocmd and was therefore testing the harness rather than this file.
--
-- Scoped to this project's four filetypes by `pattern`, so it can never change what happens in any
-- other buffer.
local warned = false
vim.api.nvim_create_autocmd("FileType", {
  group = group,
  pattern = FILETYPES,
  callback = function(args)
    local lang = vim.bo[args.buf].filetype
    if not pcall(vim.treesitter.language.add, lang) then
      -- A missing parser has exactly two causes worth naming, and silence serves neither.
      if not warned then
        warned = true
        vim.notify(
          ("redextape: no tree-sitter parser for %q.\n"):format(lang)
            .. "Run :TSInstall redextape redextape_asm redextape_lambda redextape_tm and restart.\n"
            .. "If that reports `skipping unsupported language`, you are on nvim-treesitter's "
            .. "`master` branch, which this plugin does not support — see the grammar READMEs for a "
            .. "hand-written block that does.",
          vim.log.levels.WARN
        )
      end
      return
    end
    if vim.treesitter.query.get(lang, "highlights") then
      pcall(vim.treesitter.start, args.buf, lang)
    end
  end,
})
