**One more step the snippets above do not include.** Installing a parser does not turn highlighting
on. Neovim auto-starts treesitter only for its own bundled filetypes — lua, markdown, help, query —
and nvim-treesitter ships no `FileType` autocmd of its own, so without something like this the buffer
opens with the right filetype, a working parser, and no colour:

```lua
vim.api.nvim_create_autocmd("FileType", {
  pattern = { "redextape", "redextape_asm", "redextape_lambda", "redextape_tm" },
  callback = function(args) pcall(vim.treesitter.start, args.buf) end,
})
```

This was measured rather than assumed, and it was measured only after a review pointed out that every
earlier check had supplied this autocmd itself and was therefore testing the harness.
