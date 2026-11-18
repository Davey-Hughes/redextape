# View button order: design

Lane `view-button-order`, off `main` at `eb12e11`.

## What was asked

The user, word for word: "we should make the order of the buttons at the top 'source, lambda, tm, rxm'".
The header's `views` toggles read source, rxm, λ, TM today. They will read source, λ, TM, rxm.

## Settled by the controller, in the lane's brief

1. The `1` to `4` toggle keys, the layout cycle and the live region's sentence follow the new order, since they read
   `HEADER_ORDER` on purpose. Key `2` becomes λ, `3` TM and `4` rxm. The cycle's stops become the source beside λ,
   beside TM, beside rxm, then all four. The sentence becomes "showing source, λ, TM and rxm".
2. The default four-view grid does not move: source over rxm, beside λ over TM. A test held the grid's leaves to
   `HEADER_ORDER`, which was a coincidence of the old order, so it now spells the grid's own order out.
3. `KIND_ORDER` does not change. Stored workspaces are keyed by it, and a stored layout must survive this change.

## The user's decision

Review 1 showed that following the new order changes what `]` does from a first load, the source beside the TM view.
The first press used to reach all four views. It now reaches the source beside rxm, which hides the TM view, and all
four takes a second press. The controller asked "should the `]` key follow the new button order? It currently does",
showing review 1's table of the presses, and said
"I recommend keeping it, so the buttons, keys and cycle all share one order". The user answered "yes keep". The cycle
goes on reading `HEADER_ORDER`.

## Calls made in this lane

1. **A test about a view keeps its view and changes its key.** Most key presses in the browser tests stand for "hide
   the rxm view" or "hide the TM view", so those follow the view: rxm is pressed with `4` and TM with `3`. A test whose
   subject is the digit itself (vim's count, a held `2`, the `2` kept from a select) keeps the digit and expects λ to go.
2. **`step-focus-recording` presses `2` where it pressed `]`.** Its case needs a view key that keeps the TM view on the
   page. From the source beside the TM view, `]` used to reach all four. It now reaches the source beside rxm, and `[`
   the source beside λ, so no cycle step keeps the TM view from there.
3. **The focus ring case presses the source and rxm, where it pressed the source and TM.** In the new order the source
   and TM would read pressed, unpressed, pressed, unpressed, so no two unpressed toggles would touch. With the source
   and rxm pressed, λ and TM are unpressed side by side, each with a pressed toggle on its other side.
4. **A stored workspace is pinned as written text in a file of its own**, since `main()` reads storage once a page. Built
   with `serializeWorkspace`, the record would follow any change to how its keys are spelled.
