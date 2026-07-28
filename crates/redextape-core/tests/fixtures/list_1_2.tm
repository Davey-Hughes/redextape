tapes 5
start pc0
version 1
encoding unary
width 4
slots 5
result List<Nat>
tape 0 #____#____#____#____#____#  ; reg

state halt: accept
state overflow:
state pc0:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl1s2.s.sk0
state pc1:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl3s3.s.sk0
state pc2:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk0
state pc3:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto pc3
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons5.h.c.cwb
state pc4:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto pc4
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons6.h.c.cwb
state pc5:
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
state wl4s4.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk1
state wl4s4.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk2
state wl4s4.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk3
state wl4s4.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.s.sk4
state wl4s4.s.sk4:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto wl4s4.blank
state wl4s4.blank:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto wl4s4.blank
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto wl4s4.blank
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.back
state wl4s4.back:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.back
  [# * * * *] -> write [* * * * *], move [R S S S S], goto wl4s4.start
state wl4s4.start:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.start
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.start
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw3
state wl4s4.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw2
state wl4s4.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw1
state wl4s4.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw0
state wl4s4.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto wl4s4.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto wl4s4.r.home
state wl4s4.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc3
state cons5.h.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons5.h.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.h.c.cwh
state cons5.h.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk0
state cons5.h.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk1
state cons5.h.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk2
state cons5.h.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.h.s.sk3
state cons5.h.s.sk3:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons5.h.cp
state cons5.h.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons5.h.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons5.h.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons5.h.rin
state cons5.h.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw2
state cons5.h.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw1
state cons5.h.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw0
state cons5.h.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.h.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons5.h.r.home
state cons5.h.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons5.h.w.wk
state cons5.h.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons5.h.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.h.w.wkh
state cons5.h.w.wkh:
  [* * * * *] -> write [* * * @ *], move [S S S R S], goto cons5.oc.cp
state cons5.oc.cp:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons5.oc.cp
  [* _ * * *] -> write [* * * # *], move [S S S R S], goto cons5.oc.term
state cons5.oc.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons5.oc.wk
state cons5.oc.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons5.oc.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.oc.wkh
state cons5.oc.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons5.oc.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons5.t.c.cwb
state cons5.t.c.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons5.t.c.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.t.c.cwh
state cons5.t.c.cwh:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk0
state cons5.t.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk1
state cons5.t.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk2
state cons5.t.s.sk2:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk2
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk3
state cons5.t.s.sk3:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk3
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.t.s.sk4
state cons5.t.s.sk4:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons5.t.cp
state cons5.t.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons5.t.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons5.t.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons5.t.rin
state cons5.t.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw3
state cons5.t.r.rw3:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw3
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw2
state cons5.t.r.rw2:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw2
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw1
state cons5.t.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw0
state cons5.t.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.t.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons5.t.r.home
state cons5.t.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons5.t.w.wk
state cons5.t.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons5.t.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.t.w.wkh
state cons5.t.w.wkh:
  [* 1 * * *] -> write [* * * 1 *], move [S R S R S], goto cons5.t.w.wkh
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons5.aw.term
state cons5.aw.term:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons5.aw.wk
state cons5.aw.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons5.aw.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.aw.wkh
state cons5.aw.wkh:
  [* 1 * * *] -> write [* * * * *], move [S R S S S], goto cons5.aw.wkh
  [* _ * * *] -> write [* * * * *], move [S L S S S], goto cons5.cc.cl.cwb
state cons5.cc.cl.cwb:
  [* 1 * * *] -> write [* _ * * *], move [S L S S S], goto cons5.cc.cl.cwb
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.cc.cl.cwh
state cons5.cc.cl.cwh:
  [* * * _ *] -> write [* * * * *], move [S S S L S], goto cons5.cc.sl
state cons5.cc.sl:
  [* * * @ *] -> write [* 1 * * *], move [S R S L S], goto cons5.cc.sl
  [* * * 1 *] -> write [* * * * *], move [S S S L S], goto cons5.cc.sl
  [* * * # *] -> write [* * * * *], move [S S S L S], goto cons5.cc.sl
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons5.cc.ct
state cons5.cc.ct:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons5.cc.w.wk
state cons5.cc.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons5.cc.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.cc.w.wkh
state cons5.cc.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto cons5.cc.sr
state cons5.cc.sr:
  [* * * @ *] -> write [* * * * *], move [S S S R S], goto cons5.cc.sr
  [* * * 1 *] -> write [* * * * *], move [S S S R S], goto cons5.cc.sr
  [* * * # *] -> write [* * * * *], move [S S S R S], goto cons5.cc.sr
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto cons5.cc.top
state cons5.cc.top:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk0
state cons5.wr.s.sk0:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk0
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk1
state cons5.wr.s.sk1:
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk1
  [_ * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.s.sk2
state cons5.wr.s.sk2:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons5.wr.bl
state cons5.wr.bl:
  [1 * * * *] -> write [_ * * * *], move [R S S S S], goto cons5.wr.bl
  [_ * * * *] -> write [_ * * * *], move [R S S S S], goto cons5.wr.bl
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.bk
state cons5.wr.bk:
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.bk
  [# * * * *] -> write [* * * * *], move [R S S S S], goto cons5.wr.st
state cons5.wr.st:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons5.wr.wr
state cons5.wr.wr:
  [# * * * *] -> write [* * * * *], move [S S S S S], goto overflow
  [_ 1 * * *] -> write [1 * * * *], move [R R S S S], goto cons5.wr.wr
  [* _ * * *] -> write [* * * * *], move [S S S S S], goto cons5.wr.rin
state cons5.wr.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.rin
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.r.rw1
state cons5.wr.r.rw1:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.r.rw1
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.r.rw0
state cons5.wr.r.rw0:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.r.rw0
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons5.wr.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons5.wr.r.home
state cons5.wr.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons5.wr.w.wk
state cons5.wr.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons5.wr.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons5.wr.w.wkh
state cons5.wr.w.wkh:
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
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.cp
state cons6.h.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons6.h.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.h.rin
state cons6.h.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.h.rin
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
  [* * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.cp
state cons6.t.cp:
  [1 * * * *] -> write [* 1 * * *], move [R R S S S], goto cons6.t.cp
  [_ * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.rin
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.t.rin
state cons6.t.rin:
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.rin
  [_ * * * *] -> write [* * * * *], move [L S S S S], goto cons6.t.rin
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
  [# * * * *] -> write [* * * * *], move [S S S S S], goto cons6.wr.r.home
state cons6.wr.r.home:
  [* * * * *] -> write [* * * * *], move [S L S S S], goto cons6.wr.w.wk
state cons6.wr.w.wk:
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto cons6.wr.w.wk
  [* _ * * *] -> write [* * * * *], move [S R S S S], goto cons6.wr.w.wkh
state cons6.wr.w.wkh:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc5
