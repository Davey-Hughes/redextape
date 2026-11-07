;; first-order-11
;; source:
;;   fn add1(x) { x + 1 } fn pair_sum(a, b) { a + b } pair_sum(1, add1(2))
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ 4, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
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

define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ 4, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
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

define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ 4, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
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
define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ 4, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
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
define range(i64 0, 5) i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ 4, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  tail call void @rt_leave(ptr %0)
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }
