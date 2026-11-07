;; first-order-41
;; source:
;;   fn head(x) { x + 1 } fn ap(g, x) { g(x) } head(1) + ap(head, 2)
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

define range(i64 2, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  br i1 %trip.not.i, label %cont.i, label %ap.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.2.exit.i"

i14.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.2.exit.i"

i18.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i.i, i64 2)
  %2 = select i1 %trip7.not.i.i, i64 %1, i64 2
  br label %"$apply1.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i14.i.i, label %i18.i.i

cont3.i.i:                                        ; preds = %i14.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit.i"

"$apply1.2.exit.i":                               ; preds = %cont3.i.i, %i18.i.i, %i14.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 2, %cont.i ], [ %2, %i18.i.i ], [ 2, %i14.i.i ], [ 5, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.6.exit

ap.6.exit:                                        ; preds = %cont6, %"$apply1.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.2.exit.i" ], [ 2, %cont6 ]
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

define range(i64 2, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  br i1 %trip.not.i, label %cont.i, label %ap.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.2.exit.i"

i14.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.2.exit.i"

i18.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i.i, i64 2)
  %2 = select i1 %trip7.not.i.i, i64 %1, i64 2
  br label %"$apply1.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i14.i.i, label %i18.i.i

cont3.i.i:                                        ; preds = %i14.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit.i"

"$apply1.2.exit.i":                               ; preds = %cont3.i.i, %i18.i.i, %i14.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 2, %cont.i ], [ %2, %i18.i.i ], [ 2, %i14.i.i ], [ 5, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.6.exit

ap.6.exit:                                        ; preds = %cont6, %"$apply1.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.2.exit.i" ], [ 2, %cont6 ]
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

define range(i64 2, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  br i1 %trip.not.i, label %cont.i, label %ap.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.2.exit.i"

i14.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.2.exit.i"

i18.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i.i, i64 2)
  %2 = select i1 %trip7.not.i.i, i64 %1, i64 2
  br label %"$apply1.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i14.i.i, label %i18.i.i

cont3.i.i:                                        ; preds = %i14.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit.i"

"$apply1.2.exit.i":                               ; preds = %cont3.i.i, %i18.i.i, %i14.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 2, %cont.i ], [ %2, %i18.i.i ], [ 2, %i14.i.i ], [ 5, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.6.exit

ap.6.exit:                                        ; preds = %cont6, %"$apply1.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.2.exit.i" ], [ 2, %cont6 ]
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
define range(i64 2, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  br i1 %trip.not.i, label %cont.i, label %ap.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.2.exit.i"

i14.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.2.exit.i"

i18.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i.i, i64 2)
  %2 = select i1 %trip7.not.i.i, i64 %1, i64 2
  br label %"$apply1.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i14.i.i, label %i18.i.i

cont3.i.i:                                        ; preds = %i14.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit.i"

"$apply1.2.exit.i":                               ; preds = %cont3.i.i, %i18.i.i, %i14.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 2, %cont.i ], [ %2, %i18.i.i ], [ 2, %i14.i.i ], [ 5, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.6.exit

ap.6.exit:                                        ; preds = %cont6, %"$apply1.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.2.exit.i" ], [ 2, %cont6 ]
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
define range(i64 2, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %ap.6.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %ap.6.exit ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  br i1 %trip.not.i, label %cont.i, label %ap.6.exit

cont.i:                                           ; preds = %cont6
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.2.exit.i"

i14.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.2.exit.i"

i18.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %1 = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i.i, i64 2)
  %2 = select i1 %trip7.not.i.i, i64 %1, i64 2
  br label %"$apply1.2.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i14.i.i, label %i18.i.i

cont3.i.i:                                        ; preds = %i14.i.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit.i"

"$apply1.2.exit.i":                               ; preds = %cont3.i.i, %i18.i.i, %i14.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 2, %cont.i ], [ %2, %i18.i.i ], [ 2, %i14.i.i ], [ 5, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.6.exit

ap.6.exit:                                        ; preds = %cont6, %"$apply1.2.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.2.exit.i" ], [ 2, %cont6 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
