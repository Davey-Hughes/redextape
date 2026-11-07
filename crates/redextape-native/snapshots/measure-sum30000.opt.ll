;; measure-sum30000
;; source:
;;   fn sum(n){ if n==0 {0} else { n + sum(n-1) } } sum(30000)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @sum.0(ptr %0, i64 %1) unnamed_addr {
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

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @sum.0(ptr %0, i64 %1) unnamed_addr {
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
  %ssub9 = add i64 %1, -1
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

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @sum.0(ptr %0, i64 %1) unnamed_addr {
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
  %ssub9 = add i64 %1, -1
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
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @sum.0(ptr %0, i64 %1) unnamed_addr #1 {
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
  %ssub9 = add i64 %1, -1
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
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @sum.0(ptr %0, i64 %1) unnamed_addr #1 {
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
  %ssub9 = add i64 %1, -1
  %call = tail call fastcc i64 @sum.0(ptr %0, i64 %ssub9)
  tail call void @rt_leave(ptr %0)
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %1, i64 %call)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
