;; example-closure
;; source:
;;   let n = 2;
;;   let add_n = |x| x + n;
;;   add_n(40)
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %guard5 = tail call i64 @rt_enter(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont4
  %head.i = tail call i64 @rt_head(ptr %0, i64 %cons1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %cons1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head9.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard10.i = tail call i64 @rt_faulted(ptr %0)
  %trip11.not.i = icmp eq i64 %guard10.i, 0
  %spec.select.i = select i1 %trip11.not.i, i64 %head9.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont7
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 40)
  br label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont7, %i8.i, %i17.i, %cont4.i, %cont8.i
  %common.ret.op.i = phi i64 [ 0, %cont7 ], [ %spec.select.i, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %sadd.i, %cont8.i ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %guard5 = tail call i64 @rt_enter(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont4
  %head.i = tail call i64 @rt_head(ptr %0, i64 %cons1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %cons1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head9.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard10.i = tail call i64 @rt_faulted(ptr %0)
  %trip11.not.i = icmp eq i64 %guard10.i, 0
  %spec.select.i = select i1 %trip11.not.i, i64 %head9.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont7
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 40)
  br label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont7, %i8.i, %i17.i, %cont4.i, %cont8.i
  %common.ret.op.i = phi i64 [ 0, %cont7 ], [ %spec.select.i, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %sadd.i, %cont8.i ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %guard5 = tail call i64 @rt_enter(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont4
  %head.i = tail call i64 @rt_head(ptr %0, i64 %cons1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %cons1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head9.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard10.i = tail call i64 @rt_faulted(ptr %0)
  %trip11.not.i = icmp eq i64 %guard10.i, 0
  %spec.select.i = select i1 %trip11.not.i, i64 %head9.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont7
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 40)
  br label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont7, %i8.i, %i17.i, %cont4.i, %cont8.i
  %common.ret.op.i = phi i64 [ 0, %cont7 ], [ %spec.select.i, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %sadd.i, %cont8.i ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %guard5 = tail call i64 @rt_enter(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont4
  %head.i = tail call i64 @rt_head(ptr %0, i64 %cons1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %cons1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head9.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard10.i = tail call i64 @rt_faulted(ptr %0)
  %trip11.not.i = icmp eq i64 %guard10.i, 0
  %spec.select.i = select i1 %trip11.not.i, i64 %head9.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont7
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 40)
  br label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont7, %i8.i, %i17.i, %cont4.i, %cont8.i
  %common.ret.op.i = phi i64 [ 0, %cont7 ], [ %spec.select.i, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %sadd.i, %cont8.i ]
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
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %guard5 = tail call i64 @rt_enter(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont4
  %head.i = tail call i64 @rt_head(ptr %0, i64 %cons1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %cons1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i17.i:                                            ; preds = %cont.i
  %head9.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard10.i = tail call i64 @rt_faulted(ptr %0)
  %trip11.not.i = icmp eq i64 %guard10.i, 0
  %spec.select.i = select i1 %trip11.not.i, i64 %head9.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont7
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i17.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head5.i, i64 40)
  br label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %cont7, %i8.i, %i17.i, %cont4.i, %cont8.i
  %common.ret.op.i = phi i64 [ 0, %cont7 ], [ %spec.select.i, %i17.i ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %sadd.i, %cont8.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
