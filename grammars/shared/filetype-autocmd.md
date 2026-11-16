**One more step the snippets above do not include.** Installing a parser does not turn highlighting
on. Neovim auto-starts treesitter only for its own bundled filetypes — lua, markdown, help, query —
and nvim-treesitter's `main` branch ships no `FileType` autocmd of its own, so without something
like this the buffer opens with the right filetype, a working parser, and no colour. (`master` has
one, in its `highlight` module, which runs only once you enable that module.) The pattern names the
filetypes of both branches' blocks:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = {
    "redextape", "redextape_rxm", "redextape_lambda", "redextape_tm", -- the `main` blocks
    "rxt", "rxm", "rxlambda", "tm", -- the `master` blocks
  },
  callback = function(args) pcall(vim.treesitter.start, args.buf) end,
})
```

This was measured rather than assumed, by a check that does not supply this autocmd itself: a check
that does is testing the harness.
