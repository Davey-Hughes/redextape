;; first-order-30
;; source:
;;   fn a(n){ b(n) + 1 } fn b(n){ n * 2 } a(3)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 8) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %a.2.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %a.2.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %a.2.exit

cont.i:                                           ; preds = %cont
  tail call void @rt_leave(ptr %0)
  br label %a.2.exit

a.2.exit:                                         ; preds = %cont, %cont.i
  %common.ret.op.i = phi i64 [ 7, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 8) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %a.2.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %a.2.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %a.2.exit

cont.i:                                           ; preds = %cont
  tail call void @rt_leave(ptr %0)
  br label %a.2.exit

a.2.exit:                                         ; preds = %cont, %cont.i
  %common.ret.op.i = phi i64 [ 7, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 8) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %a.2.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %a.2.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %a.2.exit

cont.i:                                           ; preds = %cont
  tail call void @rt_leave(ptr %0)
  br label %a.2.exit

a.2.exit:                                         ; preds = %cont, %cont.i
  %common.ret.op.i = phi i64 [ 7, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: optsize
define range(i64 0, 8) i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %a.2.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %a.2.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %a.2.exit

cont.i:                                           ; preds = %cont
  tail call void @rt_leave(ptr %0)
  br label %a.2.exit

a.2.exit:                                         ; preds = %cont, %cont.i
  %common.ret.op.i = phi i64 [ 7, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define range(i64 0, 8) i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %a.2.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %a.2.exit ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %a.2.exit

cont.i:                                           ; preds = %cont
  tail call void @rt_leave(ptr %0)
  br label %a.2.exit

a.2.exit:                                         ; preds = %cont, %cont.i
  %common.ret.op.i = phi i64 [ 7, %cont.i ], [ 0, %cont ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }
