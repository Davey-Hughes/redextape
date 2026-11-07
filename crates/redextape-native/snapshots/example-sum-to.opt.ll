;; example-sum-to
;; source:
;;   fn sum_to(n) {
;;       let mut acc = 0;
;;       while n > 0 {
;;           acc = acc + n;
;;           n = n - 1;
;;       }
;;       acc
;;   }
;;   sum_to(5)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 16) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %sum_to.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %sum_to.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %i7.1.i, label %sum_to.0.exit

i7.1.i:                                           ; preds = %cont
  %guard.1.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.1.i = icmp eq i64 %guard.1.i, 0
  br i1 %trip.not.1.i, label %i7.2.i, label %sum_to.0.exit

i7.2.i:                                           ; preds = %i7.1.i
  %guard.2.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.2.i = icmp eq i64 %guard.2.i, 0
  br i1 %trip.not.2.i, label %i7.3.i, label %sum_to.0.exit

i7.3.i:                                           ; preds = %i7.2.i
  %guard.3.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.3.i = icmp eq i64 %guard.3.i, 0
  br i1 %trip.not.3.i, label %i7.4.i, label %sum_to.0.exit

i7.4.i:                                           ; preds = %i7.3.i
  %guard.4.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.4.i = icmp eq i64 %guard.4.i, 0
  %spec.select.i = select i1 %trip.not.4.i, i64 15, i64 0
  br label %sum_to.0.exit

sum_to.0.exit:                                    ; preds = %cont, %i7.1.i, %i7.2.i, %i7.3.i, %i7.4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %i7.3.i ], [ 0, %i7.2.i ], [ 0, %i7.1.i ], [ %spec.select.i, %i7.4.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 16) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %sum_to.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %sum_to.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %i3.1.i, label %sum_to.0.exit

i3.1.i:                                           ; preds = %cont
  %guard.1.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.1.i = icmp eq i64 %guard.1.i, 0
  br i1 %trip.not.1.i, label %i3.2.i, label %sum_to.0.exit

i3.2.i:                                           ; preds = %i3.1.i
  %guard.2.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.2.i = icmp eq i64 %guard.2.i, 0
  br i1 %trip.not.2.i, label %i3.3.i, label %sum_to.0.exit

i3.3.i:                                           ; preds = %i3.2.i
  %guard.3.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.3.i = icmp eq i64 %guard.3.i, 0
  br i1 %trip.not.3.i, label %i3.4.i, label %sum_to.0.exit

i3.4.i:                                           ; preds = %i3.3.i
  %guard.4.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.4.i = icmp eq i64 %guard.4.i, 0
  %spec.select.i = select i1 %trip.not.4.i, i64 15, i64 0
  br label %sum_to.0.exit

sum_to.0.exit:                                    ; preds = %cont, %i3.1.i, %i3.2.i, %i3.3.i, %i3.4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %i3.3.i ], [ 0, %i3.2.i ], [ 0, %i3.1.i ], [ %spec.select.i, %i3.4.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 16) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %sum_to.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %sum_to.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %i3.1.i, label %sum_to.0.exit

i3.1.i:                                           ; preds = %cont
  %guard.1.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.1.i = icmp eq i64 %guard.1.i, 0
  br i1 %trip.not.1.i, label %i3.2.i, label %sum_to.0.exit

i3.2.i:                                           ; preds = %i3.1.i
  %guard.2.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.2.i = icmp eq i64 %guard.2.i, 0
  br i1 %trip.not.2.i, label %i3.3.i, label %sum_to.0.exit

i3.3.i:                                           ; preds = %i3.2.i
  %guard.3.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.3.i = icmp eq i64 %guard.3.i, 0
  br i1 %trip.not.3.i, label %i3.4.i, label %sum_to.0.exit

i3.4.i:                                           ; preds = %i3.3.i
  %guard.4.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.4.i = icmp eq i64 %guard.4.i, 0
  %spec.select.i = select i1 %trip.not.4.i, i64 15, i64 0
  br label %sum_to.0.exit

sum_to.0.exit:                                    ; preds = %cont, %i3.1.i, %i3.2.i, %i3.3.i, %i3.4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %i3.3.i ], [ 0, %i3.2.i ], [ 0, %i3.1.i ], [ %spec.select.i, %i3.4.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i7.i, label %common.ret

common.ret:                                       ; preds = %prologue, %sum_to.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %sum_to.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

i3.i:                                             ; preds = %i7.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %r1.0.i2, i64 %r0.0.i1)
  %ssub.i = add nsw i64 %r0.0.i1, -1
  %cmp.not.i = icmp eq i64 %ssub.i, 0
  br i1 %cmp.not.i, label %sum_to.0.exit, label %i7.i

i7.i:                                             ; preds = %prologue, %i3.i
  %r1.0.i2 = phi i64 [ %sadd.i, %i3.i ], [ 0, %prologue ]
  %r0.0.i1 = phi i64 [ %ssub.i, %i3.i ], [ 5, %prologue ]
  %guard.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %i3.i, label %sum_to.0.exit

sum_to.0.exit:                                    ; preds = %i3.i, %i7.i
  %common.ret.op.i = phi i64 [ 0, %i7.i ], [ %sadd.i, %i3.i ]
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

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i3.i, label %common.ret

common.ret:                                       ; preds = %prologue, %sum_to.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %sum_to.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

i3.i:                                             ; preds = %prologue, %i7.i
  %r0.0.i = phi i64 [ %ssub.i, %i7.i ], [ 5, %prologue ]
  %r1.0.i = phi i64 [ %sadd.i, %i7.i ], [ 0, %prologue ]
  %cmp.not.i = icmp eq i64 %r0.0.i, 0
  br i1 %cmp.not.i, label %sum_to.0.exit, label %i7.i

i7.i:                                             ; preds = %i3.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %r1.0.i, i64 %r0.0.i)
  %ssub.i = add nsw i64 %r0.0.i, -1
  %guard.i = tail call i64 @rt_tick(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %i3.i, label %sum_to.0.exit

sum_to.0.exit:                                    ; preds = %i3.i, %i7.i
  %common.ret.op.i = phi i64 [ 0, %i7.i ], [ %r1.0.i, %i3.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
