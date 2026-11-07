;; first-order-07
;; source:
;;   let mut n = 4; let mut acc = 0; while n > 0 { acc = acc + 1; n = n - 1; } acc
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i6.1, label %common.ret

i6.1:                                             ; preds = %prologue
  %guard.1 = tail call i64 @rt_tick(ptr %0)
  %trip.not.1 = icmp eq i64 %guard.1, 0
  br i1 %trip.not.1, label %i6.2, label %common.ret

i6.2:                                             ; preds = %i6.1
  %guard.2 = tail call i64 @rt_tick(ptr %0)
  %trip.not.2 = icmp eq i64 %guard.2, 0
  br i1 %trip.not.2, label %i6.3, label %common.ret

i6.3:                                             ; preds = %i6.2
  %guard.3 = tail call i64 @rt_tick(ptr %0)
  %trip.not.3 = icmp eq i64 %guard.3, 0
  %spec.select = select i1 %trip.not.3, i64 4, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i6.3, %i6.2, %i6.1, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %i6.2 ], [ %spec.select, %i6.3 ], [ 0, %i6.1 ]
  ret i64 %common.ret.op
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2.1, label %common.ret

i2.1:                                             ; preds = %prologue
  %guard.1 = tail call i64 @rt_tick(ptr %0)
  %trip.not.1 = icmp eq i64 %guard.1, 0
  br i1 %trip.not.1, label %i2.2, label %common.ret

i2.2:                                             ; preds = %i2.1
  %guard.2 = tail call i64 @rt_tick(ptr %0)
  %trip.not.2 = icmp eq i64 %guard.2, 0
  br i1 %trip.not.2, label %i2.3, label %common.ret

i2.3:                                             ; preds = %i2.2
  %guard.3 = tail call i64 @rt_tick(ptr %0)
  %trip.not.3 = icmp eq i64 %guard.3, 0
  %spec.select = select i1 %trip.not.3, i64 4, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i2.3, %i2.2, %i2.1, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %i2.2 ], [ %spec.select, %i2.3 ], [ 0, %i2.1 ]
  ret i64 %common.ret.op
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2.1, label %common.ret

i2.1:                                             ; preds = %prologue
  %guard.1 = tail call i64 @rt_tick(ptr %0)
  %trip.not.1 = icmp eq i64 %guard.1, 0
  br i1 %trip.not.1, label %i2.2, label %common.ret

i2.2:                                             ; preds = %i2.1
  %guard.2 = tail call i64 @rt_tick(ptr %0)
  %trip.not.2 = icmp eq i64 %guard.2, 0
  br i1 %trip.not.2, label %i2.3, label %common.ret

i2.3:                                             ; preds = %i2.2
  %guard.3 = tail call i64 @rt_tick(ptr %0)
  %trip.not.3 = icmp eq i64 %guard.3, 0
  %spec.select = select i1 %trip.not.3, i64 4, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i2.3, %i2.2, %i2.1, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %i2.2 ], [ %spec.select, %i2.3 ], [ 0, %i2.1 ]
  ret i64 %common.ret.op
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  br label %i6

i2:                                               ; preds = %i6
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.06, i64 1)
  %ssub = add nsw i64 %r0.05, -1
  %cmp.not = icmp eq i64 %ssub, 0
  br i1 %cmp.not, label %common.ret, label %i6

i6:                                               ; preds = %prologue, %i2
  %r1.06 = phi i64 [ 0, %prologue ], [ %sadd, %i2 ]
  %r0.05 = phi i64 [ 4, %prologue ], [ %ssub, %i2 ]
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2, label %common.ret

common.ret:                                       ; preds = %i2, %i6
  %common.ret.op = phi i64 [ 0, %i6 ], [ %sadd, %i2 ]
  ret i64 %common.ret.op
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  br label %i2

i2:                                               ; preds = %i6, %prologue
  %r0.0 = phi i64 [ 4, %prologue ], [ %ssub, %i6 ]
  %r1.0 = phi i64 [ 0, %prologue ], [ %sadd, %i6 ]
  %cmp.not = icmp eq i64 %r0.0, 0
  br i1 %cmp.not, label %common.ret, label %i6

i6:                                               ; preds = %i2
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.0, i64 1)
  %ssub = add nsw i64 %r0.0, -1
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2, label %common.ret

common.ret:                                       ; preds = %i2, %i6
  %common.ret.op = phi i64 [ 0, %i6 ], [ %r1.0, %i2 ]
  ret i64 %common.ret.op
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
