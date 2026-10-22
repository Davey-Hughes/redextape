/**
 * A one-tape machine of `states` states and `halt` in the TM text form: three lines to each of the `states`, one
 * to `halt`, every line a whole item.
 */
export const machine = (states: number): string => {
  let out =
    'tapes 1\nstart s0\nversion 1\nencoding unary\nwidth 8\nslots 1\nresult Nat\ntape 0 #________#\n\nstate halt: accept\n'
  for (let i = 0; i < states; i++) {
    const next = i + 1 < states ? `s${i + 1}` : 'halt'
    out += `state s${i}:\n  [1] -> write [_], move [R], goto ${next}\n  [_] -> write [1], move [L], goto s${i}\n`
  }
  return out
}
