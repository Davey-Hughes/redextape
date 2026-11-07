;; rxm-backward-jz
;; source:
;;       li	r0, #3
;;       li	r1, #1
;;       li	r2, #0
;;       li	rr, #0
;;   loop:
;;       add	rr, rr, r0
;;       sub	r0, r0, r1
;;       cmpeq	r3, r0, r2
;;       jz	r3, loop
;;       halt
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

define range(i64 0, 7) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont.1, %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont.1 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.1 = tail call i64 @rt_tick(ptr %0)
  %trip.not.1 = icmp eq i64 %guard.1, 0
  br i1 %trip.not.1, label %cont.1, label %common.ret

cont.1:                                           ; preds = %cont
  %guard.2 = tail call i64 @rt_tick(ptr %0)
  %trip.not.2 = icmp eq i64 %guard.2, 0
  %spec.select = select i1 %trip.not.2, i64 6, i64 0
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

define range(i64 0, 7) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont.1, %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont.1 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.1 = tail call i64 @rt_tick(ptr %0)
  %trip.not.1 = icmp eq i64 %guard.1, 0
  br i1 %trip.not.1, label %cont.1, label %common.ret

cont.1:                                           ; preds = %cont
  %guard.2 = tail call i64 @rt_tick(ptr %0)
  %trip.not.2 = icmp eq i64 %guard.2, 0
  %spec.select = select i1 %trip.not.2, i64 6, i64 0
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tick(ptr) local_unnamed_addr

define range(i64 0, 7) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont.1, %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont.1 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.1 = tail call i64 @rt_tick(ptr %0)
  %trip.not.1 = icmp eq i64 %guard.1, 0
  br i1 %trip.not.1, label %cont.1, label %common.ret

cont.1:                                           ; preds = %cont
  %guard.2 = tail call i64 @rt_tick(ptr %0)
  %trip.not.2 = icmp eq i64 %guard.2, 0
  %spec.select = select i1 %trip.not.2, i64 6, i64 0
  br label %common.ret
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
  br label %i4

i4:                                               ; preds = %cont, %prologue
  %r0.0 = phi i64 [ 3, %prologue ], [ %ssub7, %cont ]
  %rr.0 = phi i64 [ 0, %prologue ], [ %sadd, %cont ]
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %i4
  %common.ret.op = phi i64 [ 0, %i4 ], [ %sadd, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i4
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %rr.0, i64 %r0.0)
  %cmp = icmp samesign ugt i64 %r0.0, 1
  %ssub7 = add nsw i64 %r0.0, -1
  br i1 %cmp, label %i4, label %common.ret
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
  br label %i4

i4:                                               ; preds = %cont, %prologue
  %r0.0 = phi i64 [ 3, %prologue ], [ %ssub7, %cont ]
  %rr.0 = phi i64 [ 0, %prologue ], [ %sadd, %cont ]
  %guard = tail call i64 @rt_tick(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %i4
  %common.ret.op = phi i64 [ 0, %i4 ], [ %sadd, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i4
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %rr.0, i64 %r0.0)
  %cmp = icmp samesign ugt i64 %r0.0, 1
  %ssub7 = add nsw i64 %r0.0, -1
  br i1 %cmp, label %i4, label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
