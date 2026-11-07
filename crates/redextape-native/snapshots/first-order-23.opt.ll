;; first-order-23
;; source:
;;   fn apply2(f, x) { f(x) } fn add1(x) { x + 1 } apply2(add1, 5)
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %apply2.4.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %apply2.4.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %apply2.4.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.0.exit.i"

i13.i.i:                                          ; preds = %cont.i.i
  %head1.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i = icmp eq i64 %guard2.i.i, 0
  %spec.select.i.i = select i1 %trip3.not.i.i, i64 %head1.i.i, i64 0
  br label %"$apply1.0.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %"$apply1.0.exit.i", label %i13.i.i

"$apply1.0.exit.i":                               ; preds = %cont.i.i, %i13.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i13.i.i ], [ 6, %cont.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %apply2.4.exit

apply2.4.exit:                                    ; preds = %cont3, %"$apply1.0.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.0.exit.i" ], [ 0, %cont3 ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %apply2.4.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %apply2.4.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %apply2.4.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.0.exit.i"

i13.i.i:                                          ; preds = %cont.i.i
  %head1.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i = icmp eq i64 %guard2.i.i, 0
  %spec.select.i.i = select i1 %trip3.not.i.i, i64 %head1.i.i, i64 0
  br label %"$apply1.0.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %"$apply1.0.exit.i", label %i13.i.i

"$apply1.0.exit.i":                               ; preds = %cont.i.i, %i13.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i13.i.i ], [ 6, %cont.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %apply2.4.exit

apply2.4.exit:                                    ; preds = %cont3, %"$apply1.0.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.0.exit.i" ], [ 0, %cont3 ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %apply2.4.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %apply2.4.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %apply2.4.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.0.exit.i"

i13.i.i:                                          ; preds = %cont.i.i
  %head1.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i = icmp eq i64 %guard2.i.i, 0
  %spec.select.i.i = select i1 %trip3.not.i.i, i64 %head1.i.i, i64 0
  br label %"$apply1.0.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %"$apply1.0.exit.i", label %i13.i.i

"$apply1.0.exit.i":                               ; preds = %cont.i.i, %i13.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i13.i.i ], [ 6, %cont.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %apply2.4.exit

apply2.4.exit:                                    ; preds = %cont3, %"$apply1.0.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.0.exit.i" ], [ 0, %cont3 ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %apply2.4.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %apply2.4.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %apply2.4.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.0.exit.i"

i13.i.i:                                          ; preds = %cont.i.i
  %head1.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i = icmp eq i64 %guard2.i.i, 0
  %spec.select.i.i = select i1 %trip3.not.i.i, i64 %head1.i.i, i64 0
  br label %"$apply1.0.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %"$apply1.0.exit.i", label %i13.i.i

"$apply1.0.exit.i":                               ; preds = %cont.i.i, %i13.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i13.i.i ], [ 6, %cont.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %apply2.4.exit

apply2.4.exit:                                    ; preds = %cont3, %"$apply1.0.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.0.exit.i" ], [ 0, %cont3 ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %apply2.4.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %apply2.4.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %apply2.4.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.0.exit.i"

i13.i.i:                                          ; preds = %cont.i.i
  %head1.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i = icmp eq i64 %guard2.i.i, 0
  %spec.select.i.i = select i1 %trip3.not.i.i, i64 %head1.i.i, i64 0
  br label %"$apply1.0.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %"$apply1.0.exit.i", label %i13.i.i

"$apply1.0.exit.i":                               ; preds = %cont.i.i, %i13.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i13.i.i ], [ 6, %cont.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %apply2.4.exit

apply2.4.exit:                                    ; preds = %cont3, %"$apply1.0.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.0.exit.i" ], [ 0, %cont3 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }
