;; first-order-15
;; source:
;;   cons(1, cons(2, nil))
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %cons1, i64 0
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %cons1, i64 0
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %cons1, i64 0
  br label %common.ret
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %cons1, i64 0
  br label %common.ret
}

attributes #0 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %cons1, i64 0
  br label %common.ret
}

attributes #0 = { minsize optsize }
