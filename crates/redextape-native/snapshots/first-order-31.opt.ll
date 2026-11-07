;; first-order-31
;; source:
;;   fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 9) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %s0.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %s0.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %s0.0.exit

cont.i:                                           ; preds = %cont
  %guard.i.i = tail call i64 @rt_enter(ptr %0), !inline_history !1
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %s1.1.exit.i

cont.i.i:                                         ; preds = %cont.i
  %guard.i8.i = tail call i64 @rt_enter(ptr %0), !inline_history !2
  %trip.not.i9.i = icmp eq i64 %guard.i8.i, 0
  br i1 %trip.not.i9.i, label %cont.i11.i, label %s2.2.exit.i

cont.i11.i:                                       ; preds = %cont.i.i
  %guard.i.i.i = tail call i64 @rt_enter(ptr %0), !inline_history !3
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %s1.1.exit.i.i.i, label %s0.0.exit.i.i

s1.1.exit.i.i.i:                                  ; preds = %cont.i11.i
  tail call void @rt_leave(ptr %0), !inline_history !3
  br label %s0.0.exit.i.i

s0.0.exit.i.i:                                    ; preds = %s1.1.exit.i.i.i, %cont.i11.i
  %common.ret.op.i.i.i = phi i64 [ 7, %cont.i11.i ], [ 8, %s1.1.exit.i.i.i ]
  tail call void @rt_leave(ptr %0), !inline_history !2
  br label %s2.2.exit.i

s2.2.exit.i:                                      ; preds = %s0.0.exit.i.i, %cont.i.i
  %common.ret.op.i10.i = phi i64 [ 3, %cont.i.i ], [ %common.ret.op.i.i.i, %s0.0.exit.i.i ]
  tail call void @rt_leave(ptr %0), !inline_history !1
  br label %s1.1.exit.i

s1.1.exit.i:                                      ; preds = %s2.2.exit.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 1, %cont.i ], [ %common.ret.op.i10.i, %s2.2.exit.i ]
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %s0.0.exit

s0.0.exit:                                        ; preds = %cont, %s1.1.exit.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %common.ret.op.i.i, %s1.1.exit.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

!0 = distinct !{null}
!1 = distinct !{null, null}
!2 = distinct !{null, null, null}
!3 = distinct !{null, null, null, null}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 9) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %s0.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %s0.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %s0.0.exit

cont.i:                                           ; preds = %cont
  %guard.i.i = tail call i64 @rt_enter(ptr %0), !inline_history !1
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %s1.1.exit.i

cont.i.i:                                         ; preds = %cont.i
  %guard.i8.i = tail call i64 @rt_enter(ptr %0), !inline_history !2
  %trip.not.i9.i = icmp eq i64 %guard.i8.i, 0
  br i1 %trip.not.i9.i, label %cont.i11.i, label %s2.2.exit.i

cont.i11.i:                                       ; preds = %cont.i.i
  %guard.i.i.i = tail call i64 @rt_enter(ptr %0), !inline_history !3
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %s1.1.exit.i.i.i, label %s0.0.exit.i.i

s1.1.exit.i.i.i:                                  ; preds = %cont.i11.i
  tail call void @rt_leave(ptr %0), !inline_history !3
  br label %s0.0.exit.i.i

s0.0.exit.i.i:                                    ; preds = %s1.1.exit.i.i.i, %cont.i11.i
  %common.ret.op.i.i.i = phi i64 [ 7, %cont.i11.i ], [ 8, %s1.1.exit.i.i.i ]
  tail call void @rt_leave(ptr %0), !inline_history !2
  br label %s2.2.exit.i

s2.2.exit.i:                                      ; preds = %s0.0.exit.i.i, %cont.i.i
  %common.ret.op.i10.i = phi i64 [ 3, %cont.i.i ], [ %common.ret.op.i.i.i, %s0.0.exit.i.i ]
  tail call void @rt_leave(ptr %0), !inline_history !1
  br label %s1.1.exit.i

s1.1.exit.i:                                      ; preds = %s2.2.exit.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 1, %cont.i ], [ %common.ret.op.i10.i, %s2.2.exit.i ]
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %s0.0.exit

s0.0.exit:                                        ; preds = %cont, %s1.1.exit.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %common.ret.op.i.i, %s1.1.exit.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

!0 = distinct !{null}
!1 = distinct !{null, null}
!2 = distinct !{null, null, null}
!3 = distinct !{null, null, null, null}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 9) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %s0.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %s0.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %s0.0.exit

cont.i:                                           ; preds = %cont
  %guard.i.i = tail call i64 @rt_enter(ptr %0), !inline_history !1
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %s1.1.exit.i

cont.i.i:                                         ; preds = %cont.i
  %guard.i8.i = tail call i64 @rt_enter(ptr %0), !inline_history !2
  %trip.not.i9.i = icmp eq i64 %guard.i8.i, 0
  br i1 %trip.not.i9.i, label %cont.i11.i, label %s2.2.exit.i

