tapes 5
start pc0
version 1
encoding binary
width 4
slots 5
result List<Nat>
tape 0 #0000#0000#0000#0000#0000#  ; reg
tape 1 #0000#  ; work

state halt: accept
state overflow:
state pc0:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl1s2.s.sk0
state pc1:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk0
state pc2:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk0
state pc3:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk0
state pc4:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lh.ss.sk0
state pc5:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto halt
state bwl1s2.s.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl1s2.s.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl1s2.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl1s2.s.sk1
state bwl1s2.s.sk1:
  [0 * * * *] -> write [1 * * * *], move [R S S S S], goto bwl1s2.b0
  [1 * * * *] -> write [1 * * * *], move [R S S S S], goto bwl1s2.b0
state bwl1s2.b0:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl1s2.b1
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl1s2.b1
state bwl1s2.b1:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl1s2.b2
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl1s2.b2
state bwl1s2.b2:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl1s2.b3
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl1s2.b3
state bwl1s2.b3:
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl1s2.bk
state bwl1s2.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl1s2.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl1s2.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl1s2.r.rw0
state bwl1s2.r.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl1s2.r.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl1s2.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bwl1s2.r.home
state bwl1s2.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc1
state bwl3s3.s.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk1
state bwl3s3.s.sk1:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk1
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk2
state bwl3s3.s.sk2:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk2
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl3s3.s.sk3
state bwl3s3.s.sk3:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl3s3.b0
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl3s3.b0
state bwl3s3.b0:
  [0 * * * *] -> write [1 * * * *], move [R S S S S], goto bwl3s3.b1
  [1 * * * *] -> write [1 * * * *], move [R S S S S], goto bwl3s3.b1
state bwl3s3.b1:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl3s3.b2
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl3s3.b2
state bwl3s3.b2:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl3s3.b3
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl3s3.b3
state bwl3s3.b3:
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.bk
state bwl3s3.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw2
state bwl3s3.r.rw2:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw2
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw1
state bwl3s3.r.rw1:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw1
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw0
state bwl3s3.r.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl3s3.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bwl3s3.r.home
state bwl3s3.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc2
state bwl4s4.s.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk1
state bwl4s4.s.sk1:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk1
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk2
state bwl4s4.s.sk2:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk2
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk3
state bwl4s4.s.sk3:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk3
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bwl4s4.s.sk4
state bwl4s4.s.sk4:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b0
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b0
state bwl4s4.b0:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b1
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b1
state bwl4s4.b1:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b2
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b2
state bwl4s4.b2:
  [0 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b3
  [1 * * * *] -> write [0 * * * *], move [R S S S S], goto bwl4s4.b3
state bwl4s4.b3:
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.bk
state bwl4s4.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw3
state bwl4s4.r.rw3:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw3
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw2
state bwl4s4.r.rw2:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw2
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw1
state bwl4s4.r.rw1:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw1
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw0
state bwl4s4.r.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bwl4s4.r.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bwl4s4.r.home
state bwl4s4.r.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc3
state bcons5.lh.ss.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk1
state bcons5.lh.ss.sk1:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk1
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk2
state bcons5.lh.ss.sk2:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk2
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lh.ss.sk3
state bcons5.lh.ss.sk3:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.lh.ds.sk0
state bcons5.lh.ds.sk0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c0
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c0
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c0
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c0
state bcons5.lh.c0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c1
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c1
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c1
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c1
state bcons5.lh.c1:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c2
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c2
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c2
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c2
state bcons5.lh.c2:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c3
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lh.c3
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c3
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lh.c3
state bcons5.lh.c3:
  [# # * * *] -> write [* * * * *], move [L L S S S], goto bcons5.lh.bk
state bcons5.lh.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw2
state bcons5.lh.r1.rw2:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw2
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw1
state bcons5.lh.r1.rw1:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw1
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw0
state bcons5.lh.r1.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lh.r1.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bcons5.lh.r1.home
state bcons5.lh.r1.home:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.lh.r1.home
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.lh.r1.home
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.lh.r2.home
state bcons5.lh.r2.home:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.oc.s.sk0
state bcons5.oc.s.sk0:
  [* * * _ *] -> write [* * * @ *], move [S S S R S], goto bcons5.oc.at
state bcons5.oc.at:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.oc.c0
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.oc.c0
state bcons5.oc.c0:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.oc.c1
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.oc.c1
state bcons5.oc.c1:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.oc.c2
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.oc.c2
state bcons5.oc.c2:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.oc.c3
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.oc.c3
state bcons5.oc.c3:
  [* # * _ *] -> write [* * * # *], move [S L S R S], goto bcons5.oc.t
state bcons5.oc.t:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.oc.t
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.oc.t
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.oc.r.home
state bcons5.oc.r.home:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk0
state bcons5.lt.ss.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk1
state bcons5.lt.ss.sk1:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk1
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk2
state bcons5.lt.ss.sk2:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk2
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk2
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk3
state bcons5.lt.ss.sk3:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk3
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk3
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.lt.ss.sk4
state bcons5.lt.ss.sk4:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.lt.ds.sk0
state bcons5.lt.ds.sk0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c0
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c0
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c0
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c0
state bcons5.lt.c0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c1
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c1
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c1
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c1
state bcons5.lt.c1:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c2
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c2
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c2
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c2
state bcons5.lt.c2:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c3
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons5.lt.c3
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c3
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons5.lt.c3
state bcons5.lt.c3:
  [# # * * *] -> write [* * * * *], move [L L S S S], goto bcons5.lt.bk
state bcons5.lt.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw3
state bcons5.lt.r1.rw3:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw3
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw3
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw2
state bcons5.lt.r1.rw2:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw2
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw2
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw1
state bcons5.lt.r1.rw1:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw1
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw0
state bcons5.lt.r1.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.lt.r1.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bcons5.lt.r1.home
state bcons5.lt.r1.home:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.lt.r1.home
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.lt.r1.home
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.lt.r2.home
state bcons5.lt.r2.home:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.at.s.sk0
state bcons5.at.s.sk0:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.at.c0
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.at.c0
state bcons5.at.c0:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.at.c1
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.at.c1
state bcons5.at.c1:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.at.c2
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.at.c2
state bcons5.at.c2:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons5.at.c3
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons5.at.c3
state bcons5.at.c3:
  [* # * * *] -> write [* * * * *], move [S L S S S], goto bcons5.at.bk
state bcons5.at.bk:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.at.bk
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.at.bk
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.at.r.home
state bcons5.at.r.home:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.z.s.sk0
state bcons5.z.s.sk0:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z0
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z0
state bcons5.z.z0:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z1
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z1
state bcons5.z.z1:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z2
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z2
state bcons5.z.z2:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z3
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.z.z3
state bcons5.z.z3:
  [* # * * *] -> write [* * * * *], move [S L S S S], goto bcons5.z.bk
state bcons5.z.bk:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.z.bk
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.z.bk
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.z.r.home
state bcons5.z.r.home:
  [* * * _ *] -> write [* * * * *], move [S S S L S], goto bcons5.cc.rw.wl
state bcons5.cc.rw.wl:
  [* * * @ *] -> write [* * * * *], move [S S S L S], goto bcons5.cc.rw.wl
  [* * * # *] -> write [* * * * *], move [S S S L S], goto bcons5.cc.rw.wl
  [* * * 0 *] -> write [* * * * *], move [S S S L S], goto bcons5.cc.rw.wl
  [* * * 1 *] -> write [* * * * *], move [S S S L S], goto bcons5.cc.rw.wl
  [* * * _ *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.rw.on
state bcons5.cc.rw.on:
  [* * * @ *] -> write [* * * * *], move [S S S S S], goto bcons5.cc.at
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto bcons5.cc.dn
state bcons5.cc.at:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.cc.in.s.sk0
state bcons5.cc.dn:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons5.st.ss.sk0
state bcons5.cc.in.s.sk0:
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons5.cc.in.s.sk0
  [* 0 * * *] -> write [* 1 * * *], move [S S S S S], goto bcons5.cc.in.d
  [* # * * *] -> write [* * * * *], move [S S S S S], goto overflow
state bcons5.cc.in.d:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.cc.in.d
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.cc.in.d
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.cc.in.r.home
state bcons5.cc.in.r.home:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk0
state bcons5.cc.sk.sk0:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk1
state bcons5.cc.sk.sk1:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk2
state bcons5.cc.sk.sk2:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk3
state bcons5.cc.sk.sk3:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk4
state bcons5.cc.sk.sk4:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk5
state bcons5.cc.sk.sk5:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk6
state bcons5.cc.sk.sk6:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk7
state bcons5.cc.sk.sk7:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk8
state bcons5.cc.sk.sk8:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons5.cc.sk.sk9
state bcons5.cc.sk.sk9:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto bcons5.cc.rw.on
state bcons5.st.ss.sk0:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk0
state bcons5.st.ds.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk1
state bcons5.st.ds.sk1:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk1
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons5.st.ds.sk2
state bcons5.st.ds.sk2:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c0
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c0
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c0
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c0
state bcons5.st.c0:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c1
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c1
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c1
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c1
state bcons5.st.c1:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c2
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c2
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c2
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c2
state bcons5.st.c2:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c3
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons5.st.c3
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c3
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons5.st.c3
state bcons5.st.c3:
  [# # * * *] -> write [* * * * *], move [L L S S S], goto bcons5.st.bk
state bcons5.st.bk:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.st.bk
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons5.st.bk
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons5.st.r1.home
state bcons5.st.r1.home:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r1.home
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r1.home
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r2.rw1
state bcons5.st.r2.rw1:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r2.rw1
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r2.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r2.rw0
state bcons5.st.r2.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r2.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons5.st.r2.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bcons5.st.r2.home
state bcons5.st.r2.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc4
state bcons6.lh.ss.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lh.ss.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lh.ss.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lh.ss.sk1
state bcons6.lh.ss.sk1:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.lh.ds.sk0
state bcons6.lh.ds.sk0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c0
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c0
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c0
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c0
state bcons6.lh.c0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c1
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c1
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c1
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c1
state bcons6.lh.c1:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c2
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c2
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c2
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c2
state bcons6.lh.c2:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c3
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lh.c3
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c3
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lh.c3
state bcons6.lh.c3:
  [# # * * *] -> write [* * * * *], move [L L S S S], goto bcons6.lh.bk
state bcons6.lh.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lh.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lh.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lh.r1.rw0
state bcons6.lh.r1.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lh.r1.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lh.r1.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bcons6.lh.r1.home
state bcons6.lh.r1.home:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.lh.r1.home
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.lh.r1.home
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.lh.r2.home
state bcons6.lh.r2.home:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.oc.s.sk0
state bcons6.oc.s.sk0:
  [* * * _ *] -> write [* * * @ *], move [S S S R S], goto bcons6.oc.at
state bcons6.oc.at:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.oc.c0
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.oc.c0
state bcons6.oc.c0:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.oc.c1
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.oc.c1
state bcons6.oc.c1:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.oc.c2
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.oc.c2
state bcons6.oc.c2:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.oc.c3
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.oc.c3
state bcons6.oc.c3:
  [* # * _ *] -> write [* * * # *], move [S L S R S], goto bcons6.oc.t
state bcons6.oc.t:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.oc.t
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.oc.t
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.oc.r.home
state bcons6.oc.r.home:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk0
state bcons6.lt.ss.sk0:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk0
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk0
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk1
state bcons6.lt.ss.sk1:
  [0 * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk1
  [1 * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk1
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.lt.ss.sk2
state bcons6.lt.ss.sk2:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.lt.ds.sk0
state bcons6.lt.ds.sk0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c0
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c0
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c0
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c0
state bcons6.lt.c0:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c1
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c1
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c1
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c1
state bcons6.lt.c1:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c2
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c2
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c2
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c2
state bcons6.lt.c2:
  [0 0 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c3
  [0 1 * * *] -> write [* 0 * * *], move [R R S S S], goto bcons6.lt.c3
  [1 0 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c3
  [1 1 * * *] -> write [* 1 * * *], move [R R S S S], goto bcons6.lt.c3
state bcons6.lt.c3:
  [# # * * *] -> write [* * * * *], move [L L S S S], goto bcons6.lt.bk
state bcons6.lt.bk:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.bk
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.bk
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.r1.rw1
state bcons6.lt.r1.rw1:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.r1.rw1
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.r1.rw1
  [# * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.r1.rw0
state bcons6.lt.r1.rw0:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.r1.rw0
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.lt.r1.rw0
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bcons6.lt.r1.home
state bcons6.lt.r1.home:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.lt.r1.home
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.lt.r1.home
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.lt.r2.home
state bcons6.lt.r2.home:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.at.s.sk0
state bcons6.at.s.sk0:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.at.c0
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.at.c0
state bcons6.at.c0:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.at.c1
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.at.c1
state bcons6.at.c1:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.at.c2
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.at.c2
state bcons6.at.c2:
  [* 0 * _ *] -> write [* * * 0 *], move [S R S R S], goto bcons6.at.c3
  [* 1 * _ *] -> write [* * * 1 *], move [S R S R S], goto bcons6.at.c3
state bcons6.at.c3:
  [* # * * *] -> write [* * * * *], move [S L S S S], goto bcons6.at.bk
state bcons6.at.bk:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.at.bk
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.at.bk
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.at.r.home
state bcons6.at.r.home:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.z.s.sk0
state bcons6.z.s.sk0:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z0
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z0
state bcons6.z.z0:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z1
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z1
state bcons6.z.z1:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z2
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z2
state bcons6.z.z2:
  [* 0 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z3
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.z.z3
state bcons6.z.z3:
  [* # * * *] -> write [* * * * *], move [S L S S S], goto bcons6.z.bk
state bcons6.z.bk:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.z.bk
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.z.bk
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.z.r.home
state bcons6.z.r.home:
  [* * * _ *] -> write [* * * * *], move [S S S L S], goto bcons6.cc.rw.wl
state bcons6.cc.rw.wl:
  [* * * @ *] -> write [* * * * *], move [S S S L S], goto bcons6.cc.rw.wl
  [* * * # *] -> write [* * * * *], move [S S S L S], goto bcons6.cc.rw.wl
  [* * * 0 *] -> write [* * * * *], move [S S S L S], goto bcons6.cc.rw.wl
  [* * * 1 *] -> write [* * * * *], move [S S S L S], goto bcons6.cc.rw.wl
  [* * * _ *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.rw.on
state bcons6.cc.rw.on:
  [* * * @ *] -> write [* * * * *], move [S S S S S], goto bcons6.cc.at
  [* * * _ *] -> write [* * * * *], move [S S S S S], goto bcons6.cc.dn
state bcons6.cc.at:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.cc.in.s.sk0
state bcons6.cc.dn:
  [* # * * *] -> write [* * * * *], move [S R S S S], goto bcons6.st.ss.sk0
state bcons6.cc.in.s.sk0:
  [* 1 * * *] -> write [* 0 * * *], move [S R S S S], goto bcons6.cc.in.s.sk0
  [* 0 * * *] -> write [* 1 * * *], move [S S S S S], goto bcons6.cc.in.d
  [* # * * *] -> write [* * * * *], move [S S S S S], goto overflow
state bcons6.cc.in.d:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.cc.in.d
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.cc.in.d
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.cc.in.r.home
state bcons6.cc.in.r.home:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk0
state bcons6.cc.sk.sk0:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk1
state bcons6.cc.sk.sk1:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk2
state bcons6.cc.sk.sk2:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk3
state bcons6.cc.sk.sk3:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk4
state bcons6.cc.sk.sk4:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk5
state bcons6.cc.sk.sk5:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk6
state bcons6.cc.sk.sk6:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk7
state bcons6.cc.sk.sk7:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk8
state bcons6.cc.sk.sk8:
  [* * * * *] -> write [* * * * *], move [S S S R S], goto bcons6.cc.sk.sk9
state bcons6.cc.sk.sk9:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto bcons6.cc.rw.on
state bcons6.st.ss.sk0:
  [# * * * *] -> write [* * * * *], move [R S S S S], goto bcons6.st.ds.sk0
state bcons6.st.ds.sk0:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c0
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c0
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c0
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c0
state bcons6.st.c0:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c1
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c1
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c1
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c1
state bcons6.st.c1:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c2
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c2
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c2
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c2
state bcons6.st.c2:
  [0 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c3
  [1 0 * * *] -> write [0 * * * *], move [R R S S S], goto bcons6.st.c3
  [0 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c3
  [1 1 * * *] -> write [1 * * * *], move [R R S S S], goto bcons6.st.c3
state bcons6.st.c3:
  [# # * * *] -> write [* * * * *], move [L L S S S], goto bcons6.st.bk
state bcons6.st.bk:
  [* 0 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.st.bk
  [* 1 * * *] -> write [* * * * *], move [S L S S S], goto bcons6.st.bk
  [* # * * *] -> write [* * * * *], move [S S S S S], goto bcons6.st.r1.home
state bcons6.st.r1.home:
  [0 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.st.r1.home
  [1 * * * *] -> write [* * * * *], move [L S S S S], goto bcons6.st.r1.home
  [# * * * *] -> write [* * * * *], move [S S S S S], goto bcons6.st.r2.home
state bcons6.st.r2.home:
  [* * * * *] -> write [* * * * *], move [S S S S S], goto pc5
