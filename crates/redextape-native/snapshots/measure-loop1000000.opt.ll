;; measure-loop1000000
;; source:
;;   let mut i = 0; let mut acc = 0; while i < 1000000 { acc = acc + i; i = i + 1; } acc
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  br label %i6

i2:                                               ; preds = %i6
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.09, i64 %r0.08)
  %sadd3 = add nuw nsw i64 %r0.08, 1
  %exitcond = icmp eq i64 %sadd3, 1000000
  br i1 %exitcond, label %common.ret, label %i6

i6:                                               ; preds = %prologue, %i2
  %r1.09 = phi i64 [ 0, %prologue ], [ %sadd, %i2 ]
  %r0.08 = phi i64 [ 0, %prologue ], [ %sadd3, %i2 ]
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2, label %common.ret

common.ret:                                       ; preds = %i2, %i6
  %common.ret.op = phi i64 [ 0, %i6 ], [ %sadd, %i2 ]
  ret i64 %common.ret.op
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  br label %i6

i2:                                               ; preds = %i6
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.09, i64 %r0.08)
  %sadd3 = add nuw nsw i64 %r0.08, 1
  %exitcond = icmp eq i64 %sadd3, 1000000
  br i1 %exitcond, label %common.ret, label %i6

i6:                                               ; preds = %prologue, %i2
  %r1.09 = phi i64 [ 0, %prologue ], [ %sadd, %i2 ]
  %r0.08 = phi i64 [ 0, %prologue ], [ %sadd3, %i2 ]
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2, label %common.ret

common.ret:                                       ; preds = %i2, %i6
  %common.ret.op = phi i64 [ 0, %i6 ], [ %sadd, %i2 ]
  ret i64 %common.ret.op
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  br label %i6

i2:                                               ; preds = %i6
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.09, i64 %r0.08)
  %sadd3 = add nuw nsw i64 %r0.08, 1
  %exitcond = icmp eq i64 %sadd3, 1000000
  br i1 %exitcond, label %common.ret, label %i6

i6:                                               ; preds = %prologue, %i2
  %r1.09 = phi i64 [ 0, %prologue ], [ %sadd, %i2 ]
  %r0.08 = phi i64 [ 0, %prologue ], [ %sadd3, %i2 ]
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2, label %common.ret

common.ret:                                       ; preds = %i2, %i6
  %common.ret.op = phi i64 [ 0, %i6 ], [ %sadd, %i2 ]
  ret i64 %common.ret.op
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
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
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.09, i64 %r0.08)
  %sadd3 = add nuw nsw i64 %r0.08, 1
  %exitcond = icmp eq i64 %sadd3, 1000000
  br i1 %exitcond, label %common.ret, label %i6

i6:                                               ; preds = %prologue, %i2
  %r1.09 = phi i64 [ 0, %prologue ], [ %sadd, %i2 ]
  %r0.08 = phi i64 [ 0, %prologue ], [ %sadd3, %i2 ]
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
  %r0.0 = phi i64 [ 0, %prologue ], [ %sadd3, %i6 ]
  %r1.0 = phi i64 [ 0, %prologue ], [ %sadd, %i6 ]
  %exitcond = icmp eq i64 %r0.0, 1000000
  br i1 %exitcond, label %common.ret, label %i6

i6:                                               ; preds = %i2
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %r1.0, i64 %r0.0)
  %sadd3 = add nuw nsw i64 %r0.0, 1
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i2, label %common.ret

common.ret:                                       ; preds = %i2, %i6
  %common.ret.op = phi i64 [ 0, %i6 ], [ %r1.0, %i2 ]
  ret i64 %common.ret.op
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