cont.i11.i:                                       ; preds = %cont.i.i
  %guard.i.i.i = tail call i64 @rt_enter(ptr %0), !inline_history !3
  %trip.not.i.i.i = icmp eq i64 %guard.i.i.i, 0
  br i1 %trip.not.i.i.i, label %s1.1.exit.i.i.i, label %s0.0.exit.i.i

s1.1.exit.i.i.i:                                  ; preds = %cont.i11.i
  tail call void @rt_leave(ptr %0), !inline_history !3
  br label %s0.0.exit.i.i

s0.0.exit.i.i:                                    ; preds = %s1.1.exit.i.i.i, %cont.i11.i
  %common.ret.op.i.i.i = phi i64 [ 7, %cont.i11.i ], [ 8, %s1.1.exit.i.i.i ]
  tail call void @rt_leave(ptr %0), !inline_history !2
  br label %s2.2.exit.i

s2.2.exit.i:                                      ; preds = %s0.0.exit.i.i, %cont.i.i
  %common.ret.op.i10.i = phi i64 [ 3, %cont.i.i ], [ %common.ret.op.i.i.i, %s0.0.exit.i.i ]
  tail call void @rt_leave(ptr %0), !inline_history !1
  br label %s1.1.exit.i

s1.1.exit.i:                                      ; preds = %s2.2.exit.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 1, %cont.i ], [ %common.ret.op.i10.i, %s2.2.exit.i ]
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %s0.0.exit

s0.0.exit:                                        ; preds = %cont, %s1.1.exit.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %common.ret.op.i.i, %s1.1.exit.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

!0 = distinct !{null}
!1 = distinct !{null, null}
!2 = distinct !{null, null, null}
!3 = distinct !{null, null, null, null}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @s0.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @s0.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %s1.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %s1.1.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %s1.1.exit, label %i24.i

i24.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %s1.1.exit

cont.i:                                           ; preds = %i24.i
  %cmp.not.i7 = icmp eq i64 %1, 2
  br i1 %cmp.not.i7, label %s2.2.exit, label %i40.i

i40.i:                                            ; preds = %cont.i
  %guard.i8 = tail call i64 @rt_enter(ptr %0), !inline_history !1
  %trip.not.i9 = icmp eq i64 %guard.i8, 0
  br i1 %trip.not.i9, label %cont.i11, label %s2.2.exit

cont.i11:                                         ; preds = %i40.i
  %ssub.i1217 = add nsw i64 %1, -3
  %call.i13 = tail call fastcc i64 @s0.0(ptr %0, i64 %ssub.i1217), !inline_history !1
  tail call void @rt_leave(ptr %0), !inline_history !1
  %2 = tail call i64 @llvm.uadd.sat.i64(i64 %call.i13, i64 7)
  br label %s2.2.exit

s2.2.exit:                                        ; preds = %cont.i, %i40.i, %cont.i11
  %common.ret.op.i10 = phi i64 [ 3, %i40.i ], [ %2, %cont.i11 ], [ 3, %cont.i ]
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %s1.1.exit

s1.1.exit:                                        ; preds = %cont, %i24.i, %s2.2.exit
  %common.ret.op.i = phi i64 [ 1, %i24.i ], [ %common.ret.op.i10, %s2.2.exit ], [ 1, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { optsize }

!0 = distinct !{null}
!1 = distinct !{null, null}
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @s0.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @s0.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %s1.1.exit, %prologue, %i8
  %common.ret.op = phi i64 [ 0, %i8 ], [ %common.ret.op.i, %s1.1.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %cmp.not.i = icmp eq i64 %1, 1
  br i1 %cmp.not.i, label %s1.1.exit, label %i24.i

i24.i:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0), !inline_history !0
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %s1.1.exit

cont.i:                                           ; preds = %i24.i
  %cmp.not.i7 = icmp eq i64 %1, 2
  br i1 %cmp.not.i7, label %s2.2.exit, label %i40.i

i40.i:                                            ; preds = %cont.i
  %guard.i8 = tail call i64 @rt_enter(ptr %0), !inline_history !1
  %trip.not.i9 = icmp eq i64 %guard.i8, 0
  br i1 %trip.not.i9, label %cont.i11, label %s2.2.exit

cont.i11:                                         ; preds = %i40.i
  %ssub.i1217 = add nsw i64 %1, -3
  %call.i13 = tail call fastcc i64 @s0.0(ptr %0, i64 %ssub.i1217), !inline_history !1
  tail call void @rt_leave(ptr %0), !inline_history !1
  %2 = tail call i64 @llvm.uadd.sat.i64(i64 %call.i13, i64 7)
  br label %s2.2.exit

s2.2.exit:                                        ; preds = %cont.i, %i40.i, %cont.i11
  %common.ret.op.i10 = phi i64 [ 3, %i40.i ], [ %2, %cont.i11 ], [ 3, %cont.i ]
  tail call void @rt_leave(ptr %0), !inline_history !0
  br label %s1.1.exit

s1.1.exit:                                        ; preds = %cont, %i24.i, %s2.2.exit
  %common.ret.op.i = phi i64 [ 1, %i24.i ], [ %common.ret.op.i10, %s2.2.exit ], [ 1, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }

!0 = distinct !{null}
!1 = distinct !{null, null}
