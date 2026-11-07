;; first-order-27
;; source:
;;   fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)
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

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call9, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.6(ptr %0, i64 %cons, i64 4)
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call9 = tail call fastcc i64 @ap.6(ptr %0, i64 %call, i64 5)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @ap.6(ptr %0, i64 %1, i64 range(i64 4, 6) %2) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head10.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard11.i = tail call i64 @rt_faulted(ptr %0)
  %trip12.not.i = icmp eq i64 %guard11.i, 0
  br i1 %trip12.not.i, label %cont13.i, label %"$apply1.0.exit"

i22.i:                                            ; preds = %cont13.i
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 range(i64 4, 6) %2, i64 0)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.0.exit"

i29.i:                                            ; preds = %cont13.i
  %head25.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard26.i = tail call i64 @rt_faulted(ptr %0)
  %trip27.not.i = icmp eq i64 %guard26.i, 0
  br i1 %trip27.not.i, label %i31.i, label %"$apply1.0.exit"

i31.i:                                            ; preds = %cont20.i, %cont8.i, %i29.i
  %rr.0.i = phi i64 [ %head25.i, %i29.i ], [ %cons21.i, %cont20.i ], [ %sadd.i, %cont8.i ]
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 1
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 range(i64 4, 6) %2)
  br label %i31.i

cont13.i:                                         ; preds = %i17.i
  %cmp14.not.i = icmp eq i64 %head10.i, 0
  br i1 %cmp14.not.i, label %i22.i, label %i29.i

cont20.i:                                         ; preds = %i22.i
  %cons21.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons.i)
  %guard22.i = tail call i64 @rt_faulted(ptr %0)
  %trip23.not.i = icmp eq i64 %guard22.i, 0
  br i1 %trip23.not.i, label %i31.i, label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %i17.i, %i22.i, %i29.i, %i31.i, %cont4.i, %cont20.i
  %common.ret.op.i = phi i64 [ %rr.0.i, %i31.i ], [ 0, %i29.i ], [ 0, %cont20.i ], [ 0, %i22.i ], [ 0, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ 0, %cont ]
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

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call9, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.6(ptr %0, i64 %cons, i64 4)
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call9 = tail call fastcc i64 @ap.6(ptr %0, i64 %call, i64 5)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @ap.6(ptr %0, i64 %1, i64 range(i64 4, 6) %2) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head10.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard11.i = tail call i64 @rt_faulted(ptr %0)
  %trip12.not.i = icmp eq i64 %guard11.i, 0
  br i1 %trip12.not.i, label %cont13.i, label %"$apply1.0.exit"

i22.i:                                            ; preds = %cont13.i
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 range(i64 4, 6) %2, i64 0)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.0.exit"

i29.i:                                            ; preds = %cont13.i
  %head25.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard26.i = tail call i64 @rt_faulted(ptr %0)
  %trip27.not.i = icmp eq i64 %guard26.i, 0
  br i1 %trip27.not.i, label %i31.i, label %"$apply1.0.exit"

i31.i:                                            ; preds = %cont20.i, %cont8.i, %i29.i
  %rr.0.i = phi i64 [ %head25.i, %i29.i ], [ %cons21.i, %cont20.i ], [ %sadd.i, %cont8.i ]
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 1
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 range(i64 4, 6) %2)
  br label %i31.i

cont13.i:                                         ; preds = %i17.i
  %cmp14.not.i = icmp eq i64 %head10.i, 0
  br i1 %cmp14.not.i, label %i22.i, label %i29.i

cont20.i:                                         ; preds = %i22.i
  %cons21.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons.i)
  %guard22.i = tail call i64 @rt_faulted(ptr %0)
  %trip23.not.i = icmp eq i64 %guard22.i, 0
  br i1 %trip23.not.i, label %i31.i, label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %i17.i, %i22.i, %i29.i, %i31.i, %cont4.i, %cont20.i
  %common.ret.op.i = phi i64 [ %rr.0.i, %i31.i ], [ 0, %i29.i ], [ 0, %cont20.i ], [ 0, %i22.i ], [ 0, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ 0, %cont ]
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

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call9, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.6(ptr %0, i64 %cons, i64 4)
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call9 = tail call fastcc i64 @ap.6(ptr %0, i64 %call, i64 5)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @ap.6(ptr %0, i64 %1, i64 range(i64 4, 6) %2) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head10.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard11.i = tail call i64 @rt_faulted(ptr %0)
  %trip12.not.i = icmp eq i64 %guard11.i, 0
  br i1 %trip12.not.i, label %cont13.i, label %"$apply1.0.exit"

i22.i:                                            ; preds = %cont13.i
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 range(i64 4, 6) %2, i64 0)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.0.exit"

i29.i:                                            ; preds = %cont13.i
  %head25.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard26.i = tail call i64 @rt_faulted(ptr %0)
  %trip27.not.i = icmp eq i64 %guard26.i, 0
  br i1 %trip27.not.i, label %i31.i, label %"$apply1.0.exit"

i31.i:                                            ; preds = %cont20.i, %cont8.i, %i29.i
  %rr.0.i = phi i64 [ %head25.i, %i29.i ], [ %cons21.i, %cont20.i ], [ %sadd.i, %cont8.i ]
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 1
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 range(i64 4, 6) %2)
  br label %i31.i

