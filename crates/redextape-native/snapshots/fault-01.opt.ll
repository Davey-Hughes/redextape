;; fault-01
;; source:
;;   tail(nil)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %tail = tail call i64 @rt_tail(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  %spec.select = select i1 %trip.not, i64 %tail, i64 0
  ret i64 %spec.select
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %tail = tail call i64 @rt_tail(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  %spec.select = select i1 %trip.not, i64 %tail, i64 0
  ret i64 %spec.select
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %tail = tail call i64 @rt_tail(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  %spec.select = select i1 %trip.not, i64 %tail, i64 0
  ret i64 %spec.select
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %tail = tail call i64 @rt_tail(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  %spec.select = select i1 %trip.not, i64 %tail, i64 0
  ret i64 %spec.select
}

attributes #0 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %tail = tail call i64 @rt_tail(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  %spec.select = select i1 %trip.not, i64 %tail, i64 0
  ret i64 %spec.select
}

attributes #0 = { minsize optsize }
