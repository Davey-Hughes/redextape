;; first-order-34
;; source:
;;   fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %f.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %f.6.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %f.6.exit

cont.i:                                           ; preds = %cont
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %f.6.exit

cont3.i:                                          ; preds = %cont.i
  %guard.i.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %ap.4.exit.i

cont.i.i:                                         ; preds = %cont3.i
  %head.i.i.i = tail call i64 @rt_head(ptr %0, i64 %cons.i)
  %guard.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %cont.i.i.i, label %"$apply1.0.exit.i.i"

i13.i.i.i:                                        ; preds = %cont.i.i.i
  %head1.i.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i.i = icmp eq i64 %guard2.i.i.i, 0
  %spec.select.i.i.i = select i1 %trip3.not.i.i.i, i64 %head1.i.i.i, i64 0
  br label %"$apply1.0.exit.i.i"

cont.i.i.i:                                       ; preds = %cont.i.i
  %cmp.not.i.i.i = icmp eq i64 %head.i.i.i, 0
  br i1 %cmp.not.i.i.i, label %"$apply1.0.exit.i.i", label %i13.i.i.i

"$apply1.0.exit.i.i":                             ; preds = %cont.i.i.i, %i13.i.i.i, %cont.i.i
  %common.ret.op.i.i.i = phi i64 [ 0, %cont.i.i ], [ %spec.select.i.i.i, %i13.i.i.i ], [ 4, %cont.i.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.4.exit.i

ap.4.exit.i:                                      ; preds = %"$apply1.0.exit.i.i", %cont3.i
  %common.ret.op.i.i = phi i64 [ %common.ret.op.i.i.i, %"$apply1.0.exit.i.i" ], [ 0, %cont3.i ]
  tail call void @rt_leave(ptr %0)
  br label %f.6.exit

f.6.exit:                                         ; preds = %cont, %cont.i, %ap.4.exit.i
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %ap.4.exit.i ], [ 0, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %f.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %f.6.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %f.6.exit

cont.i:                                           ; preds = %cont
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %f.6.exit

cont3.i:                                          ; preds = %cont.i
  %guard.i.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %ap.4.exit.i

cont.i.i:                                         ; preds = %cont3.i
  %head.i.i.i = tail call i64 @rt_head(ptr %0, i64 %cons.i)
  %guard.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %cont.i.i.i, label %"$apply1.0.exit.i.i"

i13.i.i.i:                                        ; preds = %cont.i.i.i
  %head1.i.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i.i = icmp eq i64 %guard2.i.i.i, 0
  %spec.select.i.i.i = select i1 %trip3.not.i.i.i, i64 %head1.i.i.i, i64 0
  br label %"$apply1.0.exit.i.i"

cont.i.i.i:                                       ; preds = %cont.i.i
  %cmp.not.i.i.i = icmp eq i64 %head.i.i.i, 0
  br i1 %cmp.not.i.i.i, label %"$apply1.0.exit.i.i", label %i13.i.i.i

"$apply1.0.exit.i.i":                             ; preds = %cont.i.i.i, %i13.i.i.i, %cont.i.i
  %common.ret.op.i.i.i = phi i64 [ 0, %cont.i.i ], [ %spec.select.i.i.i, %i13.i.i.i ], [ 4, %cont.i.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.4.exit.i

ap.4.exit.i:                                      ; preds = %"$apply1.0.exit.i.i", %cont3.i
  %common.ret.op.i.i = phi i64 [ %common.ret.op.i.i.i, %"$apply1.0.exit.i.i" ], [ 0, %cont3.i ]
  tail call void @rt_leave(ptr %0)
  br label %f.6.exit

f.6.exit:                                         ; preds = %cont, %cont.i, %ap.4.exit.i
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %ap.4.exit.i ], [ 0, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %f.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %f.6.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %f.6.exit

cont.i:                                           ; preds = %cont
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %f.6.exit

cont3.i:                                          ; preds = %cont.i
  %guard.i.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %ap.4.exit.i

cont.i.i:                                         ; preds = %cont3.i
  %head.i.i.i = tail call i64 @rt_head(ptr %0, i64 %cons.i)
  %guard.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %cont.i.i.i, label %"$apply1.0.exit.i.i"

i13.i.i.i:                                        ; preds = %cont.i.i.i
  %head1.i.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i.i = icmp eq i64 %guard2.i.i.i, 0
  %spec.select.i.i.i = select i1 %trip3.not.i.i.i, i64 %head1.i.i.i, i64 0
  br label %"$apply1.0.exit.i.i"

cont.i.i.i:                                       ; preds = %cont.i.i
  %cmp.not.i.i.i = icmp eq i64 %head.i.i.i, 0
  br i1 %cmp.not.i.i.i, label %"$apply1.0.exit.i.i", label %i13.i.i.i

"$apply1.0.exit.i.i":                             ; preds = %cont.i.i.i, %i13.i.i.i, %cont.i.i
  %common.ret.op.i.i.i = phi i64 [ 0, %cont.i.i ], [ %spec.select.i.i.i, %i13.i.i.i ], [ 4, %cont.i.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.4.exit.i

ap.4.exit.i:                                      ; preds = %"$apply1.0.exit.i.i", %cont3.i
  %common.ret.op.i.i = phi i64 [ %common.ret.op.i.i.i, %"$apply1.0.exit.i.i" ], [ 0, %cont3.i ]
  tail call void @rt_leave(ptr %0)
  br label %f.6.exit

f.6.exit:                                         ; preds = %cont, %cont.i, %ap.4.exit.i
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %ap.4.exit.i ], [ 0, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %f.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %f.6.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %f.6.exit

cont.i:                                           ; preds = %cont
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %f.6.exit

cont3.i:                                          ; preds = %cont.i
  %guard.i.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %ap.4.exit.i

cont.i.i:                                         ; preds = %cont3.i
  %head.i.i.i = tail call i64 @rt_head(ptr %0, i64 %cons.i)
  %guard.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %cont.i.i.i, label %"$apply1.0.exit.i.i"

i13.i.i.i:                                        ; preds = %cont.i.i.i
  %head1.i.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i.i = icmp eq i64 %guard2.i.i.i, 0
  %spec.select.i.i.i = select i1 %trip3.not.i.i.i, i64 %head1.i.i.i, i64 0
  br label %"$apply1.0.exit.i.i"

cont.i.i.i:                                       ; preds = %cont.i.i
  %cmp.not.i.i.i = icmp eq i64 %head.i.i.i, 0
  br i1 %cmp.not.i.i.i, label %"$apply1.0.exit.i.i", label %i13.i.i.i

"$apply1.0.exit.i.i":                             ; preds = %cont.i.i.i, %i13.i.i.i, %cont.i.i
  %common.ret.op.i.i.i = phi i64 [ 0, %cont.i.i ], [ %spec.select.i.i.i, %i13.i.i.i ], [ 4, %cont.i.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.4.exit.i

ap.4.exit.i:                                      ; preds = %"$apply1.0.exit.i.i", %cont3.i
  %common.ret.op.i.i = phi i64 [ %common.ret.op.i.i.i, %"$apply1.0.exit.i.i" ], [ 0, %cont3.i ]
  tail call void @rt_leave(ptr %0)
  br label %f.6.exit

f.6.exit:                                         ; preds = %cont, %cont.i, %ap.4.exit.i
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %ap.4.exit.i ], [ 0, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %f.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %f.6.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %f.6.exit

cont.i:                                           ; preds = %cont
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %f.6.exit

cont3.i:                                          ; preds = %cont.i
  %guard.i.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %ap.4.exit.i

cont.i.i:                                         ; preds = %cont3.i
  %head.i.i.i = tail call i64 @rt_head(ptr %0, i64 %cons.i)
  %guard.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %cont.i.i.i, label %"$apply1.0.exit.i.i"

i13.i.i.i:                                        ; preds = %cont.i.i.i
  %head1.i.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i.i = icmp eq i64 %guard2.i.i.i, 0
  %spec.select.i.i.i = select i1 %trip3.not.i.i.i, i64 %head1.i.i.i, i64 0
  br label %"$apply1.0.exit.i.i"

cont.i.i.i:                                       ; preds = %cont.i.i
  %cmp.not.i.i.i = icmp eq i64 %head.i.i.i, 0
  br i1 %cmp.not.i.i.i, label %"$apply1.0.exit.i.i", label %i13.i.i.i

"$apply1.0.exit.i.i":                             ; preds = %cont.i.i.i, %i13.i.i.i, %cont.i.i
  %common.ret.op.i.i.i = phi i64 [ 0, %cont.i.i ], [ %spec.select.i.i.i, %i13.i.i.i ], [ 4, %cont.i.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.4.exit.i

ap.4.exit.i:                                      ; preds = %"$apply1.0.exit.i.i", %cont3.i
  %common.ret.op.i.i = phi i64 [ %common.ret.op.i.i.i, %"$apply1.0.exit.i.i" ], [ 0, %cont3.i ]
  tail call void @rt_leave(ptr %0)
  br label %f.6.exit

f.6.exit:                                         ; preds = %cont, %cont.i, %ap.4.exit.i
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %ap.4.exit.i ], [ 0, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }
