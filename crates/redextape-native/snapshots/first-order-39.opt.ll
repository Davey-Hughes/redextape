;; first-order-39
;; source:
;;   fn b(x) { x + 1 } fn v(x) { x * 10 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)
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

define range(i64 6, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont10, %cont17
  %common.ret.op = phi i64 [ %sadd21, %cont17 ], [ 0, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.8(ptr %0, i64 %cons)
  tail call void @rt_leave(ptr %0)
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  %call13 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %guard15 = tail call i64 @rt_enter(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont10
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call13)
  tail call void @rt_leave(ptr %0)
  %sadd21 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 6)
  br label %common.ret
}

define private fastcc i64 @ap.8(ptr %0, i64 %1) unnamed_addr {
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

i28.i:                                            ; preds = %cont9.i
  %head14.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard15.i = tail call i64 @rt_faulted(ptr %0)
  %trip16.not.i = icmp eq i64 %guard15.i, 0
  %spec.select.i = select i1 %trip16.not.i, i64 %head14.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %"$apply1.2.exit", label %i28.i

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i28.i, %cont3.i, %cont9.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i28.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ 2, %cont3.i ], [ 10, %cont9.i ]
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

define range(i64 6, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont10, %cont17
  %common.ret.op = phi i64 [ %sadd21, %cont17 ], [ 0, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.8(ptr %0, i64 %cons)
  tail call void @rt_leave(ptr %0)
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  %call13 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %guard15 = tail call i64 @rt_enter(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont10
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call13)
  tail call void @rt_leave(ptr %0)
  %sadd21 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 6)
  br label %common.ret
}

define private fastcc i64 @ap.8(ptr %0, i64 %1) unnamed_addr {
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

i28.i:                                            ; preds = %cont9.i
  %head14.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard15.i = tail call i64 @rt_faulted(ptr %0)
  %trip16.not.i = icmp eq i64 %guard15.i, 0
  %spec.select.i = select i1 %trip16.not.i, i64 %head14.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %"$apply1.2.exit", label %i28.i

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i28.i, %cont3.i, %cont9.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i28.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ 2, %cont3.i ], [ 10, %cont9.i ]
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

define range(i64 6, 1) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont10, %cont17
  %common.ret.op = phi i64 [ %sadd21, %cont17 ], [ 0, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.8(ptr %0, i64 %cons)
  tail call void @rt_leave(ptr %0)
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  %call13 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %guard15 = tail call i64 @rt_enter(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont10
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call13)
  tail call void @rt_leave(ptr %0)
  %sadd21 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 6)
  br label %common.ret
}

define private fastcc i64 @ap.8(ptr %0, i64 %1) unnamed_addr {
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

i28.i:                                            ; preds = %cont9.i
  %head14.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard15.i = tail call i64 @rt_faulted(ptr %0)
  %trip16.not.i = icmp eq i64 %guard15.i, 0
  %spec.select.i = select i1 %trip16.not.i, i64 %head14.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %"$apply1.2.exit", label %i28.i

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i28.i, %cont3.i, %cont9.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i28.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ 2, %cont3.i ], [ 10, %cont9.i ]
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
define range(i64 6, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont10, %cont17
  %common.ret.op = phi i64 [ %sadd21, %cont17 ], [ 0, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.8(ptr %0, i64 %cons)
  tail call void @rt_leave(ptr %0)
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  %call13 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %guard15 = tail call i64 @rt_enter(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont10
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call13)
  tail call void @rt_leave(ptr %0)
  %sadd21 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 6)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @ap.8(ptr %0, i64 %1) unnamed_addr #1 {
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

i28.i:                                            ; preds = %cont9.i
  %head14.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard15.i = tail call i64 @rt_faulted(ptr %0)
  %trip16.not.i = icmp eq i64 %guard15.i, 0
  %spec.select.i = select i1 %trip16.not.i, i64 %head14.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %"$apply1.2.exit", label %i28.i

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i28.i, %cont3.i, %cont9.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i28.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ 2, %cont3.i ], [ 10, %cont9.i ]
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
define range(i64 6, 1) i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont10, %cont17
  %common.ret.op = phi i64 [ %sadd21, %cont17 ], [ 0, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.8(ptr %0, i64 %cons)
  tail call void @rt_leave(ptr %0)
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  %call13 = tail call fastcc i64 @ap.8(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %guard15 = tail call i64 @rt_enter(ptr %0)
  %trip16.not = icmp eq i64 %guard15, 0
  br i1 %trip16.not, label %cont17, label %common.ret

cont17:                                           ; preds = %cont10
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call13)
  tail call void @rt_leave(ptr %0)
  %sadd21 = tail call i64 @llvm.uadd.sat.i64(i64 %sadd, i64 6)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @ap.8(ptr %0, i64 %1) unnamed_addr #1 {
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

i28.i:                                            ; preds = %cont9.i
  %head14.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard15.i = tail call i64 @rt_faulted(ptr %0)
  %trip16.not.i = icmp eq i64 %guard15.i, 0
  %spec.select.i = select i1 %trip16.not.i, i64 %head14.i, i64 0
  br label %"$apply1.2.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i14.i, label %i18.i

cont3.i:                                          ; preds = %i14.i
  tail call void @rt_leave(ptr %0)
  br label %"$apply1.2.exit"

cont9.i:                                          ; preds = %i18.i
  %cmp10.not.i = icmp eq i64 %head6.i, 1
  br i1 %cmp10.not.i, label %"$apply1.2.exit", label %i28.i

"$apply1.2.exit":                                 ; preds = %cont, %i14.i, %i18.i, %i28.i, %cont3.i, %cont9.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ %spec.select.i, %i28.i ], [ 0, %i18.i ], [ 0, %i14.i ], [ 2, %cont3.i ], [ 10, %cont9.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
