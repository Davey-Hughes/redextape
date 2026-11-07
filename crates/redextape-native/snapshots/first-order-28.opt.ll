;; first-order-28
;; source:
;;   fn is_even(n){ if n == 0 { true } else { is_odd(n - 1) } } fn is_odd(n){ if n == 0 { false } else { is_even(n - 1) } } is_even(4)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

define range(i64 0, 2) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @is_even.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc range(i64 0, 2) i64 @is_even.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %is_odd.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %is_odd.1.exit ], [ 1, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %is_odd.1.exit, label %i21.i

i21.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %is_odd.1.exit

cont.i:                                           ; preds = %i21.i
  %ssub.i = tail call i64 @llvm.usub.sat.i64(i64 %1, i64 2)
  %call.i = tail call fastcc i64 @is_even.0(ptr %0, i64 %ssub.i), !inline_history !0
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %is_odd.1.exit

is_odd.1.exit:                                    ; preds = %cont, %i21.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i21.i ], [ %call.i, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }

!0 = distinct !{null}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 2) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @is_even.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc range(i64 0, 2) i64 @is_even.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %is_odd.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %is_odd.1.exit ], [ 1, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %is_odd.1.exit, label %i21.i

i21.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %is_odd.1.exit

cont.i:                                           ; preds = %i21.i
  %ssub.i6 = add nsw i64 %1, -2
  %call.i = tail call fastcc i64 @is_even.0(ptr %0, i64 %ssub.i6), !inline_history !0
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %is_odd.1.exit

is_odd.1.exit:                                    ; preds = %cont, %i21.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i21.i ], [ %call.i, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

!0 = distinct !{null}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 2) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @is_even.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc range(i64 0, 2) i64 @is_even.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %is_odd.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %is_odd.1.exit ], [ 1, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %is_odd.1.exit, label %i21.i

i21.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %is_odd.1.exit

cont.i:                                           ; preds = %i21.i
  %ssub.i6 = add nsw i64 %1, -2
  %call.i = tail call fastcc i64 @is_even.0(ptr %0, i64 %ssub.i6), !inline_history !0
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %is_odd.1.exit

is_odd.1.exit:                                    ; preds = %cont, %i21.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i21.i ], [ %call.i, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

!0 = distinct !{null}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: optsize
define range(i64 0, 2) i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @is_even.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc range(i64 0, 2) i64 @is_even.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr #0 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %is_odd.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %is_odd.1.exit ], [ 1, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %is_odd.1.exit, label %i21.i

i21.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %is_odd.1.exit

cont.i:                                           ; preds = %i21.i
  %ssub.i6 = add nsw i64 %1, -2
  %call.i = tail call fastcc i64 @is_even.0(ptr %0, i64 %ssub.i6), !inline_history !0
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %is_odd.1.exit

is_odd.1.exit:                                    ; preds = %cont, %i21.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i21.i ], [ %call.i, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { optsize }

!0 = distinct !{null}
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define range(i64 0, 2) i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @is_even.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc range(i64 0, 2) i64 @is_even.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr #0 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %is_odd.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %is_odd.1.exit ], [ 1, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %is_odd.1.exit, label %i21.i

i21.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %is_odd.1.exit

cont.i:                                           ; preds = %i21.i
  %ssub.i6 = add nsw i64 %1, -2
  %call.i = tail call fastcc i64 @is_even.0(ptr %0, i64 %ssub.i6), !inline_history !0
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %is_odd.1.exit

is_odd.1.exit:                                    ; preds = %cont, %i21.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i21.i ], [ %call.i, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }

!0 = distinct !{null}
