tapes 5
start pc0
version 1
encoding unary
width 4
slots 7
result List<Nat>
tape 0 #____#____#____#____#____#____#____#  ; reg

state halt: accept
state overflow:
state pc0:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl1s2.s.sk0
state pc1:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk0
state pc2:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk0
state pc3:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk0
state pc4:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto pc4
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons6.h.c.cwb
state pc5:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto pc5
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons7.h.c.cwb
state pc6:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto pc6
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons8.h.c.cwb
state pc7:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto halt
state wl1s2.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl1s2.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl1s2.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl1s2.s.sk1
state wl1s2.s.sk1:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto wl1s2.blank
state wl1s2.blank:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto wl1s2.blank
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto wl1s2.blank
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.back
state wl1s2.back:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.back
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl1s2.start
state wl1s2.start:
  [_ * * * *] -> write [1 * * * *], move [R S S S S], goto wl1s2.m0
state wl1s2.m0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.m0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.m0
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.r.rw0
state wl1s2.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl1s2.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto wl1s2.r.home
state wl1s2.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc1
state wl3s3.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk1
state wl3s3.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk2
state wl3s3.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk3
state wl3s3.s.sk3:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto wl3s3.blank
state wl3s3.blank:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto wl3s3.blank
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto wl3s3.blank
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.back
state wl3s3.back:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.back
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.start
state wl3s3.start:
  [_ * * * *] -> write [1 * * * *], move [R S S S S], goto wl3s3.m0
state wl3s3.m0:
  [_ * * * *] -> write [1 * * * *], move [R S S S S], goto wl3s3.m1
state wl3s3.m1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.m1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.m1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw2
state wl3s3.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw1
state wl3s3.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw0
state wl3s3.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl3s3.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto wl3s3.r.home
state wl3s3.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc2
state wl5s4.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk1
state wl5s4.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk2
state wl5s4.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk3
state wl5s4.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk4
state wl5s4.s.sk4:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk4
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk4
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.s.sk5
state wl5s4.s.sk5:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto wl5s4.blank
state wl5s4.blank:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto wl5s4.blank
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto wl5s4.blank
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.back
state wl5s4.back:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.back
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl5s4.start
state wl5s4.start:
  [_ * * * *] -> write [1 * * * *], move [R S S S S], goto wl5s4.m0
state wl5s4.m0:
  [_ * * * *] -> write [1 * * * *], move [R S S S S], goto wl5s4.m1
state wl5s4.m1:
  [_ * * * *] -> write [1 * * * *], move [R S S S S], goto wl5s4.m2
state wl5s4.m2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.m2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.m2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw4
state wl5s4.r.rw4:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw4
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw4
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw3
state wl5s4.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw2
state wl5s4.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw1
state wl5s4.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw0
state wl5s4.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl5s4.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto wl5s4.r.home
state wl5s4.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc3
state wl6s5.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk1
state wl6s5.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk2
state wl6s5.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk3
state wl6s5.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk4
state wl6s5.s.sk4:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk4
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk4
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk5
state wl6s5.s.sk5:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk5
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk5
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.s.sk6
state wl6s5.s.sk6:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto wl6s5.blank
state wl6s5.blank:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto wl6s5.blank
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto wl6s5.blank
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.back
state wl6s5.back:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.back
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl6s5.start
state wl6s5.start:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.start
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.start
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw5
state wl6s5.r.rw5:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw5
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw5
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw4
state wl6s5.r.rw4:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw4
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw4
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw3
state wl6s5.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw2
state wl6s5.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw1
state wl6s5.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw0
state wl6s5.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl6s5.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto wl6s5.r.home
state wl6s5.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc4
state cons6.h.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons6.h.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.h.c.cwh
state cons6.h.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk0
state cons6.h.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk1
state cons6.h.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk2
state cons6.h.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk3
state cons6.h.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk4
state cons6.h.s.sk4:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk4
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk4
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.h.s.sk5
state cons6.h.s.sk5:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.cp
state cons6.h.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons6.h.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.rin
state cons6.h.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw4
state cons6.h.r.rw4:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw4
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw4
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw3
state cons6.h.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw2
state cons6.h.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw1
state cons6.h.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw0
state cons6.h.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.r.home
state cons6.h.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.h.w.wk
state cons6.h.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.h.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.h.w.wkh
state cons6.h.w.wkh:
  [* * * * *] -> write [* * * @ *], move [S S S R S], goto cons6.oc.cp
state cons6.oc.cp:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons6.oc.cp
  [* _ * * *] -> write [* * * # *], move [S S S R S], goto cons6.oc.term
state cons6.oc.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.oc.wk
state cons6.oc.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.oc.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.oc.wkh
state cons6.oc.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons6.oc.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons6.t.c.cwb
state cons6.t.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons6.t.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.t.c.cwh
state cons6.t.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk0
state cons6.t.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk1
state cons6.t.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk2
state cons6.t.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk3
state cons6.t.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk4
state cons6.t.s.sk4:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk4
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk4
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk5
state cons6.t.s.sk5:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk5
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk5
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.t.s.sk6
state cons6.t.s.sk6:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.cp
state cons6.t.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons6.t.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.rin
state cons6.t.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw5
state cons6.t.r.rw5:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw5
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw5
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw4
state cons6.t.r.rw4:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw4
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw4
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw3
state cons6.t.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw2
state cons6.t.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw1
state cons6.t.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw0
state cons6.t.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.r.home
state cons6.t.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.t.w.wk
state cons6.t.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.t.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.t.w.wkh
state cons6.t.w.wkh:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons6.t.w.wkh
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons6.aw.term
state cons6.aw.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.aw.wk
state cons6.aw.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.aw.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.aw.wkh
state cons6.aw.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons6.aw.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons6.cc.cl.cwb
state cons6.cc.cl.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons6.cc.cl.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.cc.cl.cwh
state cons6.cc.cl.cwh:
  [* * * _ *] -> write [* * * * *], move [S S S L S], goto cons6.cc.sl
state cons6.cc.sl:
  [* * * @ *] -> write [* 1 * * *], move [S R S L S], goto cons6.cc.sl
  [* * * 1 *] -> write [* * * * *], move [S S S L S], goto cons6.cc.sl
  [* * * # *] -> write [* * * * *], move [S S S L S], goto cons6.cc.sl
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons6.cc.ct
state cons6.cc.ct:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.cc.w.wk
state cons6.cc.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.cc.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.cc.w.wkh
state cons6.cc.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto cons6.cc.sr
state cons6.cc.sr:
  [* * * @ *] -> write [* * * * *], move [S S S R S], goto cons6.cc.sr
  [* * * 1 *] -> write [* * * * *], move [S S S R S], goto cons6.cc.sr
  [* * * # *] -> write [* * * * *], move [S S S R S], goto cons6.cc.sr
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons6.cc.top
state cons6.cc.top:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk0
state cons6.wr.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk1
state cons6.wr.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk2
state cons6.wr.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk3
state cons6.wr.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.s.sk4
state cons6.wr.s.sk4:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons6.wr.bl
state cons6.wr.bl:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto cons6.wr.bl
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto cons6.wr.bl
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.bk
state cons6.wr.bk:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.bk
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons6.wr.st
state cons6.wr.st:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons6.wr.wr
state cons6.wr.wr:
  [# * * * *] -> write [* * * * *], move [S S S S S], goto overflow
  [_ 1 * * *] -> write [1 * * * *], move [R R S S S], goto cons6.wr.wr
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons6.wr.rin
state cons6.wr.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw3
state cons6.wr.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw2
state cons6.wr.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw1
state cons6.wr.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw0
state cons6.wr.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.wr.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.wr.r.home
state cons6.wr.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.wr.w.wk
state cons6.wr.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.wr.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.wr.w.wkh
state cons6.wr.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc5
state cons7.h.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons7.h.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.h.c.cwh
state cons7.h.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk0
state cons7.h.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk1
state cons7.h.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk2
state cons7.h.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.h.s.sk3
state cons7.h.s.sk3:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons7.h.cp
state cons7.h.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons7.h.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons7.h.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons7.h.rin
state cons7.h.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw2
state cons7.h.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw1
state cons7.h.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw0
state cons7.h.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.h.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons7.h.r.home
state cons7.h.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons7.h.w.wk
state cons7.h.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons7.h.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.h.w.wkh
state cons7.h.w.wkh:
  [* * * * *] -> write [* * * @ *], move [S S S R S], goto cons7.oc.cp
state cons7.oc.cp:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons7.oc.cp
  [* _ * * *] -> write [* * * # *], move [S S S R S], goto cons7.oc.term
state cons7.oc.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons7.oc.wk
state cons7.oc.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons7.oc.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.oc.wkh
state cons7.oc.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons7.oc.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons7.t.c.cwb
state cons7.t.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons7.t.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.t.c.cwh
state cons7.t.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk0
state cons7.t.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk1
state cons7.t.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk2
state cons7.t.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk3
state cons7.t.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.t.s.sk4
state cons7.t.s.sk4:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons7.t.cp
state cons7.t.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons7.t.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons7.t.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons7.t.rin
state cons7.t.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw3
state cons7.t.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw2
state cons7.t.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw1
state cons7.t.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw0
state cons7.t.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.t.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons7.t.r.home
state cons7.t.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons7.t.w.wk
state cons7.t.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons7.t.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.t.w.wkh
state cons7.t.w.wkh:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons7.t.w.wkh
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons7.aw.term
state cons7.aw.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons7.aw.wk
state cons7.aw.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons7.aw.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.aw.wkh
state cons7.aw.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons7.aw.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons7.cc.cl.cwb
state cons7.cc.cl.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons7.cc.cl.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.cc.cl.cwh
state cons7.cc.cl.cwh:
  [* * * _ *] -> write [* * * * *], move [S S S L S], goto cons7.cc.sl
state cons7.cc.sl:
  [* * * @ *] -> write [* 1 * * *], move [S R S L S], goto cons7.cc.sl
  [* * * 1 *] -> write [* * * * *], move [S S S L S], goto cons7.cc.sl
  [* * * # *] -> write [* * * * *], move [S S S L S], goto cons7.cc.sl
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons7.cc.ct
state cons7.cc.ct:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons7.cc.w.wk
state cons7.cc.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons7.cc.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.cc.w.wkh
state cons7.cc.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto cons7.cc.sr
state cons7.cc.sr:
  [* * * @ *] -> write [* * * * *], move [S S S R S], goto cons7.cc.sr
  [* * * 1 *] -> write [* * * * *], move [S S S R S], goto cons7.cc.sr
  [* * * # *] -> write [* * * * *], move [S S S R S], goto cons7.cc.sr
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons7.cc.top
state cons7.cc.top:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk0
state cons7.wr.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk1
state cons7.wr.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.s.sk2
state cons7.wr.s.sk2:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons7.wr.bl
state cons7.wr.bl:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto cons7.wr.bl
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto cons7.wr.bl
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.bk
state cons7.wr.bk:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.bk
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons7.wr.st
state cons7.wr.st:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons7.wr.wr
state cons7.wr.wr:
  [# * * * *] -> write [* * * * *], move [S S S S S], goto overflow
  [_ 1 * * *] -> write [1 * * * *], move [R R S S S], goto cons7.wr.wr
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons7.wr.rin
state cons7.wr.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.r.rw1
state cons7.wr.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.r.rw0
state cons7.wr.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons7.wr.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons7.wr.r.home
state cons7.wr.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons7.wr.w.wk
state cons7.wr.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons7.wr.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons7.wr.w.wkh
state cons7.wr.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc6
state cons8.h.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons8.h.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.h.c.cwh
state cons8.h.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.h.s.sk0
state cons8.h.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons8.h.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons8.h.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.h.s.sk1
state cons8.h.s.sk1:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons8.h.cp
state cons8.h.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons8.h.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons8.h.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons8.h.rin
state cons8.h.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons8.h.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.h.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons8.h.r.rw0
state cons8.h.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons8.h.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.h.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons8.h.r.home
state cons8.h.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons8.h.w.wk
state cons8.h.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons8.h.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.h.w.wkh
state cons8.h.w.wkh:
  [* * * * *] -> write [* * * @ *], move [S S S R S], goto cons8.oc.cp
state cons8.oc.cp:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons8.oc.cp
  [* _ * * *] -> write [* * * # *], move [S S S R S], goto cons8.oc.term
state cons8.oc.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons8.oc.wk
state cons8.oc.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons8.oc.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.oc.wkh
state cons8.oc.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons8.oc.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons8.t.c.cwb
state cons8.t.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons8.t.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.t.c.cwh
state cons8.t.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk0
state cons8.t.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk1
state cons8.t.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.t.s.sk2
state cons8.t.s.sk2:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons8.t.cp
state cons8.t.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons8.t.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons8.t.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons8.t.rin
state cons8.t.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.r.rw1
state cons8.t.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.r.rw0
state cons8.t.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.t.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons8.t.r.home
state cons8.t.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons8.t.w.wk
state cons8.t.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons8.t.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.t.w.wkh
state cons8.t.w.wkh:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons8.t.w.wkh
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons8.aw.term
state cons8.aw.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons8.aw.wk
state cons8.aw.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons8.aw.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.aw.wkh
state cons8.aw.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons8.aw.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons8.cc.cl.cwb
state cons8.cc.cl.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons8.cc.cl.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.cc.cl.cwh
state cons8.cc.cl.cwh:
  [* * * _ *] -> write [* * * * *], move [S S S L S], goto cons8.cc.sl
state cons8.cc.sl:
  [* * * @ *] -> write [* 1 * * *], move [S R S L S], goto cons8.cc.sl
  [* * * 1 *] -> write [* * * * *], move [S S S L S], goto cons8.cc.sl
  [* * * # *] -> write [* * * * *], move [S S S L S], goto cons8.cc.sl
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons8.cc.ct
state cons8.cc.ct:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons8.cc.w.wk
state cons8.cc.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons8.cc.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.cc.w.wkh
state cons8.cc.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto cons8.cc.sr
state cons8.cc.sr:
  [* * * @ *] -> write [* * * * *], move [S S S R S], goto cons8.cc.sr
  [* * * 1 *] -> write [* * * * *], move [S S S R S], goto cons8.cc.sr
  [* * * # *] -> write [* * * * *], move [S S S R S], goto cons8.cc.sr
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons8.cc.top
state cons8.cc.top:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.wr.s.sk0
state cons8.wr.s.sk0:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons8.wr.bl
state cons8.wr.bl:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto cons8.wr.bl
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto cons8.wr.bl
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons8.wr.bk
state cons8.wr.bk:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.wr.bk
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons8.wr.st
state cons8.wr.st:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons8.wr.wr
state cons8.wr.wr:
  [# * * * *] -> write [* * * * *], move [S S S S S], goto overflow
  [_ 1 * * *] -> write [1 * * * *], move [R R S S S], goto cons8.wr.wr
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons8.wr.rin
state cons8.wr.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons8.wr.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons8.wr.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons8.wr.r.home
state cons8.wr.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons8.wr.w.wk
state cons8.wr.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons8.wr.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons8.wr.w.wkh
state cons8.wr.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc7
