;; first-order-36
;; source:
;;   fn sum(n) { if n == 0 { 0 } else { n + sum(n - 1) } } fn ap(g, x) { g(x) } ap(sum, 4) + sum(2)
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %ap.8.exit, %cont6
  %common.ret.op = phi i64 [ %sadd, %cont6 ], [ 0, %ap.8.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap.8.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.4.exit.i"

i25.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.4.exit.i"

i29.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %spec.select.i.i = select i1 %trip7.not.i.i, i64 %head5.i.i, i64 0
  br label %"$apply1.4.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i25.i.i, label %i29.i.i

cont3.i.i:                                        ; preds = %i25.i.i
  %call.i.i = tail call fastcc i64 @sum.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.4.exit.i"

"$apply1.4.exit.i":                               ; preds = %cont3.i.i, %i29.i.i, %i25.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i29.i.i ], [ 0, %i25.i.i ], [ %call.i.i, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.8.exit

ap.8.exit:                                        ; preds = %cont3, %"$apply1.4.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.4.exit.i" ], [ 0, %cont3 ]
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %ap.8.exit
  %call8 = tail call fastcc i64 @sum.0(ptr %0, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %common.ret.op.i, i64 %call8)
  br label %common.ret
}

define private fastcc i64 @sum.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret9, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret9

common.ret9:                                      ; preds = %i8, %prologue, %cont
  %common.ret9.op = phi i64 [ %sadd, %cont ], [ 0, %prologue ], [ 0, %i8 ]
  ret i64 %common.ret9.op

cont:                                             ; preds = %i8
  %ssub = tail call i64 @llvm.usub.sat.i64(i64 %1, i64 1)
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 %ssub)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %1, i64 %call)
  br label %common.ret9
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

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %ap.8.exit, %cont6
  %common.ret.op = phi i64 [ %sadd, %cont6 ], [ 0, %ap.8.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap.8.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.4.exit.i"

i25.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.4.exit.i"

i29.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %spec.select.i.i = select i1 %trip7.not.i.i, i64 %head5.i.i, i64 0
  br label %"$apply1.4.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i25.i.i, label %i29.i.i

cont3.i.i:                                        ; preds = %i25.i.i
  %call.i.i = tail call fastcc i64 @sum.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.4.exit.i"

"$apply1.4.exit.i":                               ; preds = %cont3.i.i, %i29.i.i, %i25.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i29.i.i ], [ 0, %i25.i.i ], [ %call.i.i, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.8.exit

ap.8.exit:                                        ; preds = %cont3, %"$apply1.4.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.4.exit.i" ], [ 0, %cont3 ]
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %ap.8.exit
  %call8 = tail call fastcc i64 @sum.0(ptr %0, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %common.ret.op.i, i64 %call8)
  br label %common.ret
}

define private fastcc i64 @sum.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %sadd, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub9 = add nsw i64 %1, -1
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 %ssub9)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %1, i64 %call)
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

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %ap.8.exit, %cont6
  %common.ret.op = phi i64 [ %sadd, %cont6 ], [ 0, %ap.8.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap.8.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.4.exit.i"

i25.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.4.exit.i"

i29.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %spec.select.i.i = select i1 %trip7.not.i.i, i64 %head5.i.i, i64 0
  br label %"$apply1.4.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i25.i.i, label %i29.i.i

cont3.i.i:                                        ; preds = %i25.i.i
  %call.i.i = tail call fastcc i64 @sum.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.4.exit.i"

"$apply1.4.exit.i":                               ; preds = %cont3.i.i, %i29.i.i, %i25.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i29.i.i ], [ 0, %i25.i.i ], [ %call.i.i, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.8.exit

ap.8.exit:                                        ; preds = %cont3, %"$apply1.4.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.4.exit.i" ], [ 0, %cont3 ]
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %ap.8.exit
  %call8 = tail call fastcc i64 @sum.0(ptr %0, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %common.ret.op.i, i64 %call8)
  br label %common.ret
}

define private fastcc i64 @sum.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %sadd, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub9 = add nsw i64 %1, -1
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 %ssub9)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %1, i64 %call)
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
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %ap.8.exit, %cont6
  %common.ret.op = phi i64 [ %sadd, %cont6 ], [ 0, %ap.8.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap.8.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.4.exit.i"

i25.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.4.exit.i"

i29.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %spec.select.i.i = select i1 %trip7.not.i.i, i64 %head5.i.i, i64 0
  br label %"$apply1.4.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i25.i.i, label %i29.i.i

cont3.i.i:                                        ; preds = %i25.i.i
  %call.i.i = tail call fastcc i64 @sum.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.4.exit.i"

"$apply1.4.exit.i":                               ; preds = %cont3.i.i, %i29.i.i, %i25.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i29.i.i ], [ 0, %i25.i.i ], [ %call.i.i, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.8.exit

ap.8.exit:                                        ; preds = %cont3, %"$apply1.4.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.4.exit.i" ], [ 0, %cont3 ]
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %ap.8.exit
  %call8 = tail call fastcc i64 @sum.0(ptr %0, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %common.ret.op.i, i64 %call8)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @sum.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %sadd, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub9 = add nsw i64 %1, -1
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 %ssub9)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %1, i64 %call)
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
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %ap.8.exit, %cont6
  %common.ret.op = phi i64 [ %sadd, %cont6 ], [ 0, %ap.8.exit ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %ap.8.exit

cont.i:                                           ; preds = %cont3
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.4.exit.i"

i25.i.i:                                          ; preds = %cont.i.i
  %guard1.i.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i.i = icmp eq i64 %guard1.i.i, 0
  br i1 %trip2.not.i.i, label %cont3.i.i, label %"$apply1.4.exit.i"

i29.i.i:                                          ; preds = %cont.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  %spec.select.i.i = select i1 %trip7.not.i.i, i64 %head5.i.i, i64 0
  br label %"$apply1.4.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i25.i.i, label %i29.i.i

cont3.i.i:                                        ; preds = %i25.i.i
  %call.i.i = tail call fastcc i64 @sum.0(ptr %0, i64 4)
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.4.exit.i"

"$apply1.4.exit.i":                               ; preds = %cont3.i.i, %i29.i.i, %i25.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ %spec.select.i.i, %i29.i.i ], [ 0, %i25.i.i ], [ %call.i.i, %cont3.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %ap.8.exit

ap.8.exit:                                        ; preds = %cont3, %"$apply1.4.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.4.exit.i" ], [ 0, %cont3 ]
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %ap.8.exit
  %call8 = tail call fastcc i64 @sum.0(ptr %0, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %common.ret.op.i, i64 %call8)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @sum.0(ptr %0, i64 range(i64 0, 5) %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %sadd, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub9 = add nsw i64 %1, -1
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 %ssub9)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %1, i64 %call)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
