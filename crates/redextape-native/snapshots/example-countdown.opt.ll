;; example-countdown
;; source:
;;   fn countdown(n) {
;;       let mut xs = nil;
;;       let mut i = 1;
;;       while i <= n {
;;           xs = cons(i, xs);
;;           i = i + 1;
;;       }
;;       xs
;;   }
;;
;;   countdown(4)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %countdown.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %countdown.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %countdown.0.exit

cont.i:                                           ; preds = %cont
  %guard3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.i = icmp eq i64 %guard3.i, 0
  br i1 %trip4.not.i, label %i8.1.i, label %countdown.0.exit

i8.1.i:                                           ; preds = %cont.i
  %cons.1.i = tail call i64 @rt_cons(ptr %0, i64 2, i64 %cons.i)
  %guard.1.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.1.i = icmp eq i64 %guard.1.i, 0
  br i1 %trip.not.1.i, label %cont.1.i, label %countdown.0.exit

cont.1.i:                                         ; preds = %i8.1.i
  %guard3.1.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.1.i = icmp eq i64 %guard3.1.i, 0
  br i1 %trip4.not.1.i, label %i8.2.i, label %countdown.0.exit

i8.2.i:                                           ; preds = %cont.1.i
  %cons.2.i = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons.1.i)
  %guard.2.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.2.i = icmp eq i64 %guard.2.i, 0
  br i1 %trip.not.2.i, label %cont.2.i, label %countdown.0.exit

cont.2.i:                                         ; preds = %i8.2.i
  %guard3.2.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.2.i = icmp eq i64 %guard3.2.i, 0
  br i1 %trip4.not.2.i, label %i8.3.i, label %countdown.0.exit

i8.3.i:                                           ; preds = %cont.2.i
  %cons.3.i = tail call i64 @rt_cons(ptr %0, i64 4, i64 %cons.2.i)
  %guard.3.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.3.i = icmp eq i64 %guard.3.i, 0
  br i1 %trip.not.3.i, label %cont.3.i, label %countdown.0.exit

cont.3.i:                                         ; preds = %i8.3.i
  %guard3.3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.3.i = icmp eq i64 %guard3.3.i, 0
  %spec.select.i = select i1 %trip4.not.3.i, i64 %cons.3.i, i64 0
  br label %countdown.0.exit

countdown.0.exit:                                 ; preds = %cont, %cont.i, %i8.1.i, %cont.1.i, %i8.2.i, %cont.2.i, %i8.3.i, %cont.3.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont.i ], [ %spec.select.i, %cont.3.i ], [ 0, %i8.3.i ], [ 0, %i8.1.i ], [ 0, %cont.1.i ], [ 0, %cont.2.i ], [ 0, %i8.2.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %countdown.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %countdown.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %countdown.0.exit

cont.i:                                           ; preds = %cont
  %guard3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.i = icmp eq i64 %guard3.i, 0
  br i1 %trip4.not.i, label %i4.1.i, label %countdown.0.exit

i4.1.i:                                           ; preds = %cont.i
  %cons.1.i = tail call i64 @rt_cons(ptr %0, i64 2, i64 %cons.i)
  %guard.1.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.1.i = icmp eq i64 %guard.1.i, 0
  br i1 %trip.not.1.i, label %cont.1.i, label %countdown.0.exit

cont.1.i:                                         ; preds = %i4.1.i
  %guard3.1.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.1.i = icmp eq i64 %guard3.1.i, 0
  br i1 %trip4.not.1.i, label %i4.2.i, label %countdown.0.exit

i4.2.i:                                           ; preds = %cont.1.i
  %cons.2.i = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons.1.i)
  %guard.2.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.2.i = icmp eq i64 %guard.2.i, 0
  br i1 %trip.not.2.i, label %cont.2.i, label %countdown.0.exit

cont.2.i:                                         ; preds = %i4.2.i
  %guard3.2.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.2.i = icmp eq i64 %guard3.2.i, 0
  br i1 %trip4.not.2.i, label %i4.3.i, label %countdown.0.exit

i4.3.i:                                           ; preds = %cont.2.i
  %cons.3.i = tail call i64 @rt_cons(ptr %0, i64 4, i64 %cons.2.i)
  %guard.3.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.3.i = icmp eq i64 %guard.3.i, 0
  br i1 %trip.not.3.i, label %cont.3.i, label %countdown.0.exit

cont.3.i:                                         ; preds = %i4.3.i
  %guard3.3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.3.i = icmp eq i64 %guard3.3.i, 0
  %spec.select.i = select i1 %trip4.not.3.i, i64 %cons.3.i, i64 0
  br label %countdown.0.exit

countdown.0.exit:                                 ; preds = %cont, %cont.i, %i4.1.i, %cont.1.i, %i4.2.i, %cont.2.i, %i4.3.i, %cont.3.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont.i ], [ %spec.select.i, %cont.3.i ], [ 0, %i4.3.i ], [ 0, %i4.1.i ], [ 0, %cont.1.i ], [ 0, %cont.2.i ], [ 0, %i4.2.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %countdown.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %countdown.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 1, i64 0)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %countdown.0.exit

cont.i:                                           ; preds = %cont
  %guard3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.i = icmp eq i64 %guard3.i, 0
  br i1 %trip4.not.i, label %i4.1.i, label %countdown.0.exit

i4.1.i:                                           ; preds = %cont.i
  %cons.1.i = tail call i64 @rt_cons(ptr %0, i64 2, i64 %cons.i)
  %guard.1.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.1.i = icmp eq i64 %guard.1.i, 0
  br i1 %trip.not.1.i, label %cont.1.i, label %countdown.0.exit

cont.1.i:                                         ; preds = %i4.1.i
  %guard3.1.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.1.i = icmp eq i64 %guard3.1.i, 0
  br i1 %trip4.not.1.i, label %i4.2.i, label %countdown.0.exit

i4.2.i:                                           ; preds = %cont.1.i
  %cons.2.i = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons.1.i)
  %guard.2.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.2.i = icmp eq i64 %guard.2.i, 0
  br i1 %trip.not.2.i, label %cont.2.i, label %countdown.0.exit

cont.2.i:                                         ; preds = %i4.2.i
  %guard3.2.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.2.i = icmp eq i64 %guard3.2.i, 0
  br i1 %trip4.not.2.i, label %i4.3.i, label %countdown.0.exit

i4.3.i:                                           ; preds = %cont.2.i
  %cons.3.i = tail call i64 @rt_cons(ptr %0, i64 4, i64 %cons.2.i)
  %guard.3.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.3.i = icmp eq i64 %guard.3.i, 0
  br i1 %trip.not.3.i, label %cont.3.i, label %countdown.0.exit

cont.3.i:                                         ; preds = %i4.3.i
  %guard3.3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.3.i = icmp eq i64 %guard3.3.i, 0
  %spec.select.i = select i1 %trip4.not.3.i, i64 %cons.3.i, i64 0
  br label %countdown.0.exit

countdown.0.exit:                                 ; preds = %cont, %cont.i, %i4.1.i, %cont.1.i, %i4.2.i, %cont.2.i, %i4.3.i, %cont.3.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont.i ], [ %spec.select.i, %cont.3.i ], [ 0, %i4.3.i ], [ 0, %i4.1.i ], [ 0, %cont.1.i ], [ 0, %cont.2.i ], [ 0, %i4.2.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i8.i, label %common.ret

common.ret:                                       ; preds = %prologue, %countdown.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %countdown.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

i4.i:                                             ; preds = %cont.i
  %sadd.i = add nuw nsw i64 %r2.0.i2, 1
  %exitcond.i = icmp eq i64 %sadd.i, 5
  br i1 %exitcond.i, label %countdown.0.exit, label %i8.i

i8.i:                                             ; preds = %prologue, %i4.i
  %r2.0.i2 = phi i64 [ %sadd.i, %i4.i ], [ 1, %prologue ]
  %r1.0.i1 = phi i64 [ %cons.i, %i4.i ], [ 0, %prologue ]
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 %r2.0.i2, i64 %r1.0.i1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %countdown.0.exit

cont.i:                                           ; preds = %i8.i
  %guard3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.i = icmp eq i64 %guard3.i, 0
  br i1 %trip4.not.i, label %i4.i, label %countdown.0.exit

countdown.0.exit:                                 ; preds = %i4.i, %i8.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i8.i ], [ 0, %cont.i ], [ %cons.i, %i4.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_tick(ptr) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %i4.i, label %common.ret

common.ret:                                       ; preds = %prologue, %countdown.0.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %countdown.0.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

i4.i:                                             ; preds = %prologue, %cont.i
  %r1.0.i = phi i64 [ %cons.i, %cont.i ], [ 0, %prologue ]
  %r2.0.i = phi i64 [ %sadd.i, %cont.i ], [ 1, %prologue ]
  %exitcond.i = icmp eq i64 %r2.0.i, 5
  br i1 %exitcond.i, label %countdown.0.exit, label %i8.i

i8.i:                                             ; preds = %i4.i
  %cons.i = tail call i64 @rt_cons(ptr %0, i64 %r2.0.i, i64 %r1.0.i)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %countdown.0.exit

cont.i:                                           ; preds = %i8.i
  %sadd.i = add nuw nsw i64 %r2.0.i, 1
  %guard3.i = tail call i64 @rt_tick(ptr %0)
  %trip4.not.i = icmp eq i64 %guard3.i, 0
  br i1 %trip4.not.i, label %i4.i, label %countdown.0.exit

countdown.0.exit:                                 ; preds = %i4.i, %i8.i, %cont.i
  %common.ret.op.i = phi i64 [ 0, %i8.i ], [ 0, %cont.i ], [ %r1.0.i, %i4.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }
