tapes 1
start q2.c0.scan
version 2
encoding unary
width 8
slots 3
result Nat
reduced single-tape 5
steps 241666
tape 0 <a_b_c_d_e_A#B_C_D_E_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a#b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a#b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a_b_c_d_e_a#b_c_d_e_>

state q0.halt: accept
state q1.c0.scan:
state q2.c0.scan:
  [>] -> write [*], move [S], goto q2.c0.rew
  [A] -> write [*], move [R], goto q2.c0.chk0
  [*] -> write [*], move [R], goto q2.c0.scan
state q2.c0.rew:
  [<] -> write [*], move [R], goto q2.c0.ap0
  [*] -> write [*], move [L], goto q2.c0.rew
state q2.c0.fail:
  [<] -> write [*], move [R], goto q2.stuck
  [*] -> write [*], move [L], goto q2.c0.fail
state q2.c0.chk0:
  [#] -> write [*], move [R], goto q2.c0.scan
  [*] -> write [*], move [S], goto q2.c0.fail
state q2.stuck:
state q6.c0.scan:
  [>] -> write [*], move [S], goto q6.c0.rew
  [A] -> write [*], move [R], goto q6.c0.chk0
  [*] -> write [*], move [R], goto q6.c0.scan
state q2.c0.ap0:
  [A] -> write [*], move [S], goto q2.c0.mv0
  [*] -> write [*], move [R], goto q2.c0.ap0
state q2.c0.mv0:
  [*] -> write [a], move [R], goto q2.c0.sk0
state q2.c0.rap0:
  [<] -> write [*], move [R], goto q6.c0.scan
  [*] -> write [*], move [L], goto q2.c0.rap0
state overflow:
state q2.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q2.c0.rap0
  [*] -> write [*], move [R], goto q2.c0.sk0
state q3.c0.scan:
  [>] -> write [*], move [S], goto q3.c0.rew
  [A] -> write [*], move [R], goto q3.c0.chk0
  [*] -> write [*], move [R], goto q3.c0.scan
state q3.c0.rew:
  [<] -> write [*], move [R], goto q3.c0.ap0
  [*] -> write [*], move [L], goto q3.c0.rew
state q3.c0.fail:
  [<] -> write [*], move [R], goto q3.stuck
  [*] -> write [*], move [L], goto q3.c0.fail
state q3.c0.chk0:
  [#] -> write [*], move [R], goto q3.c0.scan
  [*] -> write [*], move [S], goto q3.c0.fail
state q3.stuck:
state q18.c0.scan:
  [>] -> write [*], move [S], goto q18.c0.rew
  [A] -> write [*], move [R], goto q18.c0.chk0
  [*] -> write [*], move [R], goto q18.c0.scan
state q3.c0.ap0:
  [A] -> write [*], move [S], goto q3.c0.mv0
  [*] -> write [*], move [R], goto q3.c0.ap0
state q3.c0.mv0:
  [*] -> write [a], move [R], goto q3.c0.sk0
state q3.c0.rap0:
  [<] -> write [*], move [R], goto q18.c0.scan
  [*] -> write [*], move [L], goto q3.c0.rap0
state q3.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q3.c0.rap0
  [*] -> write [*], move [R], goto q3.c0.sk0
state q4.c0.scan:
  [>] -> write [*], move [S], goto q4.c0.rew
  [B] -> write [*], move [R], goto q4.c0.chk1
  [*] -> write [*], move [R], goto q4.c0.scan
state q4.c0.rew:
  [<] -> write [*], move [R], goto q4.c0.ap1
  [*] -> write [*], move [L], goto q4.c0.rew
state q4.c0.fail:
  [<] -> write [*], move [R], goto q4.c1.scan
  [*] -> write [*], move [L], goto q4.c0.fail
state q4.c0.chk1:
  [1] -> write [*], move [R], goto q4.c0.scan
  [*] -> write [*], move [S], goto q4.c0.fail
state q4.c1.scan:
  [>] -> write [*], move [S], goto q4.c1.rew
  [B] -> write [*], move [R], goto q4.c1.chk1
  [*] -> write [*], move [R], goto q4.c1.scan
state q4.c0.ap1:
  [B] -> write [*], move [S], goto q4.c0.mv1
  [*] -> write [*], move [R], goto q4.c0.ap1
state q4.c0.mv1:
  [*] -> write [b], move [R], goto q4.c0.sk1
state q4.c0.rap1:
  [<] -> write [*], move [R], goto q4.c0.scan
  [*] -> write [*], move [L], goto q4.c0.rap1
state q4.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q4.c0.rap1
  [*] -> write [*], move [R], goto q4.c0.sk1
state q4.c1.rew:
  [<] -> write [*], move [R], goto q4.c1.ap1
  [*] -> write [*], move [L], goto q4.c1.rew
state q4.c1.fail:
  [<] -> write [*], move [R], goto q4.stuck
  [*] -> write [*], move [L], goto q4.c1.fail
state q4.c1.chk1:
  [_] -> write [*], move [R], goto q4.c1.scan
  [*] -> write [*], move [S], goto q4.c1.fail
state q4.stuck:
state q30.c0.scan:
  [>] -> write [*], move [S], goto q30.c0.rew
  [B] -> write [*], move [R], goto q30.c0.chk1
  [*] -> write [*], move [R], goto q30.c0.scan
state q4.c1.ap1:
  [B] -> write [*], move [S], goto q4.c1.mv1
  [*] -> write [*], move [R], goto q4.c1.ap1
state q4.c1.mv1:
  [*] -> write [b], move [L], goto q4.c1.sk1
state q4.c1.rap1:
  [<] -> write [*], move [R], goto q30.c0.scan
  [*] -> write [*], move [L], goto q4.c1.rap1
state q4.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q4.c1.rap1
  [*] -> write [*], move [L], goto q4.c1.sk1
state q5.c0.scan:
  [>] -> write [*], move [S], goto q5.c0.rew
  [*] -> write [*], move [R], goto q5.c0.scan
state q5.c0.rew:
  [<] -> write [*], move [R], goto q0.halt
  [*] -> write [*], move [L], goto q5.c0.rew
state q5.c0.fail:
  [<] -> write [*], move [R], goto q5.stuck
  [*] -> write [*], move [L], goto q5.c0.fail
state q5.stuck:
state q6.c0.rew:
  [<] -> write [*], move [R], goto q6.c0.ap0
  [*] -> write [*], move [L], goto q6.c0.rew
state q6.c0.fail:
  [<] -> write [*], move [R], goto q6.c1.scan
  [*] -> write [*], move [L], goto q6.c0.fail
state q6.c0.chk0:
  [1] -> write [*], move [R], goto q6.c0.scan
  [*] -> write [*], move [S], goto q6.c0.fail
state q6.c1.scan:
  [>] -> write [*], move [S], goto q6.c1.rew
  [A] -> write [*], move [R], goto q6.c1.chk0
  [*] -> write [*], move [R], goto q6.c1.scan
state q6.c0.ap0:
  [A] -> write [*], move [S], goto q6.c0.mv0
  [*] -> write [*], move [R], goto q6.c0.ap0
state q6.c0.mv0:
  [*] -> write [a], move [R], goto q6.c0.sk0
state q6.c0.rap0:
  [<] -> write [*], move [R], goto q6.c0.scan
  [*] -> write [*], move [L], goto q6.c0.rap0
state q6.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q6.c0.rap0
  [*] -> write [*], move [R], goto q6.c0.sk0
state q6.c1.rew:
  [<] -> write [*], move [R], goto q6.c1.ap0
  [*] -> write [*], move [L], goto q6.c1.rew
state q6.c1.fail:
  [<] -> write [*], move [R], goto q6.c2.scan
  [*] -> write [*], move [L], goto q6.c1.fail
state q6.c1.chk0:
  [_] -> write [*], move [R], goto q6.c1.scan
  [*] -> write [*], move [S], goto q6.c1.fail
state q6.c2.scan:
  [>] -> write [*], move [S], goto q6.c2.rew
  [A] -> write [*], move [R], goto q6.c2.chk0
  [*] -> write [*], move [R], goto q6.c2.scan
state q6.c1.ap0:
  [A] -> write [*], move [S], goto q6.c1.mv0
  [*] -> write [*], move [R], goto q6.c1.ap0
state q6.c1.mv0:
  [*] -> write [a], move [R], goto q6.c1.sk0
state q6.c1.rap0:
  [<] -> write [*], move [R], goto q6.c0.scan
  [*] -> write [*], move [L], goto q6.c1.rap0
state q6.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q6.c1.rap0
  [*] -> write [*], move [R], goto q6.c1.sk0
state q6.c2.rew:
  [<] -> write [*], move [R], goto q6.c2.ap0
  [*] -> write [*], move [L], goto q6.c2.rew
state q6.c2.fail:
  [<] -> write [*], move [R], goto q6.stuck
  [*] -> write [*], move [L], goto q6.c2.fail
state q6.c2.chk0:
  [#] -> write [*], move [R], goto q6.c2.scan
  [*] -> write [*], move [S], goto q6.c2.fail
state q6.stuck:
state q7.c0.scan:
  [>] -> write [*], move [S], goto q7.c0.rew
  [*] -> write [*], move [R], goto q7.c0.scan
state q6.c2.ap0:
  [A] -> write [*], move [S], goto q6.c2.mv0
  [*] -> write [*], move [R], goto q6.c2.ap0
state q6.c2.mv0:
  [*] -> write [a], move [R], goto q6.c2.sk0
state q6.c2.rap0:
  [<] -> write [*], move [R], goto q7.c0.scan
  [*] -> write [*], move [L], goto q6.c2.rap0
state q6.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q6.c2.rap0
  [*] -> write [*], move [R], goto q6.c2.sk0
state q7.c0.rew:
  [<] -> write [*], move [R], goto q8.c0.scan
  [*] -> write [*], move [L], goto q7.c0.rew
state q7.c0.fail:
  [<] -> write [*], move [R], goto q7.stuck
  [*] -> write [*], move [L], goto q7.c0.fail
state q7.stuck:
state q8.c0.scan:
  [>] -> write [*], move [S], goto q8.c0.rew
  [A] -> write [*], move [R], goto q8.c0.chk0
  [*] -> write [*], move [R], goto q8.c0.scan
state q8.c0.rew:
  [<] -> write [*], move [R], goto q8.c0.ap0
  [*] -> write [*], move [L], goto q8.c0.rew
state q8.c0.fail:
  [<] -> write [*], move [R], goto q8.c1.scan
  [*] -> write [*], move [L], goto q8.c0.fail
state q8.c0.chk0:
  [1] -> write [*], move [R], goto q8.c0.scan
  [*] -> write [*], move [S], goto q8.c0.fail
state q8.c1.scan:
  [>] -> write [*], move [S], goto q8.c1.rew
  [A] -> write [*], move [R], goto q8.c1.chk0
  [*] -> write [*], move [R], goto q8.c1.scan
state q8.c0.ap0:
  [A] -> write [*], move [R], goto q8.c0.wr0
  [*] -> write [*], move [R], goto q8.c0.ap0
state q8.c0.mv0:
  [*] -> write [a], move [R], goto q8.c0.sk0
state q8.c0.rap0:
  [<] -> write [*], move [R], goto q8.c0.scan
  [*] -> write [*], move [L], goto q8.c0.rap0
state q8.c0.wr0:
  [*] -> write [_], move [L], goto q8.c0.mv0
state q8.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q8.c0.rap0
  [*] -> write [*], move [R], goto q8.c0.sk0
state q8.c1.rew:
  [<] -> write [*], move [R], goto q8.c1.ap0
  [*] -> write [*], move [L], goto q8.c1.rew
state q8.c1.fail:
  [<] -> write [*], move [R], goto q8.c2.scan
  [*] -> write [*], move [L], goto q8.c1.fail
state q8.c1.chk0:
  [_] -> write [*], move [R], goto q8.c1.scan
  [*] -> write [*], move [S], goto q8.c1.fail
state q8.c2.scan:
  [>] -> write [*], move [S], goto q8.c2.rew
  [A] -> write [*], move [R], goto q8.c2.chk0
  [*] -> write [*], move [R], goto q8.c2.scan
state q8.c1.ap0:
  [A] -> write [*], move [R], goto q8.c1.wr0
  [*] -> write [*], move [R], goto q8.c1.ap0
state q8.c1.mv0:
  [*] -> write [a], move [R], goto q8.c1.sk0
state q8.c1.rap0:
  [<] -> write [*], move [R], goto q8.c0.scan
  [*] -> write [*], move [L], goto q8.c1.rap0
state q8.c1.wr0:
  [*] -> write [_], move [L], goto q8.c1.mv0
state q8.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q8.c1.rap0
  [*] -> write [*], move [R], goto q8.c1.sk0
state q8.c2.rew:
  [<] -> write [*], move [R], goto q8.c2.ap0
  [*] -> write [*], move [L], goto q8.c2.rew
state q8.c2.fail:
  [<] -> write [*], move [R], goto q8.stuck
  [*] -> write [*], move [L], goto q8.c2.fail
state q8.c2.chk0:
  [#] -> write [*], move [R], goto q8.c2.scan
  [*] -> write [*], move [S], goto q8.c2.fail
state q8.stuck:
state q9.c0.scan:
  [>] -> write [*], move [S], goto q9.c0.rew
  [A] -> write [*], move [R], goto q9.c0.chk0
  [*] -> write [*], move [R], goto q9.c0.scan
state q8.c2.ap0:
  [A] -> write [*], move [S], goto q8.c2.mv0
  [*] -> write [*], move [R], goto q8.c2.ap0
state q8.c2.mv0:
  [*] -> write [a], move [L], goto q8.c2.sk0
state q8.c2.rap0:
  [<] -> write [*], move [R], goto q9.c0.scan
  [*] -> write [*], move [L], goto q8.c2.rap0
state q8.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q8.c2.rap0
  [*] -> write [*], move [L], goto q8.c2.sk0
state q9.c0.rew:
  [<] -> write [*], move [R], goto q9.c0.ap0
  [*] -> write [*], move [L], goto q9.c0.rew
state q9.c0.fail:
  [<] -> write [*], move [R], goto q9.c1.scan
  [*] -> write [*], move [L], goto q9.c0.fail
state q9.c0.chk0:
  [_] -> write [*], move [R], goto q9.c0.scan
  [*] -> write [*], move [S], goto q9.c0.fail
state q9.c1.scan:
  [>] -> write [*], move [S], goto q9.c1.rew
  [A] -> write [*], move [R], goto q9.c1.chk0
  [*] -> write [*], move [R], goto q9.c1.scan
state q9.c0.ap0:
  [A] -> write [*], move [S], goto q9.c0.mv0
  [*] -> write [*], move [R], goto q9.c0.ap0
state q9.c0.mv0:
  [*] -> write [a], move [L], goto q9.c0.sk0
state q9.c0.rap0:
  [<] -> write [*], move [R], goto q9.c0.scan
  [*] -> write [*], move [L], goto q9.c0.rap0
state q9.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q9.c0.rap0
  [*] -> write [*], move [L], goto q9.c0.sk0
state q9.c1.rew:
  [<] -> write [*], move [R], goto q9.c1.ap0
  [*] -> write [*], move [L], goto q9.c1.rew
state q9.c1.fail:
  [<] -> write [*], move [R], goto q9.stuck
  [*] -> write [*], move [L], goto q9.c1.fail
state q9.c1.chk0:
  [#] -> write [*], move [R], goto q9.c1.scan
  [*] -> write [*], move [S], goto q9.c1.fail
state q9.stuck:
state q10.c0.scan:
  [>] -> write [*], move [S], goto q10.c0.rew
  [A] -> write [*], move [R], goto q10.c0.chk0
  [*] -> write [*], move [R], goto q10.c0.scan
state q9.c1.ap0:
  [A] -> write [*], move [S], goto q9.c1.mv0
  [*] -> write [*], move [R], goto q9.c1.ap0
state q9.c1.mv0:
  [*] -> write [a], move [R], goto q9.c1.sk0
state q9.c1.rap0:
  [<] -> write [*], move [R], goto q10.c0.scan
  [*] -> write [*], move [L], goto q9.c1.rap0
state q9.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q9.c1.rap0
  [*] -> write [*], move [R], goto q9.c1.sk0
state q10.c0.rew:
  [<] -> write [*], move [R], goto q10.c0.ap0
  [*] -> write [*], move [L], goto q10.c0.rew
state q10.c0.fail:
  [<] -> write [*], move [R], goto q10.stuck
  [*] -> write [*], move [L], goto q10.c0.fail
state q10.c0.chk0:
  [_] -> write [*], move [R], goto q10.c0.scan
  [*] -> write [*], move [S], goto q10.c0.fail
state q10.stuck:
state q11.c0.scan:
  [>] -> write [*], move [S], goto q11.c0.rew
  [A] -> write [*], move [R], goto q11.c0.chk0
  [*] -> write [*], move [R], goto q11.c0.scan
state q10.c0.ap0:
  [A] -> write [*], move [R], goto q10.c0.wr0
  [*] -> write [*], move [R], goto q10.c0.ap0
state q10.c0.mv0:
  [*] -> write [a], move [R], goto q10.c0.sk0
state q10.c0.rap0:
  [<] -> write [*], move [R], goto q11.c0.scan
  [*] -> write [*], move [L], goto q10.c0.rap0
state q10.c0.wr0:
  [*] -> write [1], move [L], goto q10.c0.mv0
state q10.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q10.c0.rap0
  [*] -> write [*], move [R], goto q10.c0.sk0
state q11.c0.rew:
  [<] -> write [*], move [R], goto q11.c0.ap0
  [*] -> write [*], move [L], goto q11.c0.rew
state q11.c0.fail:
  [<] -> write [*], move [R], goto q11.stuck
  [*] -> write [*], move [L], goto q11.c0.fail
state q11.c0.chk0:
  [_] -> write [*], move [R], goto q11.c0.scan
  [*] -> write [*], move [S], goto q11.c0.fail
state q11.stuck:
state q12.c0.scan:
  [>] -> write [*], move [S], goto q12.c0.rew
  [A] -> write [*], move [R], goto q12.c0.chk0
  [*] -> write [*], move [R], goto q12.c0.scan
state q11.c0.ap0:
  [A] -> write [*], move [R], goto q11.c0.wr0
  [*] -> write [*], move [R], goto q11.c0.ap0
state q11.c0.mv0:
  [*] -> write [a], move [R], goto q11.c0.sk0
state q11.c0.rap0:
  [<] -> write [*], move [R], goto q12.c0.scan
  [*] -> write [*], move [L], goto q11.c0.rap0
state q11.c0.wr0:
  [*] -> write [1], move [L], goto q11.c0.mv0
state q11.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q11.c0.rap0
  [*] -> write [*], move [R], goto q11.c0.sk0
state q12.c0.rew:
  [<] -> write [*], move [R], goto q12.c0.ap0
  [*] -> write [*], move [L], goto q12.c0.rew
state q12.c0.fail:
  [<] -> write [*], move [R], goto q12.stuck
  [*] -> write [*], move [L], goto q12.c0.fail
state q12.c0.chk0:
  [_] -> write [*], move [R], goto q12.c0.scan
  [*] -> write [*], move [S], goto q12.c0.fail
state q12.stuck:
state q13.c0.scan:
  [>] -> write [*], move [S], goto q13.c0.rew
  [A] -> write [*], move [R], goto q13.c0.chk0
  [*] -> write [*], move [R], goto q13.c0.scan
state q12.c0.ap0:
  [A] -> write [*], move [R], goto q12.c0.wr0
  [*] -> write [*], move [R], goto q12.c0.ap0
state q12.c0.mv0:
  [*] -> write [a], move [R], goto q12.c0.sk0
state q12.c0.rap0:
  [<] -> write [*], move [R], goto q13.c0.scan
  [*] -> write [*], move [L], goto q12.c0.rap0
state q12.c0.wr0:
  [*] -> write [1], move [L], goto q12.c0.mv0
state q12.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q12.c0.rap0
  [*] -> write [*], move [R], goto q12.c0.sk0
state q13.c0.rew:
  [<] -> write [*], move [R], goto q13.c0.ap0
  [*] -> write [*], move [L], goto q13.c0.rew
state q13.c0.fail:
  [<] -> write [*], move [R], goto q13.stuck
  [*] -> write [*], move [L], goto q13.c0.fail
state q13.c0.chk0:
  [_] -> write [*], move [R], goto q13.c0.scan
  [*] -> write [*], move [S], goto q13.c0.fail
state q13.stuck:
state q14.c0.scan:
  [>] -> write [*], move [S], goto q14.c0.rew
  [A] -> write [*], move [R], goto q14.c0.chk0
  [*] -> write [*], move [R], goto q14.c0.scan
state q13.c0.ap0:
  [A] -> write [*], move [R], goto q13.c0.wr0
  [*] -> write [*], move [R], goto q13.c0.ap0
state q13.c0.mv0:
  [*] -> write [a], move [R], goto q13.c0.sk0
state q13.c0.rap0:
  [<] -> write [*], move [R], goto q14.c0.scan
  [*] -> write [*], move [L], goto q13.c0.rap0
state q13.c0.wr0:
  [*] -> write [1], move [L], goto q13.c0.mv0
state q13.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q13.c0.rap0
  [*] -> write [*], move [R], goto q13.c0.sk0
state q14.c0.rew:
  [<] -> write [*], move [R], goto q14.c0.ap0
  [*] -> write [*], move [L], goto q14.c0.rew
state q14.c0.fail:
  [<] -> write [*], move [R], goto q14.stuck
  [*] -> write [*], move [L], goto q14.c0.fail
state q14.c0.chk0:
  [_] -> write [*], move [R], goto q14.c0.scan
  [*] -> write [*], move [S], goto q14.c0.fail
state q14.stuck:
state q15.c0.scan:
  [>] -> write [*], move [S], goto q15.c0.rew
  [A] -> write [*], move [R], goto q15.c0.chk0
  [*] -> write [*], move [R], goto q15.c0.scan
state q14.c0.ap0:
  [A] -> write [*], move [R], goto q14.c0.wr0
  [*] -> write [*], move [R], goto q14.c0.ap0
state q14.c0.mv0:
  [*] -> write [a], move [R], goto q14.c0.sk0
state q14.c0.rap0:
  [<] -> write [*], move [R], goto q15.c0.scan
  [*] -> write [*], move [L], goto q14.c0.rap0
state q14.c0.wr0:
  [*] -> write [1], move [L], goto q14.c0.mv0
state q14.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q14.c0.rap0
  [*] -> write [*], move [R], goto q14.c0.sk0
state q15.c0.rew:
  [<] -> write [*], move [R], goto q15.c0.ap0
  [*] -> write [*], move [L], goto q15.c0.rew
state q15.c0.fail:
  [<] -> write [*], move [R], goto q15.c1.scan
  [*] -> write [*], move [L], goto q15.c0.fail
state q15.c0.chk0:
  [1] -> write [*], move [R], goto q15.c0.scan
  [*] -> write [*], move [S], goto q15.c0.fail
state q15.c1.scan:
  [>] -> write [*], move [S], goto q15.c1.rew
  [A] -> write [*], move [R], goto q15.c1.chk0
  [*] -> write [*], move [R], goto q15.c1.scan
state q15.c0.ap0:
  [A] -> write [*], move [S], goto q15.c0.mv0
  [*] -> write [*], move [R], goto q15.c0.ap0
state q15.c0.mv0:
  [*] -> write [a], move [L], goto q15.c0.sk0
state q15.c0.rap0:
  [<] -> write [*], move [R], goto q15.c0.scan
  [*] -> write [*], move [L], goto q15.c0.rap0
state q15.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q15.c0.rap0
  [*] -> write [*], move [L], goto q15.c0.sk0
state q15.c1.rew:
  [<] -> write [*], move [R], goto q15.c1.ap0
  [*] -> write [*], move [L], goto q15.c1.rew
state q15.c1.fail:
  [<] -> write [*], move [R], goto q15.c2.scan
  [*] -> write [*], move [L], goto q15.c1.fail
state q15.c1.chk0:
  [_] -> write [*], move [R], goto q15.c1.scan
  [*] -> write [*], move [S], goto q15.c1.fail
state q15.c2.scan:
  [>] -> write [*], move [S], goto q15.c2.rew
  [A] -> write [*], move [R], goto q15.c2.chk0
  [*] -> write [*], move [R], goto q15.c2.scan
state q15.c1.ap0:
  [A] -> write [*], move [S], goto q15.c1.mv0
  [*] -> write [*], move [R], goto q15.c1.ap0
state q15.c1.mv0:
  [*] -> write [a], move [L], goto q15.c1.sk0
state q15.c1.rap0:
  [<] -> write [*], move [R], goto q15.c0.scan
  [*] -> write [*], move [L], goto q15.c1.rap0
state q15.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q15.c1.rap0
  [*] -> write [*], move [L], goto q15.c1.sk0
state q15.c2.rew:
  [<] -> write [*], move [R], goto q15.c2.ap0
  [*] -> write [*], move [L], goto q15.c2.rew
state q15.c2.fail:
  [<] -> write [*], move [R], goto q15.stuck
  [*] -> write [*], move [L], goto q15.c2.fail
state q15.c2.chk0:
  [#] -> write [*], move [R], goto q15.c2.scan
  [*] -> write [*], move [S], goto q15.c2.fail
state q15.stuck:
state q16.c0.scan:
  [>] -> write [*], move [S], goto q16.c0.rew
  [A] -> write [*], move [R], goto q16.c0.chk0
  [*] -> write [*], move [R], goto q16.c0.scan
state q15.c2.ap0:
  [A] -> write [*], move [S], goto q15.c2.mv0
  [*] -> write [*], move [R], goto q15.c2.ap0
state q15.c2.mv0:
  [*] -> write [a], move [L], goto q15.c2.sk0
state q15.c2.rap0:
  [<] -> write [*], move [R], goto q16.c0.scan
  [*] -> write [*], move [L], goto q15.c2.rap0
state q15.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q15.c2.rap0
  [*] -> write [*], move [L], goto q15.c2.sk0
state q16.c0.rew:
  [<] -> write [*], move [R], goto q16.c0.ap0
  [*] -> write [*], move [L], goto q16.c0.rew
state q16.c0.fail:
  [<] -> write [*], move [R], goto q16.c1.scan
  [*] -> write [*], move [L], goto q16.c0.fail
state q16.c0.chk0:
  [1] -> write [*], move [R], goto q16.c0.scan
  [*] -> write [*], move [S], goto q16.c0.fail
state q16.c1.scan:
  [>] -> write [*], move [S], goto q16.c1.rew
  [A] -> write [*], move [R], goto q16.c1.chk0
  [*] -> write [*], move [R], goto q16.c1.scan
state q16.c0.ap0:
  [A] -> write [*], move [S], goto q16.c0.mv0
  [*] -> write [*], move [R], goto q16.c0.ap0
state q16.c0.mv0:
  [*] -> write [a], move [L], goto q16.c0.sk0
state q16.c0.rap0:
  [<] -> write [*], move [R], goto q16.c0.scan
  [*] -> write [*], move [L], goto q16.c0.rap0
state q16.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q16.c0.rap0
  [*] -> write [*], move [L], goto q16.c0.sk0
state q16.c1.rew:
  [<] -> write [*], move [R], goto q16.c1.ap0
  [*] -> write [*], move [L], goto q16.c1.rew
state q16.c1.fail:
  [<] -> write [*], move [R], goto q16.c2.scan
  [*] -> write [*], move [L], goto q16.c1.fail
state q16.c1.chk0:
  [_] -> write [*], move [R], goto q16.c1.scan
  [*] -> write [*], move [S], goto q16.c1.fail
state q16.c2.scan:
  [>] -> write [*], move [S], goto q16.c2.rew
  [A] -> write [*], move [R], goto q16.c2.chk0
  [*] -> write [*], move [R], goto q16.c2.scan
state q16.c1.ap0:
  [A] -> write [*], move [S], goto q16.c1.mv0
  [*] -> write [*], move [R], goto q16.c1.ap0
state q16.c1.mv0:
  [*] -> write [a], move [L], goto q16.c1.sk0
state q16.c1.rap0:
  [<] -> write [*], move [R], goto q16.c0.scan
  [*] -> write [*], move [L], goto q16.c1.rap0
state q16.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q16.c1.rap0
  [*] -> write [*], move [L], goto q16.c1.sk0
state q16.c2.rew:
  [<] -> write [*], move [R], goto q17.c0.scan
  [*] -> write [*], move [L], goto q16.c2.rew
state q16.c2.fail:
  [<] -> write [*], move [R], goto q16.stuck
  [*] -> write [*], move [L], goto q16.c2.fail
state q16.c2.chk0:
  [#] -> write [*], move [R], goto q16.c2.scan
  [*] -> write [*], move [S], goto q16.c2.fail
state q16.stuck:
state q17.c0.scan:
  [>] -> write [*], move [S], goto q17.c0.rew
  [*] -> write [*], move [R], goto q17.c0.scan
state q17.c0.rew:
  [<] -> write [*], move [R], goto q3.c0.scan
  [*] -> write [*], move [L], goto q17.c0.rew
state q17.c0.fail:
  [<] -> write [*], move [R], goto q17.stuck
  [*] -> write [*], move [L], goto q17.c0.fail
state q17.stuck:
state q18.c0.rew:
  [<] -> write [*], move [R], goto q18.c0.ap0
  [*] -> write [*], move [L], goto q18.c0.rew
state q18.c0.fail:
  [<] -> write [*], move [R], goto q18.c1.scan
  [*] -> write [*], move [L], goto q18.c0.fail
state q18.c0.chk0:
  [1] -> write [*], move [R], goto q18.c0.scan
  [*] -> write [*], move [S], goto q18.c0.fail
state q18.c1.scan:
  [>] -> write [*], move [S], goto q18.c1.rew
  [A] -> write [*], move [R], goto q18.c1.chk0
  [*] -> write [*], move [R], goto q18.c1.scan
state q18.c0.ap0:
  [A] -> write [*], move [S], goto q18.c0.mv0
  [*] -> write [*], move [R], goto q18.c0.ap0
state q18.c0.mv0:
  [*] -> write [a], move [R], goto q18.c0.sk0
state q18.c0.rap0:
  [<] -> write [*], move [R], goto q18.c0.scan
  [*] -> write [*], move [L], goto q18.c0.rap0
state q18.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q18.c0.rap0
  [*] -> write [*], move [R], goto q18.c0.sk0
state q18.c1.rew:
  [<] -> write [*], move [R], goto q18.c1.ap0
  [*] -> write [*], move [L], goto q18.c1.rew
state q18.c1.fail:
  [<] -> write [*], move [R], goto q18.c2.scan
  [*] -> write [*], move [L], goto q18.c1.fail
state q18.c1.chk0:
  [_] -> write [*], move [R], goto q18.c1.scan
  [*] -> write [*], move [S], goto q18.c1.fail
state q18.c2.scan:
  [>] -> write [*], move [S], goto q18.c2.rew
  [A] -> write [*], move [R], goto q18.c2.chk0
  [*] -> write [*], move [R], goto q18.c2.scan
state q18.c1.ap0:
  [A] -> write [*], move [S], goto q18.c1.mv0
  [*] -> write [*], move [R], goto q18.c1.ap0
state q18.c1.mv0:
  [*] -> write [a], move [R], goto q18.c1.sk0
state q18.c1.rap0:
  [<] -> write [*], move [R], goto q18.c0.scan
  [*] -> write [*], move [L], goto q18.c1.rap0
state q18.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q18.c1.rap0
  [*] -> write [*], move [R], goto q18.c1.sk0
state q18.c2.rew:
  [<] -> write [*], move [R], goto q18.c2.ap0
  [*] -> write [*], move [L], goto q18.c2.rew
state q18.c2.fail:
  [<] -> write [*], move [R], goto q18.stuck
  [*] -> write [*], move [L], goto q18.c2.fail
state q18.c2.chk0:
  [#] -> write [*], move [R], goto q18.c2.scan
  [*] -> write [*], move [S], goto q18.c2.fail
state q18.stuck:
state q19.c0.scan:
  [>] -> write [*], move [S], goto q19.c0.rew
  [A] -> write [*], move [R], goto q19.c0.chk0
  [*] -> write [*], move [R], goto q19.c0.scan
state q18.c2.ap0:
  [A] -> write [*], move [S], goto q18.c2.mv0
  [*] -> write [*], move [R], goto q18.c2.ap0
state q18.c2.mv0:
  [*] -> write [a], move [R], goto q18.c2.sk0
state q18.c2.rap0:
  [<] -> write [*], move [R], goto q19.c0.scan
  [*] -> write [*], move [L], goto q18.c2.rap0
state q18.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q18.c2.rap0
  [*] -> write [*], move [R], goto q18.c2.sk0
state q19.c0.rew:
  [<] -> write [*], move [R], goto q19.c0.ap0
  [*] -> write [*], move [L], goto q19.c0.rew
state q19.c0.fail:
  [<] -> write [*], move [R], goto q19.c1.scan
  [*] -> write [*], move [L], goto q19.c0.fail
state q19.c0.chk0:
  [1] -> write [*], move [R], goto q19.c0.scan
  [*] -> write [*], move [S], goto q19.c0.fail
state q19.c1.scan:
  [>] -> write [*], move [S], goto q19.c1.rew
  [A] -> write [*], move [R], goto q19.c1.chk0
  [*] -> write [*], move [R], goto q19.c1.scan
state q19.c0.ap0:
  [A] -> write [*], move [S], goto q19.c0.mv0
  [*] -> write [*], move [R], goto q19.c0.ap0
state q19.c0.mv0:
  [*] -> write [a], move [R], goto q19.c0.sk0
state q19.c0.rap0:
  [<] -> write [*], move [R], goto q19.c0.scan
  [*] -> write [*], move [L], goto q19.c0.rap0
state q19.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q19.c0.rap0
  [*] -> write [*], move [R], goto q19.c0.sk0
state q19.c1.rew:
  [<] -> write [*], move [R], goto q19.c1.ap0
  [*] -> write [*], move [L], goto q19.c1.rew
state q19.c1.fail:
  [<] -> write [*], move [R], goto q19.c2.scan
  [*] -> write [*], move [L], goto q19.c1.fail
state q19.c1.chk0:
  [_] -> write [*], move [R], goto q19.c1.scan
  [*] -> write [*], move [S], goto q19.c1.fail
state q19.c2.scan:
  [>] -> write [*], move [S], goto q19.c2.rew
  [A] -> write [*], move [R], goto q19.c2.chk0
  [*] -> write [*], move [R], goto q19.c2.scan
state q19.c1.ap0:
  [A] -> write [*], move [S], goto q19.c1.mv0
  [*] -> write [*], move [R], goto q19.c1.ap0
state q19.c1.mv0:
  [*] -> write [a], move [R], goto q19.c1.sk0
state q19.c1.rap0:
  [<] -> write [*], move [R], goto q19.c0.scan
  [*] -> write [*], move [L], goto q19.c1.rap0
state q19.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q19.c1.rap0
  [*] -> write [*], move [R], goto q19.c1.sk0
state q19.c2.rew:
  [<] -> write [*], move [R], goto q19.c2.ap0
  [*] -> write [*], move [L], goto q19.c2.rew
state q19.c2.fail:
  [<] -> write [*], move [R], goto q19.stuck
  [*] -> write [*], move [L], goto q19.c2.fail
state q19.c2.chk0:
  [#] -> write [*], move [R], goto q19.c2.scan
  [*] -> write [*], move [S], goto q19.c2.fail
state q19.stuck:
state q20.c0.scan:
  [>] -> write [*], move [S], goto q20.c0.rew
  [*] -> write [*], move [R], goto q20.c0.scan
state q19.c2.ap0:
  [A] -> write [*], move [S], goto q19.c2.mv0
  [*] -> write [*], move [R], goto q19.c2.ap0
state q19.c2.mv0:
  [*] -> write [a], move [R], goto q19.c2.sk0
state q19.c2.rap0:
  [<] -> write [*], move [R], goto q20.c0.scan
  [*] -> write [*], move [L], goto q19.c2.rap0
state q19.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q19.c2.rap0
  [*] -> write [*], move [R], goto q19.c2.sk0
state q20.c0.rew:
  [<] -> write [*], move [R], goto q21.c0.scan
  [*] -> write [*], move [L], goto q20.c0.rew
state q20.c0.fail:
  [<] -> write [*], move [R], goto q20.stuck
  [*] -> write [*], move [L], goto q20.c0.fail
state q20.stuck:
state q21.c0.scan:
  [>] -> write [*], move [S], goto q21.c0.rew
  [A] -> write [*], move [R], goto q21.c0.chk0
  [*] -> write [*], move [R], goto q21.c0.scan
state q21.c0.rew:
  [<] -> write [*], move [R], goto q21.c0.ap0
  [*] -> write [*], move [L], goto q21.c0.rew
state q21.c0.fail:
  [<] -> write [*], move [R], goto q21.c1.scan
  [*] -> write [*], move [L], goto q21.c0.fail
state q21.c0.chk0:
  [1] -> write [*], move [R], goto q21.c0.scan
  [*] -> write [*], move [S], goto q21.c0.fail
state q21.c1.scan:
  [>] -> write [*], move [S], goto q21.c1.rew
  [A] -> write [*], move [R], goto q21.c1.chk0
  [*] -> write [*], move [R], goto q21.c1.scan
state q21.c0.ap0:
  [A] -> write [*], move [R], goto q21.c0.wr0
  [*] -> write [*], move [R], goto q21.c0.ap0
state q21.c0.mv0:
  [*] -> write [a], move [R], goto q21.c0.sk0
state q21.c0.rap0:
  [<] -> write [*], move [R], goto q21.c0.scan
  [*] -> write [*], move [L], goto q21.c0.rap0
state q21.c0.wr0:
  [*] -> write [_], move [L], goto q21.c0.mv0
state q21.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q21.c0.rap0
  [*] -> write [*], move [R], goto q21.c0.sk0
state q21.c1.rew:
  [<] -> write [*], move [R], goto q21.c1.ap0
  [*] -> write [*], move [L], goto q21.c1.rew
state q21.c1.fail:
  [<] -> write [*], move [R], goto q21.c2.scan
  [*] -> write [*], move [L], goto q21.c1.fail
state q21.c1.chk0:
  [_] -> write [*], move [R], goto q21.c1.scan
  [*] -> write [*], move [S], goto q21.c1.fail
state q21.c2.scan:
  [>] -> write [*], move [S], goto q21.c2.rew
  [A] -> write [*], move [R], goto q21.c2.chk0
  [*] -> write [*], move [R], goto q21.c2.scan
state q21.c1.ap0:
  [A] -> write [*], move [R], goto q21.c1.wr0
  [*] -> write [*], move [R], goto q21.c1.ap0
state q21.c1.mv0:
  [*] -> write [a], move [R], goto q21.c1.sk0
state q21.c1.rap0:
  [<] -> write [*], move [R], goto q21.c0.scan
  [*] -> write [*], move [L], goto q21.c1.rap0
state q21.c1.wr0:
  [*] -> write [_], move [L], goto q21.c1.mv0
state q21.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q21.c1.rap0
  [*] -> write [*], move [R], goto q21.c1.sk0
state q21.c2.rew:
  [<] -> write [*], move [R], goto q21.c2.ap0
  [*] -> write [*], move [L], goto q21.c2.rew
state q21.c2.fail:
  [<] -> write [*], move [R], goto q21.stuck
  [*] -> write [*], move [L], goto q21.c2.fail
state q21.c2.chk0:
  [#] -> write [*], move [R], goto q21.c2.scan
  [*] -> write [*], move [S], goto q21.c2.fail
state q21.stuck:
state q22.c0.scan:
  [>] -> write [*], move [S], goto q22.c0.rew
  [A] -> write [*], move [R], goto q22.c0.chk0
  [*] -> write [*], move [R], goto q22.c0.scan
state q21.c2.ap0:
  [A] -> write [*], move [S], goto q21.c2.mv0
  [*] -> write [*], move [R], goto q21.c2.ap0
state q21.c2.mv0:
  [*] -> write [a], move [L], goto q21.c2.sk0
state q21.c2.rap0:
  [<] -> write [*], move [R], goto q22.c0.scan
  [*] -> write [*], move [L], goto q21.c2.rap0
state q21.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q21.c2.rap0
  [*] -> write [*], move [L], goto q21.c2.sk0
state q22.c0.rew:
  [<] -> write [*], move [R], goto q22.c0.ap0
  [*] -> write [*], move [L], goto q22.c0.rew
state q22.c0.fail:
  [<] -> write [*], move [R], goto q22.c1.scan
  [*] -> write [*], move [L], goto q22.c0.fail
state q22.c0.chk0:
  [_] -> write [*], move [R], goto q22.c0.scan
  [*] -> write [*], move [S], goto q22.c0.fail
state q22.c1.scan:
  [>] -> write [*], move [S], goto q22.c1.rew
  [A] -> write [*], move [R], goto q22.c1.chk0
  [*] -> write [*], move [R], goto q22.c1.scan
state q22.c0.ap0:
  [A] -> write [*], move [S], goto q22.c0.mv0
  [*] -> write [*], move [R], goto q22.c0.ap0
state q22.c0.mv0:
  [*] -> write [a], move [L], goto q22.c0.sk0
state q22.c0.rap0:
  [<] -> write [*], move [R], goto q22.c0.scan
  [*] -> write [*], move [L], goto q22.c0.rap0
state q22.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q22.c0.rap0
  [*] -> write [*], move [L], goto q22.c0.sk0
state q22.c1.rew:
  [<] -> write [*], move [R], goto q22.c1.ap0
  [*] -> write [*], move [L], goto q22.c1.rew
state q22.c1.fail:
  [<] -> write [*], move [R], goto q22.stuck
  [*] -> write [*], move [L], goto q22.c1.fail
state q22.c1.chk0:
  [#] -> write [*], move [R], goto q22.c1.scan
  [*] -> write [*], move [S], goto q22.c1.fail
state q22.stuck:
state q23.c0.scan:
  [>] -> write [*], move [S], goto q23.c0.rew
  [A] -> write [*], move [R], goto q23.c0.chk0
  [*] -> write [*], move [R], goto q23.c0.scan
state q22.c1.ap0:
  [A] -> write [*], move [S], goto q22.c1.mv0
  [*] -> write [*], move [R], goto q22.c1.ap0
state q22.c1.mv0:
  [*] -> write [a], move [R], goto q22.c1.sk0
state q22.c1.rap0:
  [<] -> write [*], move [R], goto q23.c0.scan
  [*] -> write [*], move [L], goto q22.c1.rap0
state q22.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q22.c1.rap0
  [*] -> write [*], move [R], goto q22.c1.sk0
state q23.c0.rew:
  [<] -> write [*], move [R], goto q23.c0.ap0
  [*] -> write [*], move [L], goto q23.c0.rew
state q23.c0.fail:
  [<] -> write [*], move [R], goto q23.stuck
  [*] -> write [*], move [L], goto q23.c0.fail
state q23.c0.chk0:
  [_] -> write [*], move [R], goto q23.c0.scan
  [*] -> write [*], move [S], goto q23.c0.fail
state q23.stuck:
state q24.c0.scan:
  [>] -> write [*], move [S], goto q24.c0.rew
  [A] -> write [*], move [R], goto q24.c0.chk0
  [*] -> write [*], move [R], goto q24.c0.scan
state q23.c0.ap0:
  [A] -> write [*], move [R], goto q23.c0.wr0
  [*] -> write [*], move [R], goto q23.c0.ap0
state q23.c0.mv0:
  [*] -> write [a], move [R], goto q23.c0.sk0
state q23.c0.rap0:
  [<] -> write [*], move [R], goto q24.c0.scan
  [*] -> write [*], move [L], goto q23.c0.rap0
state q23.c0.wr0:
  [*] -> write [1], move [L], goto q23.c0.mv0
state q23.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q23.c0.rap0
  [*] -> write [*], move [R], goto q23.c0.sk0
state q24.c0.rew:
  [<] -> write [*], move [R], goto q24.c0.ap0
  [*] -> write [*], move [L], goto q24.c0.rew
state q24.c0.fail:
  [<] -> write [*], move [R], goto q24.stuck
  [*] -> write [*], move [L], goto q24.c0.fail
state q24.c0.chk0:
  [_] -> write [*], move [R], goto q24.c0.scan
  [*] -> write [*], move [S], goto q24.c0.fail
state q24.stuck:
state q25.c0.scan:
  [>] -> write [*], move [S], goto q25.c0.rew
  [A] -> write [*], move [R], goto q25.c0.chk0
  [*] -> write [*], move [R], goto q25.c0.scan
state q24.c0.ap0:
  [A] -> write [*], move [R], goto q24.c0.wr0
  [*] -> write [*], move [R], goto q24.c0.ap0
state q24.c0.mv0:
  [*] -> write [a], move [R], goto q24.c0.sk0
state q24.c0.rap0:
  [<] -> write [*], move [R], goto q25.c0.scan
  [*] -> write [*], move [L], goto q24.c0.rap0
state q24.c0.wr0:
  [*] -> write [1], move [L], goto q24.c0.mv0
state q24.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q24.c0.rap0
  [*] -> write [*], move [R], goto q24.c0.sk0
state q25.c0.rew:
  [<] -> write [*], move [R], goto q25.c0.ap0
  [*] -> write [*], move [L], goto q25.c0.rew
state q25.c0.fail:
  [<] -> write [*], move [R], goto q25.stuck
  [*] -> write [*], move [L], goto q25.c0.fail
state q25.c0.chk0:
  [_] -> write [*], move [R], goto q25.c0.scan
  [*] -> write [*], move [S], goto q25.c0.fail
state q25.stuck:
state q26.c0.scan:
  [>] -> write [*], move [S], goto q26.c0.rew
  [A] -> write [*], move [R], goto q26.c0.chk0
  [*] -> write [*], move [R], goto q26.c0.scan
state q25.c0.ap0:
  [A] -> write [*], move [R], goto q25.c0.wr0
  [*] -> write [*], move [R], goto q25.c0.ap0
state q25.c0.mv0:
  [*] -> write [a], move [R], goto q25.c0.sk0
state q25.c0.rap0:
  [<] -> write [*], move [R], goto q26.c0.scan
  [*] -> write [*], move [L], goto q25.c0.rap0
state q25.c0.wr0:
  [*] -> write [1], move [L], goto q25.c0.mv0
state q25.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q25.c0.rap0
  [*] -> write [*], move [R], goto q25.c0.sk0
state q26.c0.rew:
  [<] -> write [*], move [R], goto q26.c0.ap0
  [*] -> write [*], move [L], goto q26.c0.rew
state q26.c0.fail:
  [<] -> write [*], move [R], goto q26.c1.scan
  [*] -> write [*], move [L], goto q26.c0.fail
state q26.c0.chk0:
  [1] -> write [*], move [R], goto q26.c0.scan
  [*] -> write [*], move [S], goto q26.c0.fail
state q26.c1.scan:
  [>] -> write [*], move [S], goto q26.c1.rew
  [A] -> write [*], move [R], goto q26.c1.chk0
  [*] -> write [*], move [R], goto q26.c1.scan
state q26.c0.ap0:
  [A] -> write [*], move [S], goto q26.c0.mv0
  [*] -> write [*], move [R], goto q26.c0.ap0
state q26.c0.mv0:
  [*] -> write [a], move [L], goto q26.c0.sk0
state q26.c0.rap0:
  [<] -> write [*], move [R], goto q26.c0.scan
  [*] -> write [*], move [L], goto q26.c0.rap0
state q26.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q26.c0.rap0
  [*] -> write [*], move [L], goto q26.c0.sk0
state q26.c1.rew:
  [<] -> write [*], move [R], goto q26.c1.ap0
  [*] -> write [*], move [L], goto q26.c1.rew
state q26.c1.fail:
  [<] -> write [*], move [R], goto q26.c2.scan
  [*] -> write [*], move [L], goto q26.c1.fail
state q26.c1.chk0:
  [_] -> write [*], move [R], goto q26.c1.scan
  [*] -> write [*], move [S], goto q26.c1.fail
state q26.c2.scan:
  [>] -> write [*], move [S], goto q26.c2.rew
  [A] -> write [*], move [R], goto q26.c2.chk0
  [*] -> write [*], move [R], goto q26.c2.scan
state q26.c1.ap0:
  [A] -> write [*], move [S], goto q26.c1.mv0
  [*] -> write [*], move [R], goto q26.c1.ap0
state q26.c1.mv0:
  [*] -> write [a], move [L], goto q26.c1.sk0
state q26.c1.rap0:
  [<] -> write [*], move [R], goto q26.c0.scan
  [*] -> write [*], move [L], goto q26.c1.rap0
state q26.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q26.c1.rap0
  [*] -> write [*], move [L], goto q26.c1.sk0
state q26.c2.rew:
  [<] -> write [*], move [R], goto q26.c2.ap0
  [*] -> write [*], move [L], goto q26.c2.rew
state q26.c2.fail:
  [<] -> write [*], move [R], goto q26.stuck
  [*] -> write [*], move [L], goto q26.c2.fail
state q26.c2.chk0:
  [#] -> write [*], move [R], goto q26.c2.scan
  [*] -> write [*], move [S], goto q26.c2.fail
state q26.stuck:
state q27.c0.scan:
  [>] -> write [*], move [S], goto q27.c0.rew
  [A] -> write [*], move [R], goto q27.c0.chk0
  [*] -> write [*], move [R], goto q27.c0.scan
state q26.c2.ap0:
  [A] -> write [*], move [S], goto q26.c2.mv0
  [*] -> write [*], move [R], goto q26.c2.ap0
state q26.c2.mv0:
  [*] -> write [a], move [L], goto q26.c2.sk0
state q26.c2.rap0:
  [<] -> write [*], move [R], goto q27.c0.scan
  [*] -> write [*], move [L], goto q26.c2.rap0
state q26.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q26.c2.rap0
  [*] -> write [*], move [L], goto q26.c2.sk0
state q27.c0.rew:
  [<] -> write [*], move [R], goto q27.c0.ap0
  [*] -> write [*], move [L], goto q27.c0.rew
state q27.c0.fail:
  [<] -> write [*], move [R], goto q27.c1.scan
  [*] -> write [*], move [L], goto q27.c0.fail
state q27.c0.chk0:
  [1] -> write [*], move [R], goto q27.c0.scan
  [*] -> write [*], move [S], goto q27.c0.fail
state q27.c1.scan:
  [>] -> write [*], move [S], goto q27.c1.rew
  [A] -> write [*], move [R], goto q27.c1.chk0
  [*] -> write [*], move [R], goto q27.c1.scan
state q27.c0.ap0:
  [A] -> write [*], move [S], goto q27.c0.mv0
  [*] -> write [*], move [R], goto q27.c0.ap0
state q27.c0.mv0:
  [*] -> write [a], move [L], goto q27.c0.sk0
state q27.c0.rap0:
  [<] -> write [*], move [R], goto q27.c0.scan
  [*] -> write [*], move [L], goto q27.c0.rap0
state q27.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q27.c0.rap0
  [*] -> write [*], move [L], goto q27.c0.sk0
state q27.c1.rew:
  [<] -> write [*], move [R], goto q27.c1.ap0
  [*] -> write [*], move [L], goto q27.c1.rew
state q27.c1.fail:
  [<] -> write [*], move [R], goto q27.c2.scan
  [*] -> write [*], move [L], goto q27.c1.fail
state q27.c1.chk0:
  [_] -> write [*], move [R], goto q27.c1.scan
  [*] -> write [*], move [S], goto q27.c1.fail
state q27.c2.scan:
  [>] -> write [*], move [S], goto q27.c2.rew
  [A] -> write [*], move [R], goto q27.c2.chk0
  [*] -> write [*], move [R], goto q27.c2.scan
state q27.c1.ap0:
  [A] -> write [*], move [S], goto q27.c1.mv0
  [*] -> write [*], move [R], goto q27.c1.ap0
state q27.c1.mv0:
  [*] -> write [a], move [L], goto q27.c1.sk0
state q27.c1.rap0:
  [<] -> write [*], move [R], goto q27.c0.scan
  [*] -> write [*], move [L], goto q27.c1.rap0
state q27.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q27.c1.rap0
  [*] -> write [*], move [L], goto q27.c1.sk0
state q27.c2.rew:
  [<] -> write [*], move [R], goto q27.c2.ap0
  [*] -> write [*], move [L], goto q27.c2.rew
state q27.c2.fail:
  [<] -> write [*], move [R], goto q27.stuck
  [*] -> write [*], move [L], goto q27.c2.fail
state q27.c2.chk0:
  [#] -> write [*], move [R], goto q27.c2.scan
  [*] -> write [*], move [S], goto q27.c2.fail
state q27.stuck:
state q28.c0.scan:
  [>] -> write [*], move [S], goto q28.c0.rew
  [A] -> write [*], move [R], goto q28.c0.chk0
  [*] -> write [*], move [R], goto q28.c0.scan
state q27.c2.ap0:
  [A] -> write [*], move [S], goto q27.c2.mv0
  [*] -> write [*], move [R], goto q27.c2.ap0
state q27.c2.mv0:
  [*] -> write [a], move [L], goto q27.c2.sk0
state q27.c2.rap0:
  [<] -> write [*], move [R], goto q28.c0.scan
  [*] -> write [*], move [L], goto q27.c2.rap0
state q27.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q27.c2.rap0
  [*] -> write [*], move [L], goto q27.c2.sk0
state q28.c0.rew:
  [<] -> write [*], move [R], goto q28.c0.ap0
  [*] -> write [*], move [L], goto q28.c0.rew
state q28.c0.fail:
  [<] -> write [*], move [R], goto q28.c1.scan
  [*] -> write [*], move [L], goto q28.c0.fail
state q28.c0.chk0:
  [1] -> write [*], move [R], goto q28.c0.scan
  [*] -> write [*], move [S], goto q28.c0.fail
state q28.c1.scan:
  [>] -> write [*], move [S], goto q28.c1.rew
  [A] -> write [*], move [R], goto q28.c1.chk0
  [*] -> write [*], move [R], goto q28.c1.scan
state q28.c0.ap0:
  [A] -> write [*], move [S], goto q28.c0.mv0
  [*] -> write [*], move [R], goto q28.c0.ap0
state q28.c0.mv0:
  [*] -> write [a], move [L], goto q28.c0.sk0
state q28.c0.rap0:
  [<] -> write [*], move [R], goto q28.c0.scan
  [*] -> write [*], move [L], goto q28.c0.rap0
state q28.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q28.c0.rap0
  [*] -> write [*], move [L], goto q28.c0.sk0
state q28.c1.rew:
  [<] -> write [*], move [R], goto q28.c1.ap0
  [*] -> write [*], move [L], goto q28.c1.rew
state q28.c1.fail:
  [<] -> write [*], move [R], goto q28.c2.scan
  [*] -> write [*], move [L], goto q28.c1.fail
state q28.c1.chk0:
  [_] -> write [*], move [R], goto q28.c1.scan
  [*] -> write [*], move [S], goto q28.c1.fail
state q28.c2.scan:
  [>] -> write [*], move [S], goto q28.c2.rew
  [A] -> write [*], move [R], goto q28.c2.chk0
  [*] -> write [*], move [R], goto q28.c2.scan
state q28.c1.ap0:
  [A] -> write [*], move [S], goto q28.c1.mv0
  [*] -> write [*], move [R], goto q28.c1.ap0
state q28.c1.mv0:
  [*] -> write [a], move [L], goto q28.c1.sk0
state q28.c1.rap0:
  [<] -> write [*], move [R], goto q28.c0.scan
  [*] -> write [*], move [L], goto q28.c1.rap0
state q28.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q28.c1.rap0
  [*] -> write [*], move [L], goto q28.c1.sk0
state q28.c2.rew:
  [<] -> write [*], move [R], goto q29.c0.scan
  [*] -> write [*], move [L], goto q28.c2.rew
state q28.c2.fail:
  [<] -> write [*], move [R], goto q28.stuck
  [*] -> write [*], move [L], goto q28.c2.fail
state q28.c2.chk0:
  [#] -> write [*], move [R], goto q28.c2.scan
  [*] -> write [*], move [S], goto q28.c2.fail
state q28.stuck:
state q29.c0.scan:
  [>] -> write [*], move [S], goto q29.c0.rew
  [*] -> write [*], move [R], goto q29.c0.scan
state q29.c0.rew:
  [<] -> write [*], move [R], goto q4.c0.scan
  [*] -> write [*], move [L], goto q29.c0.rew
state q29.c0.fail:
  [<] -> write [*], move [R], goto q29.stuck
  [*] -> write [*], move [L], goto q29.c0.fail
state q29.stuck:
state q30.c0.rew:
  [<] -> write [*], move [R], goto q30.c0.ap1
  [*] -> write [*], move [L], goto q30.c0.rew
state q30.c0.fail:
  [<] -> write [*], move [R], goto q30.c1.scan
  [*] -> write [*], move [L], goto q30.c0.fail
state q30.c0.chk1:
  [1] -> write [*], move [R], goto q30.c0.scan
  [*] -> write [*], move [S], goto q30.c0.fail
state q30.c1.scan:
  [>] -> write [*], move [S], goto q30.c1.rew
  [B] -> write [*], move [R], goto q30.c1.chk1
  [*] -> write [*], move [R], goto q30.c1.scan
state q30.c0.ap1:
  [B] -> write [*], move [R], goto q30.c0.wr1
  [*] -> write [*], move [R], goto q30.c0.ap1
state q30.c0.mv1:
  [*] -> write [b], move [L], goto q30.c0.sk1
state q30.c0.rap1:
  [<] -> write [*], move [R], goto q30.c0.scan
  [*] -> write [*], move [L], goto q30.c0.rap1
state q30.c0.wr1:
  [*] -> write [_], move [L], goto q30.c0.mv1
state q30.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q30.c0.rap1
  [*] -> write [*], move [L], goto q30.c0.sk1
state q30.c1.rew:
  [<] -> write [*], move [R], goto q30.c1.ap1
  [*] -> write [*], move [L], goto q30.c1.rew
state q30.c1.fail:
  [<] -> write [*], move [R], goto q30.stuck
  [*] -> write [*], move [L], goto q30.c1.fail
state q30.c1.chk1:
  [_] -> write [*], move [R], goto q30.c1.scan
  [*] -> write [*], move [S], goto q30.c1.fail
state q30.stuck:
state q31.c0.scan:
  [>] -> write [*], move [S], goto q31.c0.rew
  [A] -> write [*], move [R], goto q31.c0.chk0
  [*] -> write [*], move [R], goto q31.c0.scan
state q30.c1.ap1:
  [B] -> write [*], move [S], goto q30.c1.mv1
  [*] -> write [*], move [R], goto q30.c1.ap1
state q30.c1.mv1:
  [*] -> write [b], move [R], goto q30.c1.sk1
state q30.c1.rap1:
  [<] -> write [*], move [R], goto q31.c0.scan
  [*] -> write [*], move [L], goto q30.c1.rap1
state q30.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q30.c1.rap1
  [*] -> write [*], move [R], goto q30.c1.sk1
state q31.c0.rew:
  [<] -> write [*], move [R], goto q31.c0.ap0
  [*] -> write [*], move [L], goto q31.c0.rew
state q31.c0.fail:
  [<] -> write [*], move [R], goto q31.stuck
  [*] -> write [*], move [L], goto q31.c0.fail
state q31.c0.chk0:
  [#] -> write [*], move [R], goto q31.c0.scan
  [*] -> write [*], move [S], goto q31.c0.fail
state q31.stuck:
state q32.c0.scan:
  [>] -> write [*], move [S], goto q32.c0.rew
  [A] -> write [*], move [R], goto q32.c0.chk0
  [*] -> write [*], move [R], goto q32.c0.scan
state q31.c0.ap0:
  [A] -> write [*], move [S], goto q31.c0.mv0
  [*] -> write [*], move [R], goto q31.c0.ap0
state q31.c0.mv0:
  [*] -> write [a], move [R], goto q31.c0.sk0
state q31.c0.rap0:
  [<] -> write [*], move [R], goto q32.c0.scan
  [*] -> write [*], move [L], goto q31.c0.rap0
state q31.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q31.c0.rap0
  [*] -> write [*], move [R], goto q31.c0.sk0
state q32.c0.rew:
  [<] -> write [*], move [R], goto q32.c0.ap0
  [*] -> write [*], move [L], goto q32.c0.rew
state q32.c0.fail:
  [<] -> write [*], move [R], goto q32.c1.scan
  [*] -> write [*], move [L], goto q32.c0.fail
state q32.c0.chk0:
  [1] -> write [*], move [R], goto q32.c0.scan
  [*] -> write [*], move [S], goto q32.c0.fail
state q32.c1.scan:
  [>] -> write [*], move [S], goto q32.c1.rew
  [A] -> write [*], move [R], goto q32.c1.chk0
  [*] -> write [*], move [R], goto q32.c1.scan
state q32.c0.ap0:
  [A] -> write [*], move [S], goto q32.c0.mv0
  [*] -> write [*], move [R], goto q32.c0.ap0
state q32.c0.mv0:
  [*] -> write [a], move [R], goto q32.c0.sk0
state q32.c0.rap0:
  [<] -> write [*], move [R], goto q32.c0.scan
  [*] -> write [*], move [L], goto q32.c0.rap0
state q32.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q32.c0.rap0
  [*] -> write [*], move [R], goto q32.c0.sk0
state q32.c1.rew:
  [<] -> write [*], move [R], goto q32.c1.ap0
  [*] -> write [*], move [L], goto q32.c1.rew
state q32.c1.fail:
  [<] -> write [*], move [R], goto q32.c2.scan
  [*] -> write [*], move [L], goto q32.c1.fail
state q32.c1.chk0:
  [_] -> write [*], move [R], goto q32.c1.scan
  [*] -> write [*], move [S], goto q32.c1.fail
state q32.c2.scan:
  [>] -> write [*], move [S], goto q32.c2.rew
  [A] -> write [*], move [R], goto q32.c2.chk0
  [*] -> write [*], move [R], goto q32.c2.scan
state q32.c1.ap0:
  [A] -> write [*], move [S], goto q32.c1.mv0
  [*] -> write [*], move [R], goto q32.c1.ap0
state q32.c1.mv0:
  [*] -> write [a], move [R], goto q32.c1.sk0
state q32.c1.rap0:
  [<] -> write [*], move [R], goto q32.c0.scan
  [*] -> write [*], move [L], goto q32.c1.rap0
state q32.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q32.c1.rap0
  [*] -> write [*], move [R], goto q32.c1.sk0
state q32.c2.rew:
  [<] -> write [*], move [R], goto q32.c2.ap0
  [*] -> write [*], move [L], goto q32.c2.rew
state q32.c2.fail:
  [<] -> write [*], move [R], goto q32.stuck
  [*] -> write [*], move [L], goto q32.c2.fail
state q32.c2.chk0:
  [#] -> write [*], move [R], goto q32.c2.scan
  [*] -> write [*], move [S], goto q32.c2.fail
state q32.stuck:
state q33.c0.scan:
  [>] -> write [*], move [S], goto q33.c0.rew
  [*] -> write [*], move [R], goto q33.c0.scan
state q32.c2.ap0:
  [A] -> write [*], move [S], goto q32.c2.mv0
  [*] -> write [*], move [R], goto q32.c2.ap0
state q32.c2.mv0:
  [*] -> write [a], move [R], goto q32.c2.sk0
state q32.c2.rap0:
  [<] -> write [*], move [R], goto q33.c0.scan
  [*] -> write [*], move [L], goto q32.c2.rap0
state q32.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q32.c2.rap0
  [*] -> write [*], move [R], goto q32.c2.sk0
state q33.c0.rew:
  [<] -> write [*], move [R], goto q34.c0.scan
  [*] -> write [*], move [L], goto q33.c0.rew
state q33.c0.fail:
  [<] -> write [*], move [R], goto q33.stuck
  [*] -> write [*], move [L], goto q33.c0.fail
state q33.stuck:
state q34.c0.scan:
  [>] -> write [*], move [S], goto q34.c0.rew
  [A] -> write [*], move [R], goto q34.c0.chk0
  [*] -> write [*], move [R], goto q34.c0.scan
state q34.c0.rew:
  [<] -> write [*], move [R], goto q34.c0.ap0
  [*] -> write [*], move [L], goto q34.c0.rew
state q34.c0.fail:
  [<] -> write [*], move [R], goto q34.c1.scan
  [*] -> write [*], move [L], goto q34.c0.fail
state q34.c0.chk0:
  [1] -> write [*], move [R], goto q34.c0.scan
  [*] -> write [*], move [S], goto q34.c0.fail
state q34.c1.scan:
  [>] -> write [*], move [S], goto q34.c1.rew
  [A] -> write [*], move [R], goto q34.c1.chk0
  [*] -> write [*], move [R], goto q34.c1.scan
state q34.c0.ap1:
  [B] -> write [*], move [R], goto q34.c0.wr1
  [*] -> write [*], move [R], goto q34.c0.ap1
state q34.c0.mv1:
  [*] -> write [b], move [R], goto q34.c0.sk1
state q34.c0.rap1:
  [<] -> write [*], move [R], goto q34.c0.scan
  [*] -> write [*], move [L], goto q34.c0.rap1
state q34.c0.wr1:
  [*] -> write [1], move [L], goto q34.c0.mv1
state q34.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q34.c0.rap1
  [*] -> write [*], move [R], goto q34.c0.sk1
state q34.c0.ap0:
  [A] -> write [*], move [S], goto q34.c0.mv0
  [*] -> write [*], move [R], goto q34.c0.ap0
state q34.c0.mv0:
  [*] -> write [a], move [R], goto q34.c0.sk0
state q34.c0.rap0:
  [<] -> write [*], move [R], goto q34.c0.ap1
  [*] -> write [*], move [L], goto q34.c0.rap0
state q34.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q34.c0.rap0
  [*] -> write [*], move [R], goto q34.c0.sk0
state q34.c1.rew:
  [<] -> write [*], move [R], goto q35.c0.scan
  [*] -> write [*], move [L], goto q34.c1.rew
state q34.c1.fail:
  [<] -> write [*], move [R], goto q34.c2.scan
  [*] -> write [*], move [L], goto q34.c1.fail
state q34.c1.chk0:
  [_] -> write [*], move [R], goto q34.c1.scan
  [*] -> write [*], move [S], goto q34.c1.fail
state q34.c2.scan:
  [>] -> write [*], move [S], goto q34.c2.rew
  [A] -> write [*], move [R], goto q34.c2.chk0
  [*] -> write [*], move [R], goto q34.c2.scan
state q35.c0.scan:
  [>] -> write [*], move [S], goto q35.c0.rew
  [A] -> write [*], move [R], goto q35.c0.chk0
  [*] -> write [*], move [R], goto q35.c0.scan
state q34.c2.rew:
  [<] -> write [*], move [R], goto q35.c0.scan
  [*] -> write [*], move [L], goto q34.c2.rew
state q34.c2.fail:
  [<] -> write [*], move [R], goto q34.stuck
  [*] -> write [*], move [L], goto q34.c2.fail
state q34.c2.chk0:
  [#] -> write [*], move [R], goto q34.c2.scan
  [*] -> write [*], move [S], goto q34.c2.fail
state q34.stuck:
state q35.c0.rew:
  [<] -> write [*], move [R], goto q35.c0.ap0
  [*] -> write [*], move [L], goto q35.c0.rew
state q35.c0.fail:
  [<] -> write [*], move [R], goto q35.c1.scan
  [*] -> write [*], move [L], goto q35.c0.fail
state q35.c0.chk0:
  [1] -> write [*], move [R], goto q35.c0.scan
  [*] -> write [*], move [S], goto q35.c0.fail
state q35.c1.scan:
  [>] -> write [*], move [S], goto q35.c1.rew
  [A] -> write [*], move [R], goto q35.c1.chk0
  [*] -> write [*], move [R], goto q35.c1.scan
state q35.c0.ap0:
  [A] -> write [*], move [S], goto q35.c0.mv0
  [*] -> write [*], move [R], goto q35.c0.ap0
state q35.c0.mv0:
  [*] -> write [a], move [L], goto q35.c0.sk0
state q35.c0.rap0:
  [<] -> write [*], move [R], goto q35.c0.scan
  [*] -> write [*], move [L], goto q35.c0.rap0
state q35.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q35.c0.rap0
  [*] -> write [*], move [L], goto q35.c0.sk0
state q35.c1.rew:
  [<] -> write [*], move [R], goto q35.c1.ap0
  [*] -> write [*], move [L], goto q35.c1.rew
state q35.c1.fail:
  [<] -> write [*], move [R], goto q35.c2.scan
  [*] -> write [*], move [L], goto q35.c1.fail
state q35.c1.chk0:
  [_] -> write [*], move [R], goto q35.c1.scan
  [*] -> write [*], move [S], goto q35.c1.fail
state q35.c2.scan:
  [>] -> write [*], move [S], goto q35.c2.rew
  [A] -> write [*], move [R], goto q35.c2.chk0
  [*] -> write [*], move [R], goto q35.c2.scan
state q35.c1.ap0:
  [A] -> write [*], move [S], goto q35.c1.mv0
  [*] -> write [*], move [R], goto q35.c1.ap0
state q35.c1.mv0:
  [*] -> write [a], move [L], goto q35.c1.sk0
state q35.c1.rap0:
  [<] -> write [*], move [R], goto q35.c0.scan
  [*] -> write [*], move [L], goto q35.c1.rap0
state q35.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q35.c1.rap0
  [*] -> write [*], move [L], goto q35.c1.sk0
state q35.c2.rew:
  [<] -> write [*], move [R], goto q35.c2.ap0
  [*] -> write [*], move [L], goto q35.c2.rew
state q35.c2.fail:
  [<] -> write [*], move [R], goto q35.stuck
  [*] -> write [*], move [L], goto q35.c2.fail
state q35.c2.chk0:
  [#] -> write [*], move [R], goto q35.c2.scan
  [*] -> write [*], move [S], goto q35.c2.fail
state q35.stuck:
state q36.c0.scan:
  [>] -> write [*], move [S], goto q36.c0.rew
  [A] -> write [*], move [R], goto q36.c0.chk0
  [*] -> write [*], move [R], goto q36.c0.scan
state q35.c2.ap0:
  [A] -> write [*], move [S], goto q35.c2.mv0
  [*] -> write [*], move [R], goto q35.c2.ap0
state q35.c2.mv0:
  [*] -> write [a], move [L], goto q35.c2.sk0
state q35.c2.rap0:
  [<] -> write [*], move [R], goto q36.c0.scan
  [*] -> write [*], move [L], goto q35.c2.rap0
state q35.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q35.c2.rap0
  [*] -> write [*], move [L], goto q35.c2.sk0
state q36.c0.rew:
  [<] -> write [*], move [R], goto q36.c0.ap0
  [*] -> write [*], move [L], goto q36.c0.rew
state q36.c0.fail:
  [<] -> write [*], move [R], goto q36.c1.scan
  [*] -> write [*], move [L], goto q36.c0.fail
state q36.c0.chk0:
  [1] -> write [*], move [R], goto q36.c0.scan
  [*] -> write [*], move [S], goto q36.c0.fail
state q36.c1.scan:
  [>] -> write [*], move [S], goto q36.c1.rew
  [A] -> write [*], move [R], goto q36.c1.chk0
  [*] -> write [*], move [R], goto q36.c1.scan
state q36.c0.ap0:
  [A] -> write [*], move [S], goto q36.c0.mv0
  [*] -> write [*], move [R], goto q36.c0.ap0
state q36.c0.mv0:
  [*] -> write [a], move [L], goto q36.c0.sk0
state q36.c0.rap0:
  [<] -> write [*], move [R], goto q36.c0.scan
  [*] -> write [*], move [L], goto q36.c0.rap0
state q36.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q36.c0.rap0
  [*] -> write [*], move [L], goto q36.c0.sk0
state q36.c1.rew:
  [<] -> write [*], move [R], goto q36.c1.ap0
  [*] -> write [*], move [L], goto q36.c1.rew
state q36.c1.fail:
  [<] -> write [*], move [R], goto q36.c2.scan
  [*] -> write [*], move [L], goto q36.c1.fail
state q36.c1.chk0:
  [_] -> write [*], move [R], goto q36.c1.scan
  [*] -> write [*], move [S], goto q36.c1.fail
state q36.c2.scan:
  [>] -> write [*], move [S], goto q36.c2.rew
  [A] -> write [*], move [R], goto q36.c2.chk0
  [*] -> write [*], move [R], goto q36.c2.scan
state q36.c1.ap0:
  [A] -> write [*], move [S], goto q36.c1.mv0
  [*] -> write [*], move [R], goto q36.c1.ap0
state q36.c1.mv0:
  [*] -> write [a], move [L], goto q36.c1.sk0
state q36.c1.rap0:
  [<] -> write [*], move [R], goto q36.c0.scan
  [*] -> write [*], move [L], goto q36.c1.rap0
state q36.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q36.c1.rap0
  [*] -> write [*], move [L], goto q36.c1.sk0
state q36.c2.rew:
  [<] -> write [*], move [R], goto q37.c0.scan
  [*] -> write [*], move [L], goto q36.c2.rew
state q36.c2.fail:
  [<] -> write [*], move [R], goto q36.stuck
  [*] -> write [*], move [L], goto q36.c2.fail
state q36.c2.chk0:
  [#] -> write [*], move [R], goto q36.c2.scan
  [*] -> write [*], move [S], goto q36.c2.fail
state q36.stuck:
state q37.c0.scan:
  [>] -> write [*], move [S], goto q37.c0.rew
  [*] -> write [*], move [R], goto q37.c0.scan
state q37.c0.rew:
  [<] -> write [*], move [R], goto q37.c0.ap1
  [*] -> write [*], move [L], goto q37.c0.rew
state q37.c0.fail:
  [<] -> write [*], move [R], goto q37.stuck
  [*] -> write [*], move [L], goto q37.c0.fail
state q37.stuck:
state q38.c0.scan:
  [>] -> write [*], move [S], goto q38.c0.rew
  [B] -> write [*], move [R], goto q38.c0.chk1
  [*] -> write [*], move [R], goto q38.c0.scan
state q37.c0.ap1:
  [B] -> write [*], move [S], goto q37.c0.mv1
  [*] -> write [*], move [R], goto q37.c0.ap1
state q37.c0.mv1:
  [*] -> write [b], move [L], goto q37.c0.sk1
state q37.c0.rap1:
  [<] -> write [*], move [R], goto q38.c0.scan
  [*] -> write [*], move [L], goto q37.c0.rap1
state q37.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q37.c0.rap1
  [*] -> write [*], move [L], goto q37.c0.sk1
state q38.c0.rew:
  [<] -> write [*], move [R], goto q38.c0.ap1
  [*] -> write [*], move [L], goto q38.c0.rew
state q38.c0.fail:
  [<] -> write [*], move [R], goto q38.c1.scan
  [*] -> write [*], move [L], goto q38.c0.fail
state q38.c0.chk1:
  [1] -> write [*], move [R], goto q38.c0.scan
  [*] -> write [*], move [S], goto q38.c0.fail
state q38.c1.scan:
  [>] -> write [*], move [S], goto q38.c1.rew
  [B] -> write [*], move [R], goto q38.c1.chk1
  [*] -> write [*], move [R], goto q38.c1.scan
state q38.c0.ap1:
  [B] -> write [*], move [S], goto q38.c0.mv1
  [*] -> write [*], move [R], goto q38.c0.ap1
state q38.c0.mv1:
  [*] -> write [b], move [L], goto q38.c0.sk1
state q38.c0.rap1:
  [<] -> write [*], move [R], goto q38.c0.scan
  [*] -> write [*], move [L], goto q38.c0.rap1
state q38.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q38.c0.rap1
  [*] -> write [*], move [L], goto q38.c0.sk1
state q38.c1.rew:
  [<] -> write [*], move [R], goto q38.c1.ap1
  [*] -> write [*], move [L], goto q38.c1.rew
state q38.c1.fail:
  [<] -> write [*], move [R], goto q38.stuck
  [*] -> write [*], move [L], goto q38.c1.fail
state q38.c1.chk1:
  [_] -> write [*], move [R], goto q38.c1.scan
  [*] -> write [*], move [S], goto q38.c1.fail
state q38.stuck:
state q39.c0.scan:
  [>] -> write [*], move [S], goto q39.c0.rew
  [A] -> write [*], move [R], goto q39.c0.chk0
  [*] -> write [*], move [R], goto q39.c0.scan
state q38.c1.ap1:
  [B] -> write [*], move [S], goto q38.c1.mv1
  [*] -> write [*], move [R], goto q38.c1.ap1
state q38.c1.mv1:
  [*] -> write [b], move [R], goto q38.c1.sk1
state q38.c1.rap1:
  [<] -> write [*], move [R], goto q39.c0.scan
  [*] -> write [*], move [L], goto q38.c1.rap1
state q38.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q38.c1.rap1
  [*] -> write [*], move [R], goto q38.c1.sk1
state q39.c0.rew:
  [<] -> write [*], move [R], goto q39.c0.ap0
  [*] -> write [*], move [L], goto q39.c0.rew
state q39.c0.fail:
  [<] -> write [*], move [R], goto q39.stuck
  [*] -> write [*], move [L], goto q39.c0.fail
state q39.c0.chk0:
  [#] -> write [*], move [R], goto q39.c0.scan
  [*] -> write [*], move [S], goto q39.c0.fail
state q39.stuck:
state q40.c0.scan:
  [>] -> write [*], move [S], goto q40.c0.rew
  [A] -> write [*], move [R], goto q40.c0.chk0
  [*] -> write [*], move [R], goto q40.c0.scan
state q39.c0.ap0:
  [A] -> write [*], move [S], goto q39.c0.mv0
  [*] -> write [*], move [R], goto q39.c0.ap0
state q39.c0.mv0:
  [*] -> write [a], move [R], goto q39.c0.sk0
state q39.c0.rap0:
  [<] -> write [*], move [R], goto q40.c0.scan
  [*] -> write [*], move [L], goto q39.c0.rap0
state q39.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q39.c0.rap0
  [*] -> write [*], move [R], goto q39.c0.sk0
state q40.c0.rew:
  [<] -> write [*], move [R], goto q40.c0.ap0
  [*] -> write [*], move [L], goto q40.c0.rew
state q40.c0.fail:
  [<] -> write [*], move [R], goto q40.c1.scan
  [*] -> write [*], move [L], goto q40.c0.fail
state q40.c0.chk0:
  [1] -> write [*], move [R], goto q40.c0.scan
  [*] -> write [*], move [S], goto q40.c0.fail
state q40.c1.scan:
  [>] -> write [*], move [S], goto q40.c1.rew
  [A] -> write [*], move [R], goto q40.c1.chk0
  [*] -> write [*], move [R], goto q40.c1.scan
state q40.c0.ap0:
  [A] -> write [*], move [S], goto q40.c0.mv0
  [*] -> write [*], move [R], goto q40.c0.ap0
state q40.c0.mv0:
  [*] -> write [a], move [R], goto q40.c0.sk0
state q40.c0.rap0:
  [<] -> write [*], move [R], goto q40.c0.scan
  [*] -> write [*], move [L], goto q40.c0.rap0
state q40.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q40.c0.rap0
  [*] -> write [*], move [R], goto q40.c0.sk0
state q40.c1.rew:
  [<] -> write [*], move [R], goto q40.c1.ap0
  [*] -> write [*], move [L], goto q40.c1.rew
state q40.c1.fail:
  [<] -> write [*], move [R], goto q40.c2.scan
  [*] -> write [*], move [L], goto q40.c1.fail
state q40.c1.chk0:
  [_] -> write [*], move [R], goto q40.c1.scan
  [*] -> write [*], move [S], goto q40.c1.fail
state q40.c2.scan:
  [>] -> write [*], move [S], goto q40.c2.rew
  [A] -> write [*], move [R], goto q40.c2.chk0
  [*] -> write [*], move [R], goto q40.c2.scan
state q40.c1.ap0:
  [A] -> write [*], move [S], goto q40.c1.mv0
  [*] -> write [*], move [R], goto q40.c1.ap0
state q40.c1.mv0:
  [*] -> write [a], move [R], goto q40.c1.sk0
state q40.c1.rap0:
  [<] -> write [*], move [R], goto q40.c0.scan
  [*] -> write [*], move [L], goto q40.c1.rap0
state q40.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q40.c1.rap0
  [*] -> write [*], move [R], goto q40.c1.sk0
state q40.c2.rew:
  [<] -> write [*], move [R], goto q40.c2.ap0
  [*] -> write [*], move [L], goto q40.c2.rew
state q40.c2.fail:
  [<] -> write [*], move [R], goto q40.stuck
  [*] -> write [*], move [L], goto q40.c2.fail
state q40.c2.chk0:
  [#] -> write [*], move [R], goto q40.c2.scan
  [*] -> write [*], move [S], goto q40.c2.fail
state q40.stuck:
state q41.c0.scan:
  [>] -> write [*], move [S], goto q41.c0.rew
  [A] -> write [*], move [R], goto q41.c0.chk0
  [*] -> write [*], move [R], goto q41.c0.scan
state q40.c2.ap0:
  [A] -> write [*], move [S], goto q40.c2.mv0
  [*] -> write [*], move [R], goto q40.c2.ap0
state q40.c2.mv0:
  [*] -> write [a], move [R], goto q40.c2.sk0
state q40.c2.rap0:
  [<] -> write [*], move [R], goto q41.c0.scan
  [*] -> write [*], move [L], goto q40.c2.rap0
state q40.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q40.c2.rap0
  [*] -> write [*], move [R], goto q40.c2.sk0
state q41.c0.rew:
  [<] -> write [*], move [R], goto q41.c0.ap0
  [*] -> write [*], move [L], goto q41.c0.rew
state q41.c0.fail:
  [<] -> write [*], move [R], goto q41.c1.scan
  [*] -> write [*], move [L], goto q41.c0.fail
state q41.c0.chk0:
  [1] -> write [*], move [R], goto q41.c0.scan
  [*] -> write [*], move [S], goto q41.c0.fail
state q41.c1.scan:
  [>] -> write [*], move [S], goto q41.c1.rew
  [A] -> write [*], move [R], goto q41.c1.chk0
  [*] -> write [*], move [R], goto q41.c1.scan
state q41.c0.ap0:
  [A] -> write [*], move [S], goto q41.c0.mv0
  [*] -> write [*], move [R], goto q41.c0.ap0
state q41.c0.mv0:
  [*] -> write [a], move [R], goto q41.c0.sk0
state q41.c0.rap0:
  [<] -> write [*], move [R], goto q41.c0.scan
  [*] -> write [*], move [L], goto q41.c0.rap0
state q41.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q41.c0.rap0
  [*] -> write [*], move [R], goto q41.c0.sk0
state q41.c1.rew:
  [<] -> write [*], move [R], goto q41.c1.ap0
  [*] -> write [*], move [L], goto q41.c1.rew
state q41.c1.fail:
  [<] -> write [*], move [R], goto q41.c2.scan
  [*] -> write [*], move [L], goto q41.c1.fail
state q41.c1.chk0:
  [_] -> write [*], move [R], goto q41.c1.scan
  [*] -> write [*], move [S], goto q41.c1.fail
state q41.c2.scan:
  [>] -> write [*], move [S], goto q41.c2.rew
  [A] -> write [*], move [R], goto q41.c2.chk0
  [*] -> write [*], move [R], goto q41.c2.scan
state q41.c1.ap0:
  [A] -> write [*], move [S], goto q41.c1.mv0
  [*] -> write [*], move [R], goto q41.c1.ap0
state q41.c1.mv0:
  [*] -> write [a], move [R], goto q41.c1.sk0
state q41.c1.rap0:
  [<] -> write [*], move [R], goto q41.c0.scan
  [*] -> write [*], move [L], goto q41.c1.rap0
state q41.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q41.c1.rap0
  [*] -> write [*], move [R], goto q41.c1.sk0
state q41.c2.rew:
  [<] -> write [*], move [R], goto q41.c2.ap0
  [*] -> write [*], move [L], goto q41.c2.rew
state q41.c2.fail:
  [<] -> write [*], move [R], goto q41.stuck
  [*] -> write [*], move [L], goto q41.c2.fail
state q41.c2.chk0:
  [#] -> write [*], move [R], goto q41.c2.scan
  [*] -> write [*], move [S], goto q41.c2.fail
state q41.stuck:
state q42.c0.scan:
  [>] -> write [*], move [S], goto q42.c0.rew
  [*] -> write [*], move [R], goto q42.c0.scan
state q41.c2.ap0:
  [A] -> write [*], move [S], goto q41.c2.mv0
  [*] -> write [*], move [R], goto q41.c2.ap0
state q41.c2.mv0:
  [*] -> write [a], move [R], goto q41.c2.sk0
state q41.c2.rap0:
  [<] -> write [*], move [R], goto q42.c0.scan
  [*] -> write [*], move [L], goto q41.c2.rap0
state q41.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q41.c2.rap0
  [*] -> write [*], move [R], goto q41.c2.sk0
state q42.c0.rew:
  [<] -> write [*], move [R], goto q43.c0.scan
  [*] -> write [*], move [L], goto q42.c0.rew
state q42.c0.fail:
  [<] -> write [*], move [R], goto q42.stuck
  [*] -> write [*], move [L], goto q42.c0.fail
state q42.stuck:
state q43.c0.scan:
  [>] -> write [*], move [S], goto q43.c0.rew
  [A] -> write [*], move [R], goto q43.c0.chk0
  [*] -> write [*], move [R], goto q43.c0.scan
state q43.c0.rew:
  [<] -> write [*], move [R], goto q43.c0.ap0
  [*] -> write [*], move [L], goto q43.c0.rew
state q43.c0.fail:
  [<] -> write [*], move [R], goto q43.c1.scan
  [*] -> write [*], move [L], goto q43.c0.fail
state q43.c0.chk0:
  [1] -> write [*], move [R], goto q43.c0.scan
  [*] -> write [*], move [S], goto q43.c0.fail
state q43.c1.scan:
  [>] -> write [*], move [S], goto q43.c1.rew
  [A] -> write [*], move [R], goto q43.c1.chk0
  [*] -> write [*], move [R], goto q43.c1.scan
state q44.c0.scan:
  [>] -> write [*], move [S], goto q44.c0.rew
  [B] -> write [*], move [R], goto q44.c0.chk1
  [*] -> write [*], move [R], goto q44.c0.scan
state q43.c0.ap0:
  [A] -> write [*], move [S], goto q43.c0.mv0
  [*] -> write [*], move [R], goto q43.c0.ap0
state q43.c0.mv0:
  [*] -> write [a], move [R], goto q43.c0.sk0
state q43.c0.rap0:
  [<] -> write [*], move [R], goto q44.c0.scan
  [*] -> write [*], move [L], goto q43.c0.rap0
state q43.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q43.c0.rap0
  [*] -> write [*], move [R], goto q43.c0.sk0
state q43.c1.rew:
  [<] -> write [*], move [R], goto q45.c0.scan
  [*] -> write [*], move [L], goto q43.c1.rew
state q43.c1.fail:
  [<] -> write [*], move [R], goto q43.c2.scan
  [*] -> write [*], move [L], goto q43.c1.fail
state q43.c1.chk0:
  [_] -> write [*], move [R], goto q43.c1.scan
  [*] -> write [*], move [S], goto q43.c1.fail
state q43.c2.scan:
  [>] -> write [*], move [S], goto q43.c2.rew
  [A] -> write [*], move [R], goto q43.c2.chk0
  [*] -> write [*], move [R], goto q43.c2.scan
state q45.c0.scan:
  [>] -> write [*], move [S], goto q45.c0.rew
  [A] -> write [*], move [R], goto q45.c0.chk0
  [*] -> write [*], move [R], goto q45.c0.scan
state q43.c2.rew:
  [<] -> write [*], move [R], goto q45.c0.scan
  [*] -> write [*], move [L], goto q43.c2.rew
state q43.c2.fail:
  [<] -> write [*], move [R], goto q43.stuck
  [*] -> write [*], move [L], goto q43.c2.fail
state q43.c2.chk0:
  [#] -> write [*], move [R], goto q43.c2.scan
  [*] -> write [*], move [S], goto q43.c2.fail
state q43.stuck:
state q44.c0.rew:
  [<] -> write [*], move [R], goto q44.c0.ap1
  [*] -> write [*], move [L], goto q44.c0.rew
state q44.c0.fail:
  [<] -> write [*], move [R], goto q44.c1.scan
  [*] -> write [*], move [L], goto q44.c0.fail
state q44.c0.chk1:
  [1] -> write [*], move [R], goto q44.c0.scan
  [*] -> write [*], move [S], goto q44.c0.fail
state q44.c1.scan:
  [>] -> write [*], move [S], goto q44.c1.rew
  [B] -> write [*], move [R], goto q44.c1.chk1
  [*] -> write [*], move [R], goto q44.c1.scan
state q44.c0.ap1:
  [B] -> write [*], move [S], goto q44.c0.mv1
  [*] -> write [*], move [R], goto q44.c0.ap1
state q44.c0.mv1:
  [*] -> write [b], move [R], goto q44.c0.sk1
state q44.c0.rap1:
  [<] -> write [*], move [R], goto q44.c0.scan
  [*] -> write [*], move [L], goto q44.c0.rap1
state q44.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q44.c0.rap1
  [*] -> write [*], move [R], goto q44.c0.sk1
state q44.c1.rew:
  [<] -> write [*], move [R], goto q44.c1.ap1
  [*] -> write [*], move [L], goto q44.c1.rew
state q44.c1.fail:
  [<] -> write [*], move [R], goto q44.stuck
  [*] -> write [*], move [L], goto q44.c1.fail
state q44.c1.chk1:
  [_] -> write [*], move [R], goto q44.c1.scan
  [*] -> write [*], move [S], goto q44.c1.fail
state q44.stuck:
state q46.c0.scan:
  [>] -> write [*], move [S], goto q46.c0.rew
  [B] -> write [*], move [R], goto q46.c0.chk1
  [*] -> write [*], move [R], goto q46.c0.scan
state q44.c1.ap1:
  [B] -> write [*], move [S], goto q44.c1.mv1
  [*] -> write [*], move [R], goto q44.c1.ap1
state q44.c1.mv1:
  [*] -> write [b], move [L], goto q44.c1.sk1
state q44.c1.rap1:
  [<] -> write [*], move [R], goto q46.c0.scan
  [*] -> write [*], move [L], goto q44.c1.rap1
state q44.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q44.c1.rap1
  [*] -> write [*], move [L], goto q44.c1.sk1
state q45.c0.rew:
  [<] -> write [*], move [R], goto q45.c0.ap0
  [*] -> write [*], move [L], goto q45.c0.rew
state q45.c0.fail:
  [<] -> write [*], move [R], goto q45.c1.scan
  [*] -> write [*], move [L], goto q45.c0.fail
state q45.c0.chk0:
  [1] -> write [*], move [R], goto q45.c0.scan
  [*] -> write [*], move [S], goto q45.c0.fail
state q45.c1.scan:
  [>] -> write [*], move [S], goto q45.c1.rew
  [A] -> write [*], move [R], goto q45.c1.chk0
  [*] -> write [*], move [R], goto q45.c1.scan
state q45.c0.ap0:
  [A] -> write [*], move [S], goto q45.c0.mv0
  [*] -> write [*], move [R], goto q45.c0.ap0
state q45.c0.mv0:
  [*] -> write [a], move [L], goto q45.c0.sk0
state q45.c0.rap0:
  [<] -> write [*], move [R], goto q45.c0.scan
  [*] -> write [*], move [L], goto q45.c0.rap0
state q45.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q45.c0.rap0
  [*] -> write [*], move [L], goto q45.c0.sk0
state q45.c1.rew:
  [<] -> write [*], move [R], goto q45.c1.ap0
  [*] -> write [*], move [L], goto q45.c1.rew
state q45.c1.fail:
  [<] -> write [*], move [R], goto q45.c2.scan
  [*] -> write [*], move [L], goto q45.c1.fail
state q45.c1.chk0:
  [_] -> write [*], move [R], goto q45.c1.scan
  [*] -> write [*], move [S], goto q45.c1.fail
state q45.c2.scan:
  [>] -> write [*], move [S], goto q45.c2.rew
  [A] -> write [*], move [R], goto q45.c2.chk0
  [*] -> write [*], move [R], goto q45.c2.scan
state q45.c1.ap0:
  [A] -> write [*], move [S], goto q45.c1.mv0
  [*] -> write [*], move [R], goto q45.c1.ap0
state q45.c1.mv0:
  [*] -> write [a], move [L], goto q45.c1.sk0
state q45.c1.rap0:
  [<] -> write [*], move [R], goto q45.c0.scan
  [*] -> write [*], move [L], goto q45.c1.rap0
state q45.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q45.c1.rap0
  [*] -> write [*], move [L], goto q45.c1.sk0
state q45.c2.rew:
  [<] -> write [*], move [R], goto q45.c2.ap0
  [*] -> write [*], move [L], goto q45.c2.rew
state q45.c2.fail:
  [<] -> write [*], move [R], goto q45.stuck
  [*] -> write [*], move [L], goto q45.c2.fail
state q45.c2.chk0:
  [#] -> write [*], move [R], goto q45.c2.scan
  [*] -> write [*], move [S], goto q45.c2.fail
state q45.stuck:
state q48.c0.scan:
  [>] -> write [*], move [S], goto q48.c0.rew
  [A] -> write [*], move [R], goto q48.c0.chk0
  [*] -> write [*], move [R], goto q48.c0.scan
state q45.c2.ap0:
  [A] -> write [*], move [S], goto q45.c2.mv0
  [*] -> write [*], move [R], goto q45.c2.ap0
state q45.c2.mv0:
  [*] -> write [a], move [L], goto q45.c2.sk0
state q45.c2.rap0:
  [<] -> write [*], move [R], goto q48.c0.scan
  [*] -> write [*], move [L], goto q45.c2.rap0
state q45.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q45.c2.rap0
  [*] -> write [*], move [L], goto q45.c2.sk0
state q46.c0.rew:
  [<] -> write [*], move [R], goto q46.c0.ap1
  [*] -> write [*], move [L], goto q46.c0.rew
state q46.c0.fail:
  [<] -> write [*], move [R], goto q46.c1.scan
  [*] -> write [*], move [L], goto q46.c0.fail
state q46.c0.chk1:
  [1] -> write [*], move [R], goto q46.c0.scan
  [*] -> write [*], move [S], goto q46.c0.fail
state q46.c1.scan:
  [>] -> write [*], move [S], goto q46.c1.rew
  [B] -> write [*], move [R], goto q46.c1.chk1
  [*] -> write [*], move [R], goto q46.c1.scan
state q47.c0.scan:
  [>] -> write [*], move [S], goto q47.c0.rew
  [B] -> write [*], move [R], goto q47.c0.chk1
  [*] -> write [*], move [R], goto q47.c0.scan
state q46.c0.ap1:
  [B] -> write [*], move [R], goto q46.c0.wr1
  [*] -> write [*], move [R], goto q46.c0.ap1
state q46.c0.mv1:
  [*] -> write [b], move [L], goto q46.c0.sk1
state q46.c0.rap1:
  [<] -> write [*], move [R], goto q47.c0.scan
  [*] -> write [*], move [L], goto q46.c0.rap1
state q46.c0.wr1:
  [*] -> write [_], move [L], goto q46.c0.mv1
state q46.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q46.c0.rap1
  [*] -> write [*], move [L], goto q46.c0.sk1
state q46.c1.rew:
  [<] -> write [*], move [R], goto q46.c1.ap1
  [*] -> write [*], move [L], goto q46.c1.rew
state q46.c1.fail:
  [<] -> write [*], move [R], goto q46.stuck
  [*] -> write [*], move [L], goto q46.c1.fail
state q46.c1.chk1:
  [_] -> write [*], move [R], goto q46.c1.scan
  [*] -> write [*], move [S], goto q46.c1.fail
state q46.stuck:
state q46.c1.ap1:
  [B] -> write [*], move [S], goto q46.c1.mv1
  [*] -> write [*], move [R], goto q46.c1.ap1
state q46.c1.mv1:
  [*] -> write [b], move [R], goto q46.c1.sk1
state q46.c1.rap1:
  [<] -> write [*], move [R], goto q43.c0.scan
  [*] -> write [*], move [L], goto q46.c1.rap1
state q46.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q46.c1.rap1
  [*] -> write [*], move [R], goto q46.c1.sk1
state q47.c0.rew:
  [<] -> write [*], move [R], goto q47.c0.ap1
  [*] -> write [*], move [L], goto q47.c0.rew
state q47.c0.fail:
  [<] -> write [*], move [R], goto q47.c1.scan
  [*] -> write [*], move [L], goto q47.c0.fail
state q47.c0.chk1:
  [1] -> write [*], move [R], goto q47.c0.scan
  [*] -> write [*], move [S], goto q47.c0.fail
state q47.c1.scan:
  [>] -> write [*], move [S], goto q47.c1.rew
  [B] -> write [*], move [R], goto q47.c1.chk1
  [*] -> write [*], move [R], goto q47.c1.scan
state q47.c0.ap1:
  [B] -> write [*], move [S], goto q47.c0.mv1
  [*] -> write [*], move [R], goto q47.c0.ap1
state q47.c0.mv1:
  [*] -> write [b], move [L], goto q47.c0.sk1
state q47.c0.rap1:
  [<] -> write [*], move [R], goto q47.c0.scan
  [*] -> write [*], move [L], goto q47.c0.rap1
state q47.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q47.c0.rap1
  [*] -> write [*], move [L], goto q47.c0.sk1
state q47.c1.rew:
  [<] -> write [*], move [R], goto q47.c1.ap1
  [*] -> write [*], move [L], goto q47.c1.rew
state q47.c1.fail:
  [<] -> write [*], move [R], goto q47.stuck
  [*] -> write [*], move [L], goto q47.c1.fail
state q47.c1.chk1:
  [_] -> write [*], move [R], goto q47.c1.scan
  [*] -> write [*], move [S], goto q47.c1.fail
state q47.stuck:
state q47.c1.ap1:
  [B] -> write [*], move [S], goto q47.c1.mv1
  [*] -> write [*], move [R], goto q47.c1.ap1
state q47.c1.mv1:
  [*] -> write [b], move [R], goto q47.c1.sk1
state q47.c1.rap1:
  [<] -> write [*], move [R], goto q43.c0.scan
  [*] -> write [*], move [L], goto q47.c1.rap1
state q47.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q47.c1.rap1
  [*] -> write [*], move [R], goto q47.c1.sk1
state q48.c0.rew:
  [<] -> write [*], move [R], goto q48.c0.ap0
  [*] -> write [*], move [L], goto q48.c0.rew
state q48.c0.fail:
  [<] -> write [*], move [R], goto q48.c1.scan
  [*] -> write [*], move [L], goto q48.c0.fail
state q48.c0.chk0:
  [1] -> write [*], move [R], goto q48.c0.scan
  [*] -> write [*], move [S], goto q48.c0.fail
state q48.c1.scan:
  [>] -> write [*], move [S], goto q48.c1.rew
  [A] -> write [*], move [R], goto q48.c1.chk0
  [*] -> write [*], move [R], goto q48.c1.scan
state q48.c0.ap0:
  [A] -> write [*], move [S], goto q48.c0.mv0
  [*] -> write [*], move [R], goto q48.c0.ap0
state q48.c0.mv0:
  [*] -> write [a], move [L], goto q48.c0.sk0
state q48.c0.rap0:
  [<] -> write [*], move [R], goto q48.c0.scan
  [*] -> write [*], move [L], goto q48.c0.rap0
state q48.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q48.c0.rap0
  [*] -> write [*], move [L], goto q48.c0.sk0
state q48.c1.rew:
  [<] -> write [*], move [R], goto q48.c1.ap0
  [*] -> write [*], move [L], goto q48.c1.rew
state q48.c1.fail:
  [<] -> write [*], move [R], goto q48.c2.scan
  [*] -> write [*], move [L], goto q48.c1.fail
state q48.c1.chk0:
  [_] -> write [*], move [R], goto q48.c1.scan
  [*] -> write [*], move [S], goto q48.c1.fail
state q48.c2.scan:
  [>] -> write [*], move [S], goto q48.c2.rew
  [A] -> write [*], move [R], goto q48.c2.chk0
  [*] -> write [*], move [R], goto q48.c2.scan
state q48.c1.ap0:
  [A] -> write [*], move [S], goto q48.c1.mv0
  [*] -> write [*], move [R], goto q48.c1.ap0
state q48.c1.mv0:
  [*] -> write [a], move [L], goto q48.c1.sk0
state q48.c1.rap0:
  [<] -> write [*], move [R], goto q48.c0.scan
  [*] -> write [*], move [L], goto q48.c1.rap0
state q48.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q48.c1.rap0
  [*] -> write [*], move [L], goto q48.c1.sk0
state q48.c2.rew:
  [<] -> write [*], move [R], goto q48.c2.ap0
  [*] -> write [*], move [L], goto q48.c2.rew
state q48.c2.fail:
  [<] -> write [*], move [R], goto q48.stuck
  [*] -> write [*], move [L], goto q48.c2.fail
state q48.c2.chk0:
  [#] -> write [*], move [R], goto q48.c2.scan
  [*] -> write [*], move [S], goto q48.c2.fail
state q48.stuck:
state q49.c0.scan:
  [>] -> write [*], move [S], goto q49.c0.rew
  [A] -> write [*], move [R], goto q49.c0.chk0
  [*] -> write [*], move [R], goto q49.c0.scan
state q48.c2.ap0:
  [A] -> write [*], move [S], goto q48.c2.mv0
  [*] -> write [*], move [R], goto q48.c2.ap0
state q48.c2.mv0:
  [*] -> write [a], move [L], goto q48.c2.sk0
state q48.c2.rap0:
  [<] -> write [*], move [R], goto q49.c0.scan
  [*] -> write [*], move [L], goto q48.c2.rap0
state q48.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q48.c2.rap0
  [*] -> write [*], move [L], goto q48.c2.sk0
state q49.c0.rew:
  [<] -> write [*], move [R], goto q49.c0.ap0
  [*] -> write [*], move [L], goto q49.c0.rew
state q49.c0.fail:
  [<] -> write [*], move [R], goto q49.c1.scan
  [*] -> write [*], move [L], goto q49.c0.fail
state q49.c0.chk0:
  [1] -> write [*], move [R], goto q49.c0.scan
  [*] -> write [*], move [S], goto q49.c0.fail
state q49.c1.scan:
  [>] -> write [*], move [S], goto q49.c1.rew
  [A] -> write [*], move [R], goto q49.c1.chk0
  [*] -> write [*], move [R], goto q49.c1.scan
state q49.c0.ap0:
  [A] -> write [*], move [S], goto q49.c0.mv0
  [*] -> write [*], move [R], goto q49.c0.ap0
state q49.c0.mv0:
  [*] -> write [a], move [L], goto q49.c0.sk0
state q49.c0.rap0:
  [<] -> write [*], move [R], goto q49.c0.scan
  [*] -> write [*], move [L], goto q49.c0.rap0
state q49.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q49.c0.rap0
  [*] -> write [*], move [L], goto q49.c0.sk0
state q49.c1.rew:
  [<] -> write [*], move [R], goto q49.c1.ap0
  [*] -> write [*], move [L], goto q49.c1.rew
state q49.c1.fail:
  [<] -> write [*], move [R], goto q49.c2.scan
  [*] -> write [*], move [L], goto q49.c1.fail
state q49.c1.chk0:
  [_] -> write [*], move [R], goto q49.c1.scan
  [*] -> write [*], move [S], goto q49.c1.fail
state q49.c2.scan:
  [>] -> write [*], move [S], goto q49.c2.rew
  [A] -> write [*], move [R], goto q49.c2.chk0
  [*] -> write [*], move [R], goto q49.c2.scan
state q49.c1.ap0:
  [A] -> write [*], move [S], goto q49.c1.mv0
  [*] -> write [*], move [R], goto q49.c1.ap0
state q49.c1.mv0:
  [*] -> write [a], move [L], goto q49.c1.sk0
state q49.c1.rap0:
  [<] -> write [*], move [R], goto q49.c0.scan
  [*] -> write [*], move [L], goto q49.c1.rap0
state q49.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q49.c1.rap0
  [*] -> write [*], move [L], goto q49.c1.sk0
state q49.c2.rew:
  [<] -> write [*], move [R], goto q50.c0.scan
  [*] -> write [*], move [L], goto q49.c2.rew
state q49.c2.fail:
  [<] -> write [*], move [R], goto q49.stuck
  [*] -> write [*], move [L], goto q49.c2.fail
state q49.c2.chk0:
  [#] -> write [*], move [R], goto q49.c2.scan
  [*] -> write [*], move [S], goto q49.c2.fail
state q49.stuck:
state q50.c0.scan:
  [>] -> write [*], move [S], goto q50.c0.rew
  [A] -> write [*], move [R], goto q50.c0.chk0
  [*] -> write [*], move [R], goto q50.c0.scan
state q50.c0.rew:
  [<] -> write [*], move [R], goto q50.c0.ap0
  [*] -> write [*], move [L], goto q50.c0.rew
state q50.c0.fail:
  [<] -> write [*], move [R], goto q50.stuck
  [*] -> write [*], move [L], goto q50.c0.fail
state q50.c0.chk0:
  [#] -> write [*], move [R], goto q50.c0.scan
  [*] -> write [*], move [S], goto q50.c0.fail
state q50.stuck:
state q51.c0.scan:
  [>] -> write [*], move [S], goto q51.c0.rew
  [*] -> write [*], move [R], goto q51.c0.scan
state q50.c0.ap0:
  [A] -> write [*], move [S], goto q50.c0.mv0
  [*] -> write [*], move [R], goto q50.c0.ap0
state q50.c0.mv0:
  [*] -> write [a], move [R], goto q50.c0.sk0
state q50.c0.rap0:
  [<] -> write [*], move [R], goto q51.c0.scan
  [*] -> write [*], move [L], goto q50.c0.rap0
state q50.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q50.c0.rap0
  [*] -> write [*], move [R], goto q50.c0.sk0
state q51.c0.rew:
  [<] -> write [*], move [R], goto q52.c0.scan
  [*] -> write [*], move [L], goto q51.c0.rew
state q51.c0.fail:
  [<] -> write [*], move [R], goto q51.stuck
  [*] -> write [*], move [L], goto q51.c0.fail
state q51.stuck:
state q52.c0.scan:
  [>] -> write [*], move [S], goto q52.c0.rew
  [A] -> write [*], move [R], goto q52.c0.chk0
  [*] -> write [*], move [R], goto q52.c0.scan
state q52.c0.rew:
  [<] -> write [*], move [R], goto q52.c0.ap0
  [*] -> write [*], move [L], goto q52.c0.rew
state q52.c0.fail:
  [<] -> write [*], move [R], goto q52.c1.scan
  [*] -> write [*], move [L], goto q52.c0.fail
state q52.c0.chk0:
  [1] -> write [*], move [R], goto q52.c0.scan
  [*] -> write [*], move [S], goto q52.c0.fail
state q52.c1.scan:
  [>] -> write [*], move [S], goto q52.c1.rew
  [A] -> write [*], move [R], goto q52.c1.chk0
  [*] -> write [*], move [R], goto q52.c1.scan
state q52.c0.ap0:
  [A] -> write [*], move [R], goto q52.c0.wr0
  [*] -> write [*], move [R], goto q52.c0.ap0
state q52.c0.mv0:
  [*] -> write [a], move [R], goto q52.c0.sk0
state q52.c0.rap0:
  [<] -> write [*], move [R], goto q52.c0.scan
  [*] -> write [*], move [L], goto q52.c0.rap0
state q52.c0.wr0:
  [*] -> write [_], move [L], goto q52.c0.mv0
state q52.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q52.c0.rap0
  [*] -> write [*], move [R], goto q52.c0.sk0
state q52.c1.rew:
  [<] -> write [*], move [R], goto q52.c1.ap0
  [*] -> write [*], move [L], goto q52.c1.rew
state q52.c1.fail:
  [<] -> write [*], move [R], goto q52.c2.scan
  [*] -> write [*], move [L], goto q52.c1.fail
state q52.c1.chk0:
  [_] -> write [*], move [R], goto q52.c1.scan
  [*] -> write [*], move [S], goto q52.c1.fail
state q52.c2.scan:
  [>] -> write [*], move [S], goto q52.c2.rew
  [A] -> write [*], move [R], goto q52.c2.chk0
  [*] -> write [*], move [R], goto q52.c2.scan
state q52.c1.ap0:
  [A] -> write [*], move [R], goto q52.c1.wr0
  [*] -> write [*], move [R], goto q52.c1.ap0
state q52.c1.mv0:
  [*] -> write [a], move [R], goto q52.c1.sk0
state q52.c1.rap0:
  [<] -> write [*], move [R], goto q52.c0.scan
  [*] -> write [*], move [L], goto q52.c1.rap0
state q52.c1.wr0:
  [*] -> write [_], move [L], goto q52.c1.mv0
state q52.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q52.c1.rap0
  [*] -> write [*], move [R], goto q52.c1.sk0
state q52.c2.rew:
  [<] -> write [*], move [R], goto q52.c2.ap0
  [*] -> write [*], move [L], goto q52.c2.rew
state q52.c2.fail:
  [<] -> write [*], move [R], goto q52.stuck
  [*] -> write [*], move [L], goto q52.c2.fail
state q52.c2.chk0:
  [#] -> write [*], move [R], goto q52.c2.scan
  [*] -> write [*], move [S], goto q52.c2.fail
state q52.stuck:
state q53.c0.scan:
  [>] -> write [*], move [S], goto q53.c0.rew
  [A] -> write [*], move [R], goto q53.c0.chk0
  [*] -> write [*], move [R], goto q53.c0.scan
state q52.c2.ap0:
  [A] -> write [*], move [S], goto q52.c2.mv0
  [*] -> write [*], move [R], goto q52.c2.ap0
state q52.c2.mv0:
  [*] -> write [a], move [L], goto q52.c2.sk0
state q52.c2.rap0:
  [<] -> write [*], move [R], goto q53.c0.scan
  [*] -> write [*], move [L], goto q52.c2.rap0
state q52.c2.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q52.c2.rap0
  [*] -> write [*], move [L], goto q52.c2.sk0
state q53.c0.rew:
  [<] -> write [*], move [R], goto q53.c0.ap0
  [*] -> write [*], move [L], goto q53.c0.rew
state q53.c0.fail:
  [<] -> write [*], move [R], goto q53.c1.scan
  [*] -> write [*], move [L], goto q53.c0.fail
state q53.c0.chk0:
  [_] -> write [*], move [R], goto q53.c0.scan
  [*] -> write [*], move [S], goto q53.c0.fail
state q53.c1.scan:
  [>] -> write [*], move [S], goto q53.c1.rew
  [A] -> write [*], move [R], goto q53.c1.chk0
  [*] -> write [*], move [R], goto q53.c1.scan
state q53.c0.ap0:
  [A] -> write [*], move [S], goto q53.c0.mv0
  [*] -> write [*], move [R], goto q53.c0.ap0
state q53.c0.mv0:
  [*] -> write [a], move [L], goto q53.c0.sk0
state q53.c0.rap0:
  [<] -> write [*], move [R], goto q53.c0.scan
  [*] -> write [*], move [L], goto q53.c0.rap0
state q53.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q53.c0.rap0
  [*] -> write [*], move [L], goto q53.c0.sk0
state q53.c1.rew:
  [<] -> write [*], move [R], goto q53.c1.ap0
  [*] -> write [*], move [L], goto q53.c1.rew
state q53.c1.fail:
  [<] -> write [*], move [R], goto q53.stuck
  [*] -> write [*], move [L], goto q53.c1.fail
state q53.c1.chk0:
  [#] -> write [*], move [R], goto q53.c1.scan
  [*] -> write [*], move [S], goto q53.c1.fail
state q53.stuck:
state q54.c0.scan:
  [>] -> write [*], move [S], goto q54.c0.rew
  [*] -> write [*], move [R], goto q54.c0.scan
state q53.c1.ap0:
  [A] -> write [*], move [S], goto q53.c1.mv0
  [*] -> write [*], move [R], goto q53.c1.ap0
state q53.c1.mv0:
  [*] -> write [a], move [R], goto q53.c1.sk0
state q53.c1.rap0:
  [<] -> write [*], move [R], goto q54.c0.scan
  [*] -> write [*], move [L], goto q53.c1.rap0
state q53.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q53.c1.rap0
  [*] -> write [*], move [R], goto q53.c1.sk0
state q54.c0.rew:
  [<] -> write [*], move [R], goto q55.c0.scan
  [*] -> write [*], move [L], goto q54.c0.rew
state q54.c0.fail:
  [<] -> write [*], move [R], goto q54.stuck
  [*] -> write [*], move [L], goto q54.c0.fail
state q54.stuck:
state q55.c0.scan:
  [>] -> write [*], move [S], goto q55.c0.rew
  [A] -> write [*], move [R], goto q55.c0.chk0
  [*] -> write [*], move [R], goto q55.c0.scan
state q55.c0.rew:
  [<] -> write [*], move [R], goto q1.c0.scan
  [*] -> write [*], move [L], goto q55.c0.rew
state q55.c0.fail:
  [<] -> write [*], move [R], goto q55.c1.scan
  [*] -> write [*], move [L], goto q55.c0.fail
state q55.c0.chk0:
  [#] -> write [*], move [R], goto q55.c0.scan
  [*] -> write [*], move [S], goto q55.c0.fail
state q55.c1.scan:
  [>] -> write [*], move [S], goto q55.c1.rew
  [A] -> write [*], move [R], goto q55.c1.chk0
  [B] -> write [*], move [R], goto q55.c1.chk1
  [*] -> write [*], move [R], goto q55.c1.scan
state q55.c1.rew:
  [<] -> write [*], move [R], goto q55.c1.ap0
  [*] -> write [*], move [L], goto q55.c1.rew
state q55.c1.fail:
  [<] -> write [*], move [R], goto q55.c2.scan
  [*] -> write [*], move [L], goto q55.c1.fail
state q55.c1.chk0:
  [_] -> write [*], move [R], goto q55.c1.scan
  [*] -> write [*], move [S], goto q55.c1.fail
state q55.c1.chk1:
  [1] -> write [*], move [R], goto q55.c1.scan
  [*] -> write [*], move [S], goto q55.c1.fail
state q55.c2.scan:
  [>] -> write [*], move [S], goto q55.c2.rew
  [B] -> write [*], move [R], goto q55.c2.chk1
  [*] -> write [*], move [R], goto q55.c2.scan
state q55.c1.ap1:
  [B] -> write [*], move [S], goto q55.c1.mv1
  [*] -> write [*], move [R], goto q55.c1.ap1
state q55.c1.mv1:
  [*] -> write [b], move [R], goto q55.c1.sk1
state q55.c1.rap1:
  [<] -> write [*], move [R], goto q55.c0.scan
  [*] -> write [*], move [L], goto q55.c1.rap1
state q55.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q55.c1.rap1
  [*] -> write [*], move [R], goto q55.c1.sk1
state q55.c1.ap0:
  [A] -> write [*], move [R], goto q55.c1.wr0
  [*] -> write [*], move [R], goto q55.c1.ap0
state q55.c1.mv0:
  [*] -> write [a], move [R], goto q55.c1.sk0
state q55.c1.rap0:
  [<] -> write [*], move [R], goto q55.c1.ap1
  [*] -> write [*], move [L], goto q55.c1.rap0
state q55.c1.wr0:
  [*] -> write [1], move [L], goto q55.c1.mv0
state q55.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q55.c1.rap0
  [*] -> write [*], move [R], goto q55.c1.sk0
state q55.c2.rew:
  [<] -> write [*], move [R], goto q56.c0.scan
  [*] -> write [*], move [L], goto q55.c2.rew
state q55.c2.fail:
  [<] -> write [*], move [R], goto q55.stuck
  [*] -> write [*], move [L], goto q55.c2.fail
state q55.c2.chk1:
  [_] -> write [*], move [R], goto q55.c2.scan
  [*] -> write [*], move [S], goto q55.c2.fail
state q55.stuck:
state q56.c0.scan:
  [>] -> write [*], move [S], goto q56.c0.rew
  [A] -> write [*], move [R], goto q56.c0.chk0
  [*] -> write [*], move [R], goto q56.c0.scan
state q56.c0.rew:
  [<] -> write [*], move [R], goto q56.c0.ap0
  [*] -> write [*], move [L], goto q56.c0.rew
state q56.c0.fail:
  [<] -> write [*], move [R], goto q56.c1.scan
  [*] -> write [*], move [L], goto q56.c0.fail
state q56.c0.chk0:
  [1] -> write [*], move [R], goto q56.c0.scan
  [*] -> write [*], move [S], goto q56.c0.fail
state q56.c1.scan:
  [>] -> write [*], move [S], goto q56.c1.rew
  [A] -> write [*], move [R], goto q56.c1.chk0
  [*] -> write [*], move [R], goto q56.c1.scan
state q56.c0.ap0:
  [A] -> write [*], move [S], goto q56.c0.mv0
  [*] -> write [*], move [R], goto q56.c0.ap0
state q56.c0.mv0:
  [*] -> write [a], move [L], goto q56.c0.sk0
state q56.c0.rap0:
  [<] -> write [*], move [R], goto q56.c0.scan
  [*] -> write [*], move [L], goto q56.c0.rap0
state q56.c0.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q56.c0.rap0
  [*] -> write [*], move [L], goto q56.c0.sk0
state q56.c1.rew:
  [<] -> write [*], move [R], goto q56.c1.ap0
  [*] -> write [*], move [L], goto q56.c1.rew
state q56.c1.fail:
  [<] -> write [*], move [R], goto q56.c2.scan
  [*] -> write [*], move [L], goto q56.c1.fail
state q56.c1.chk0:
  [_] -> write [*], move [R], goto q56.c1.scan
  [*] -> write [*], move [S], goto q56.c1.fail
state q56.c2.scan:
  [>] -> write [*], move [S], goto q56.c2.rew
  [A] -> write [*], move [R], goto q56.c2.chk0
  [*] -> write [*], move [R], goto q56.c2.scan
state q56.c1.ap0:
  [A] -> write [*], move [S], goto q56.c1.mv0
  [*] -> write [*], move [R], goto q56.c1.ap0
state q56.c1.mv0:
  [*] -> write [a], move [L], goto q56.c1.sk0
state q56.c1.rap0:
  [<] -> write [*], move [R], goto q56.c0.scan
  [*] -> write [*], move [L], goto q56.c1.rap0
state q56.c1.sk0:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [a] -> write [A], move [S], goto q56.c1.rap0
  [*] -> write [*], move [L], goto q56.c1.sk0
state q56.c2.rew:
  [<] -> write [*], move [R], goto q57.c0.scan
  [*] -> write [*], move [L], goto q56.c2.rew
state q56.c2.fail:
  [<] -> write [*], move [R], goto q56.stuck
  [*] -> write [*], move [L], goto q56.c2.fail
state q56.c2.chk0:
  [#] -> write [*], move [R], goto q56.c2.scan
  [*] -> write [*], move [S], goto q56.c2.fail
state q56.stuck:
state q57.c0.scan:
  [>] -> write [*], move [S], goto q57.c0.rew
  [*] -> write [*], move [R], goto q57.c0.scan
state q57.c0.rew:
  [<] -> write [*], move [R], goto q57.c0.ap1
  [*] -> write [*], move [L], goto q57.c0.rew
state q57.c0.fail:
  [<] -> write [*], move [R], goto q57.stuck
  [*] -> write [*], move [L], goto q57.c0.fail
state q57.stuck:
state q58.c0.scan:
  [>] -> write [*], move [S], goto q58.c0.rew
  [B] -> write [*], move [R], goto q58.c0.chk1
  [*] -> write [*], move [R], goto q58.c0.scan
state q57.c0.ap1:
  [B] -> write [*], move [S], goto q57.c0.mv1
  [*] -> write [*], move [R], goto q57.c0.ap1
state q57.c0.mv1:
  [*] -> write [b], move [L], goto q57.c0.sk1
state q57.c0.rap1:
  [<] -> write [*], move [R], goto q58.c0.scan
  [*] -> write [*], move [L], goto q57.c0.rap1
state q57.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q57.c0.rap1
  [*] -> write [*], move [L], goto q57.c0.sk1
state q58.c0.rew:
  [<] -> write [*], move [R], goto q58.c0.ap1
  [*] -> write [*], move [L], goto q58.c0.rew
state q58.c0.fail:
  [<] -> write [*], move [R], goto q58.c1.scan
  [*] -> write [*], move [L], goto q58.c0.fail
state q58.c0.chk1:
  [1] -> write [*], move [R], goto q58.c0.scan
  [*] -> write [*], move [S], goto q58.c0.fail
state q58.c1.scan:
  [>] -> write [*], move [S], goto q58.c1.rew
  [B] -> write [*], move [R], goto q58.c1.chk1
  [*] -> write [*], move [R], goto q58.c1.scan
state q58.c0.ap1:
  [B] -> write [*], move [S], goto q58.c0.mv1
  [*] -> write [*], move [R], goto q58.c0.ap1
state q58.c0.mv1:
  [*] -> write [b], move [L], goto q58.c0.sk1
state q58.c0.rap1:
  [<] -> write [*], move [R], goto q58.c0.scan
  [*] -> write [*], move [L], goto q58.c0.rap1
state q58.c0.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q58.c0.rap1
  [*] -> write [*], move [L], goto q58.c0.sk1
state q58.c1.rew:
  [<] -> write [*], move [R], goto q58.c1.ap1
  [*] -> write [*], move [L], goto q58.c1.rew
state q58.c1.fail:
  [<] -> write [*], move [R], goto q58.stuck
  [*] -> write [*], move [L], goto q58.c1.fail
state q58.c1.chk1:
  [_] -> write [*], move [R], goto q58.c1.scan
  [*] -> write [*], move [S], goto q58.c1.fail
state q58.stuck:
state q59.c0.scan:
  [>] -> write [*], move [S], goto q59.c0.rew
  [*] -> write [*], move [R], goto q59.c0.scan
state q58.c1.ap1:
  [B] -> write [*], move [S], goto q58.c1.mv1
  [*] -> write [*], move [R], goto q58.c1.ap1
state q58.c1.mv1:
  [*] -> write [b], move [R], goto q58.c1.sk1
state q58.c1.rap1:
  [<] -> write [*], move [R], goto q59.c0.scan
  [*] -> write [*], move [L], goto q58.c1.rap1
state q58.c1.sk1:
  [<] -> write [*], move [S], goto overflow
  [>] -> write [*], move [S], goto overflow
  [b] -> write [B], move [S], goto q58.c1.rap1
  [*] -> write [*], move [R], goto q58.c1.sk1
state q59.c0.rew:
  [<] -> write [*], move [R], goto q5.c0.scan
  [*] -> write [*], move [L], goto q59.c0.rew
state q59.c0.fail:
  [<] -> write [*], move [R], goto q59.stuck
  [*] -> write [*], move [L], goto q59.c0.fail
state q59.stuck:
