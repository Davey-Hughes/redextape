;; first-order-45
;; source:
;;   fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define range(i64 3, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap2.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap2.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap2.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply2.2.exit.i"

i16.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply2.2.exit.i"

i22.i.i:                                          ; preds = %cont.i.i
  %head6.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard7.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i.i = icmp eq i64 %guard7.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head6.i.i, i64 3)
  %2 = select i1 %trip8.not.i.i, i64 %1, i64 3
  br label %"$apply2.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i16.i.i, label %i22.i.i

cont3.i.i:                                        ; preds = %i16.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply2.2.exit.i"

"$apply2.2.exit.i":                               ; preds = %cont3.i.i, %i22.i.i, %i16.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 3, %cont.i ], [ %2, %i22.i.i ], [ 3, %i16.i.i ], [ 10, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap2.6.exit

ap2.6.exit:                                       ; preds = %cont6, %"$apply2.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply2.2.exit.i" ], [ 3, %cont6 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define range(i64 3, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap2.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap2.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap2.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply2.2.exit.i"

i16.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply2.2.exit.i"

i22.i.i:                                          ; preds = %cont.i.i
  %head6.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard7.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i.i = icmp eq i64 %guard7.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head6.i.i, i64 3)
  %2 = select i1 %trip8.not.i.i, i64 %1, i64 3
  br label %"$apply2.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i16.i.i, label %i22.i.i

cont3.i.i:                                        ; preds = %i16.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply2.2.exit.i"

"$apply2.2.exit.i":                               ; preds = %cont3.i.i, %i22.i.i, %i16.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 3, %cont.i ], [ %2, %i22.i.i ], [ 3, %i16.i.i ], [ 10, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap2.6.exit

ap2.6.exit:                                       ; preds = %cont6, %"$apply2.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply2.2.exit.i" ], [ 3, %cont6 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define range(i64 3, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap2.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap2.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap2.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply2.2.exit.i"

i16.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply2.2.exit.i"

i22.i.i:                                          ; preds = %cont.i.i
  %head6.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard7.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i.i = icmp eq i64 %guard7.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head6.i.i, i64 3)
  %2 = select i1 %trip8.not.i.i, i64 %1, i64 3
  br label %"$apply2.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i16.i.i, label %i22.i.i

cont3.i.i:                                        ; preds = %i16.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply2.2.exit.i"

"$apply2.2.exit.i":                               ; preds = %cont3.i.i, %i22.i.i, %i16.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 3, %cont.i ], [ %2, %i22.i.i ], [ 3, %i16.i.i ], [ 10, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap2.6.exit

ap2.6.exit:                                       ; preds = %cont6, %"$apply2.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply2.2.exit.i" ], [ 3, %cont6 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define range(i64 3, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap2.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap2.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap2.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply2.2.exit.i"

i16.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply2.2.exit.i"

i22.i.i:                                          ; preds = %cont.i.i
  %head6.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard7.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i.i = icmp eq i64 %guard7.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head6.i.i, i64 3)
  %2 = select i1 %trip8.not.i.i, i64 %1, i64 3
  br label %"$apply2.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i16.i.i, label %i22.i.i

cont3.i.i:                                        ; preds = %i16.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply2.2.exit.i"

"$apply2.2.exit.i":                               ; preds = %cont3.i.i, %i22.i.i, %i16.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 3, %cont.i ], [ %2, %i22.i.i ], [ 3, %i16.i.i ], [ 10, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap2.6.exit

ap2.6.exit:                                       ; preds = %cont6, %"$apply2.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply2.2.exit.i" ], [ 3, %cont6 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { optsize }
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define range(i64 3, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap2.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap2.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap2.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply2.2.exit.i"

i16.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply2.2.exit.i"

i22.i.i:                                          ; preds = %cont.i.i
  %head6.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard7.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i.i = icmp eq i64 %guard7.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head6.i.i, i64 3)
  %2 = select i1 %trip8.not.i.i, i64 %1, i64 3
  br label %"$apply2.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i16.i.i, label %i22.i.i

cont3.i.i:                                        ; preds = %i16.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply2.2.exit.i"

"$apply2.2.exit.i":                               ; preds = %cont3.i.i, %i22.i.i, %i16.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 3, %cont.i ], [ %2, %i22.i.i ], [ 3, %i16.i.i ], [ 10, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap2.6.exit

ap2.6.exit:                                       ; preds = %cont6, %"$apply2.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply2.2.exit.i" ], [ 3, %cont6 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
