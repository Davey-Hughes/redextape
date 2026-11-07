;; first-order-42
;; source:
;;   let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define range(i64 4, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6, %cont13, %cont17, %cont20
  %common.ret.op = phi i64 [ %sadd25, %cont20 ], [ 0, %cont17 ], [ 0, %cont13 ], [ 0, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  %call8 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call8, i64 4)
  %cons10 = tail call i64 @rt_cons(ptr %0, i64 7, i64 0)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont6
  %cons14 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons10)
  %guard15 = tail call i64 @rt_faulted(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont13
  %guard18 = tail call i64 @rt_enter(ptr %0)
  %trip19.not = icmp eq i64 %guard18, 0
  br i1 %trip19.not, label %cont20, label %common.ret

cont20:                                           ; preds = %cont17
  %call23 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons14, i64 5)
  tail call void @rt_leave(ptr %0)
  %sadd25 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 %call23)
  br label %common.ret
}

define private fastcc i64 @ap.8(ptr %0, i64 %1, i64 range(i64 2, 6) %2) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.2.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.2.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.2.exit"

i14.i:                                            ; preds = %cont.i
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %"$apply1.2.exit"

i18.i:                                            ; preds = %cont.i
  %head6.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard7.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i = icmp eq i64 %guard7.i, 0
  br i1 %trip8.not.i, label %cont9.i, label %"$apply1.2.exit"

i23.i:                                            ; preds = %cont9.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard14.i = tail call i64 @rt_faulted(ptr %0)
  %trip15.not.i = icmp eq i64 %guard14.i, 0
  br i1 %trip15.not.i, label %cont16.i, label %"$apply1.2.exit"

i32.i:                                            ; preds = %cont9.i
  %head22.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard23.i = tail call i64 @rt_faulted(ptr %0)
  %trip24.not.i = icmp eq i64 %guard23.i, 0
  %spec.select.i = select i1 %trip24.not.i, i64 %head22.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  %sadd.i.i = add nuw nsw i64 %2, 1
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %i23.i, label %i32.i

cont16.i:                                         ; preds = %i23.i
  %head17.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.2.exit"

cont20.i:                                         ; preds = %cont16.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 range(i64 2, 6) %2, i64 %head17.i)
  br label %"$apply1.2.exit"

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i23.i, %i32.i, %cont3.i, %cont16.i, %cont20.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i32.i ], [ 0, %cont16.i ], [ 0, %i23.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ %sadd.i, %cont20.i ], [ %sadd.i.i, %cont3.i ]
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

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define range(i64 4, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6, %cont13, %cont17, %cont20
  %common.ret.op = phi i64 [ %sadd25, %cont20 ], [ 0, %cont17 ], [ 0, %cont13 ], [ 0, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  %call8 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call8, i64 4)
  %cons10 = tail call i64 @rt_cons(ptr %0, i64 7, i64 0)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont6
  %cons14 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons10)
  %guard15 = tail call i64 @rt_faulted(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont13
  %guard18 = tail call i64 @rt_enter(ptr %0)
  %trip19.not = icmp eq i64 %guard18, 0
  br i1 %trip19.not, label %cont20, label %common.ret

cont20:                                           ; preds = %cont17
  %call23 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons14, i64 5)
  tail call void @rt_leave(ptr %0)
  %sadd25 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 %call23)
  br label %common.ret
}

define private fastcc i64 @ap.8(ptr %0, i64 %1, i64 range(i64 2, 6) %2) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.2.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.2.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.2.exit"

i14.i:                                            ; preds = %cont.i
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %"$apply1.2.exit"

i18.i:                                            ; preds = %cont.i
  %head6.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard7.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i = icmp eq i64 %guard7.i, 0
  br i1 %trip8.not.i, label %cont9.i, label %"$apply1.2.exit"

i23.i:                                            ; preds = %cont9.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard14.i = tail call i64 @rt_faulted(ptr %0)
  %trip15.not.i = icmp eq i64 %guard14.i, 0
  br i1 %trip15.not.i, label %cont16.i, label %"$apply1.2.exit"

i32.i:                                            ; preds = %cont9.i
  %head22.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard23.i = tail call i64 @rt_faulted(ptr %0)
  %trip24.not.i = icmp eq i64 %guard23.i, 0
  %spec.select.i = select i1 %trip24.not.i, i64 %head22.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  %sadd.i.i = add nuw nsw i64 %2, 1
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %i23.i, label %i32.i

cont16.i:                                         ; preds = %i23.i
  %head17.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.2.exit"

cont20.i:                                         ; preds = %cont16.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 range(i64 2, 6) %2, i64 %head17.i)
  br label %"$apply1.2.exit"

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i23.i, %i32.i, %cont3.i, %cont16.i, %cont20.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i32.i ], [ 0, %cont16.i ], [ 0, %i23.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ %sadd.i, %cont20.i ], [ %sadd.i.i, %cont3.i ]
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

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define range(i64 4, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6, %cont13, %cont17, %cont20
  %common.ret.op = phi i64 [ %sadd25, %cont20 ], [ 0, %cont17 ], [ 0, %cont13 ], [ 0, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  %call8 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call8, i64 4)
  %cons10 = tail call i64 @rt_cons(ptr %0, i64 7, i64 0)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont6
  %cons14 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons10)
  %guard15 = tail call i64 @rt_faulted(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont13
  %guard18 = tail call i64 @rt_enter(ptr %0)
  %trip19.not = icmp eq i64 %guard18, 0
  br i1 %trip19.not, label %cont20, label %common.ret

cont20:                                           ; preds = %cont17
  %call23 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons14, i64 5)
  tail call void @rt_leave(ptr %0)
  %sadd25 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 %call23)
  br label %common.ret
}

define private fastcc i64 @ap.8(ptr %0, i64 %1, i64 range(i64 2, 6) %2) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.2.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.2.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.2.exit"

i14.i:                                            ; preds = %cont.i
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %"$apply1.2.exit"

i18.i:                                            ; preds = %cont.i
  %head6.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard7.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i = icmp eq i64 %guard7.i, 0
  br i1 %trip8.not.i, label %cont9.i, label %"$apply1.2.exit"

i23.i:                                            ; preds = %cont9.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard14.i = tail call i64 @rt_faulted(ptr %0)
  %trip15.not.i = icmp eq i64 %guard14.i, 0
  br i1 %trip15.not.i, label %cont16.i, label %"$apply1.2.exit"

i32.i:                                            ; preds = %cont9.i
  %head22.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard23.i = tail call i64 @rt_faulted(ptr %0)
  %trip24.not.i = icmp eq i64 %guard23.i, 0
  %spec.select.i = select i1 %trip24.not.i, i64 %head22.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  %sadd.i.i = add nuw nsw i64 %2, 1
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %i23.i, label %i32.i

cont16.i:                                         ; preds = %i23.i
  %head17.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.2.exit"

cont20.i:                                         ; preds = %cont16.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 range(i64 2, 6) %2, i64 %head17.i)
  br label %"$apply1.2.exit"

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i23.i, %i32.i, %cont3.i, %cont16.i, %cont20.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i32.i ], [ 0, %cont16.i ], [ 0, %i23.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ %sadd.i, %cont20.i ], [ %sadd.i.i, %cont3.i ]
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

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define range(i64 4, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6, %cont13, %cont17, %cont20
  %common.ret.op = phi i64 [ %sadd25, %cont20 ], [ 0, %cont17 ], [ 0, %cont13 ], [ 0, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  %call8 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call8, i64 4)
  %cons10 = tail call i64 @rt_cons(ptr %0, i64 7, i64 0)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont6
  %cons14 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons10)
  %guard15 = tail call i64 @rt_faulted(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont13
  %guard18 = tail call i64 @rt_enter(ptr %0)
  %trip19.not = icmp eq i64 %guard18, 0
  br i1 %trip19.not, label %cont20, label %common.ret

cont20:                                           ; preds = %cont17
  %call23 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons14, i64 5)
  tail call void @rt_leave(ptr %0)
  %sadd25 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 %call23)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @ap.8(ptr %0, i64 %1, i64 range(i64 2, 6) %2) unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.2.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.2.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.2.exit"

i14.i:                                            ; preds = %cont.i
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %"$apply1.2.exit"

i18.i:                                            ; preds = %cont.i
  %head6.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard7.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i = icmp eq i64 %guard7.i, 0
  br i1 %trip8.not.i, label %cont9.i, label %"$apply1.2.exit"

i23.i:                                            ; preds = %cont9.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard14.i = tail call i64 @rt_faulted(ptr %0)
  %trip15.not.i = icmp eq i64 %guard14.i, 0
  br i1 %trip15.not.i, label %cont16.i, label %"$apply1.2.exit"

i32.i:                                            ; preds = %cont9.i
  %head22.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard23.i = tail call i64 @rt_faulted(ptr %0)
  %trip24.not.i = icmp eq i64 %guard23.i, 0
  %spec.select.i = select i1 %trip24.not.i, i64 %head22.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  %sadd.i.i = add nuw nsw i64 %2, 1
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %i23.i, label %i32.i

cont16.i:                                         ; preds = %i23.i
  %head17.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.2.exit"

cont20.i:                                         ; preds = %cont16.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 range(i64 2, 6) %2, i64 %head17.i)
  br label %"$apply1.2.exit"

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i23.i, %i32.i, %cont3.i, %cont16.i, %cont20.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i32.i ], [ 0, %cont16.i ], [ 0, %i23.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ %sadd.i, %cont20.i ], [ %sadd.i.i, %cont3.i ]
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

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define range(i64 4, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6, %cont13, %cont17, %cont20
  %common.ret.op = phi i64 [ %sadd25, %cont20 ], [ 0, %cont17 ], [ 0, %cont13 ], [ 0, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
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
  %call8 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons, i64 2)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call8, i64 4)
  %cons10 = tail call i64 @rt_cons(ptr %0, i64 7, i64 0)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont6
  %cons14 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons10)
  %guard15 = tail call i64 @rt_faulted(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont13
  %guard18 = tail call i64 @rt_enter(ptr %0)
  %trip19.not = icmp eq i64 %guard18, 0
  br i1 %trip19.not, label %cont20, label %common.ret

cont20:                                           ; preds = %cont17
  %call23 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons14, i64 5)
  tail call void @rt_leave(ptr %0)
  %sadd25 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 %call23)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @ap.8(ptr %0, i64 %1, i64 range(i64 2, 6) %2) unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.2.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.2.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.2.exit"

i14.i:                                            ; preds = %cont.i
  %guard1.i = tail call i64 @rt_enter(ptr %0)
  %trip2.not.i = icmp eq i64 %guard1.i, 0
  br i1 %trip2.not.i, label %cont3.i, label %"$apply1.2.exit"

i18.i:                                            ; preds = %cont.i
  %head6.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard7.i = tail call i64 @rt_faulted(ptr %0)
  %trip8.not.i = icmp eq i64 %guard7.i, 0
  br i1 %trip8.not.i, label %cont9.i, label %"$apply1.2.exit"

i23.i:                                            ; preds = %cont9.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard14.i = tail call i64 @rt_faulted(ptr %0)
  %trip15.not.i = icmp eq i64 %guard14.i, 0
  br i1 %trip15.not.i, label %cont16.i, label %"$apply1.2.exit"

i32.i:                                            ; preds = %cont9.i
  %head22.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard23.i = tail call i64 @rt_faulted(ptr %0)
  %trip24.not.i = icmp eq i64 %guard23.i, 0
  %spec.select.i = select i1 %trip24.not.i, i64 %head22.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  %sadd.i.i = add nuw nsw i64 %2, 1
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %i23.i, label %i32.i

cont16.i:                                         ; preds = %i23.i
  %head17.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.2.exit"

cont20.i:                                         ; preds = %cont16.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 range(i64 2, 6) %2, i64 %head17.i)
  br label %"$apply1.2.exit"

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i23.i, %i32.i, %cont3.i, %cont16.i, %cont20.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i32.i ], [ 0, %cont16.i ], [ 0, %i23.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ %sadd.i, %cont20.i ], [ %sadd.i.i, %cont3.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