cont13.i:                                         ; preds = %i17.i
  %cmp14.not.i = icmp eq i64 %head10.i, 0
  br i1 %cmp14.not.i, label %i22.i, label %i29.i

cont20.i:                                         ; preds = %i22.i
  %cons21.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons.i)
  %guard22.i = tail call i64 @rt_faulted(ptr %0)
  %trip23.not.i = icmp eq i64 %guard22.i, 0
  br i1 %trip23.not.i, label %i31.i, label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %i17.i, %i22.i, %i29.i, %i31.i, %cont4.i, %cont20.i
  %common.ret.op.i = phi i64 [ %rr.0.i, %i31.i ], [ 0, %i29.i ], [ 0, %cont20.i ], [ 0, %i22.i ], [ 0, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ 0, %cont ]
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
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call9, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.6(ptr %0, i64 %cons, i64 4)
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call9 = tail call fastcc i64 @ap.6(ptr %0, i64 %call, i64 5)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @ap.6(ptr %0, i64 %1, i64 range(i64 4, 6) %2) unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head10.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard11.i = tail call i64 @rt_faulted(ptr %0)
  %trip12.not.i = icmp eq i64 %guard11.i, 0
  br i1 %trip12.not.i, label %cont13.i, label %"$apply1.0.exit"

i22.i:                                            ; preds = %cont13.i
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 range(i64 4, 6) %2, i64 0)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.0.exit"

i29.i:                                            ; preds = %cont13.i
  %head25.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard26.i = tail call i64 @rt_faulted(ptr %0)
  %trip27.not.i = icmp eq i64 %guard26.i, 0
  br i1 %trip27.not.i, label %i31.i, label %"$apply1.0.exit"

i31.i:                                            ; preds = %cont20.i, %cont8.i, %i29.i
  %rr.0.i = phi i64 [ %head25.i, %i29.i ], [ %cons21.i, %cont20.i ], [ %sadd.i, %cont8.i ]
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 1
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 range(i64 4, 6) %2)
  br label %i31.i

cont13.i:                                         ; preds = %i17.i
  %cmp14.not.i = icmp eq i64 %head10.i, 0
  br i1 %cmp14.not.i, label %i22.i, label %i29.i

cont20.i:                                         ; preds = %i22.i
  %cons21.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons.i)
  %guard22.i = tail call i64 @rt_faulted(ptr %0)
  %trip23.not.i = icmp eq i64 %guard22.i, 0
  br i1 %trip23.not.i, label %i31.i, label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %i17.i, %i22.i, %i29.i, %i31.i, %cont4.i, %cont20.i
  %common.ret.op.i = phi i64 [ %rr.0.i, %i31.i ], [ 0, %i29.i ], [ 0, %cont20.i ], [ 0, %i22.i ], [ 0, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ 0, %cont ]
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
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call9, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ap.6(ptr %0, i64 %cons, i64 4)
  tail call void @rt_leave(ptr %0)
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call9 = tail call fastcc i64 @ap.6(ptr %0, i64 %call, i64 5)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @ap.6(ptr %0, i64 %1, i64 range(i64 4, 6) %2) unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head10.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard11.i = tail call i64 @rt_faulted(ptr %0)
  %trip12.not.i = icmp eq i64 %guard11.i, 0
  br i1 %trip12.not.i, label %cont13.i, label %"$apply1.0.exit"

i22.i:                                            ; preds = %cont13.i
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 range(i64 4, 6) %2, i64 0)
  %guard18.i = tail call i64 @rt_faulted(ptr %0)
  %trip19.not.i = icmp eq i64 %guard18.i, 0
  br i1 %trip19.not.i, label %cont20.i, label %"$apply1.0.exit"

i29.i:                                            ; preds = %cont13.i
  %head25.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard26.i = tail call i64 @rt_faulted(ptr %0)
  %trip27.not.i = icmp eq i64 %guard26.i, 0
  br i1 %trip27.not.i, label %i31.i, label %"$apply1.0.exit"

i31.i:                                            ; preds = %cont20.i, %cont8.i, %i29.i
  %rr.0.i = phi i64 [ %head25.i, %i29.i ], [ %cons21.i, %cont20.i ], [ %sadd.i, %cont8.i ]
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 1
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 range(i64 4, 6) %2)
  br label %i31.i

cont13.i:                                         ; preds = %i17.i
  %cmp14.not.i = icmp eq i64 %head10.i, 0
  br i1 %cmp14.not.i, label %i22.i, label %i29.i

cont20.i:                                         ; preds = %i22.i
  %cons21.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons.i)
  %guard22.i = tail call i64 @rt_faulted(ptr %0)
  %trip23.not.i = icmp eq i64 %guard22.i, 0
  br i1 %trip23.not.i, label %i31.i, label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %i17.i, %i22.i, %i29.i, %i31.i, %cont4.i, %cont20.i
  %common.ret.op.i = phi i64 [ %rr.0.i, %i31.i ], [ 0, %i29.i ], [ 0, %cont20.i ], [ 0, %i22.i ], [ 0, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
