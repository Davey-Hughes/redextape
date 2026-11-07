;; lambda-limitation-02
;; source:
;;   let mut n = 1; fn apply0(g) { g(0) } let f = |x| x + n; n = 10; apply0(f)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont11, %cont14
  %common.ret.op = phi i64 [ %call, %cont14 ], [ 0, %cont11 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  tail call void @rt_box_set(ptr %0, i64 %box, i64 10)
  %guard9 = tail call i64 @rt_faulted(ptr %0)
  %trip10.not = icmp eq i64 %guard9, 0
  br i1 %trip10.not, label %cont11, label %common.ret

cont11:                                           ; preds = %cont7
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont11
  %call = tail call fastcc i64 @apply0.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @apply0.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i18.i:                                            ; preds = %cont.i
  %head12.i = tail call i64 @rt_head(ptr %0, i64 0)
  br label %"$apply1.0.exit.sink.split"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i18.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %boxget.i = tail call i64 @rt_box_get(ptr %0, i64 %head5.i)
  br label %"$apply1.0.exit.sink.split"

"$apply1.0.exit.sink.split":                      ; preds = %cont8.i, %i18.i
  %head12.i.sink = phi i64 [ %head12.i, %i18.i ], [ %boxget.i, %cont8.i ]
  %guard13.i = tail call i64 @rt_faulted(ptr %0)
  %trip14.not.i = icmp eq i64 %guard13.i, 0
  %spec.select17.i = select i1 %trip14.not.i, i64 %head12.i.sink, i64 0
  br label %"$apply1.0.exit"

"$apply1.0.exit":                                 ; preds = %"$apply1.0.exit.sink.split", %cont, %i8.i, %cont4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %spec.select17.i, %"$apply1.0.exit.sink.split" ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont11, %cont14
  %common.ret.op = phi i64 [ %call, %cont14 ], [ 0, %cont11 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  tail call void @rt_box_set(ptr %0, i64 %box, i64 10)
  %guard9 = tail call i64 @rt_faulted(ptr %0)
  %trip10.not = icmp eq i64 %guard9, 0
  br i1 %trip10.not, label %cont11, label %common.ret

cont11:                                           ; preds = %cont7
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont11
  %call = tail call fastcc i64 @apply0.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @apply0.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i18.i:                                            ; preds = %cont.i
  %head12.i = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split.i

common.ret.sink.split.i:                          ; preds = %cont8.i, %i18.i
  %head12.sink.i = phi i64 [ %head12.i, %i18.i ], [ %boxget.i, %cont8.i ]
  %guard13.i = tail call i64 @rt_faulted(ptr %0)
  %trip14.not.i = icmp eq i64 %guard13.i, 0
  %spec.select17.i = select i1 %trip14.not.i, i64 %head12.sink.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i18.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %boxget.i = tail call i64 @rt_box_get(ptr %0, i64 %head5.i)
  br label %common.ret.sink.split.i

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %common.ret.sink.split.i, %cont4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %spec.select17.i, %common.ret.sink.split.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont11, %cont14
  %common.ret.op = phi i64 [ %call, %cont14 ], [ 0, %cont11 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  tail call void @rt_box_set(ptr %0, i64 %box, i64 10)
  %guard9 = tail call i64 @rt_faulted(ptr %0)
  %trip10.not = icmp eq i64 %guard9, 0
  br i1 %trip10.not, label %cont11, label %common.ret

cont11:                                           ; preds = %cont7
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont11
  %call = tail call fastcc i64 @apply0.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @apply0.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i18.i:                                            ; preds = %cont.i
  %head12.i = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split.i

common.ret.sink.split.i:                          ; preds = %cont8.i, %i18.i
  %head12.sink.i = phi i64 [ %head12.i, %i18.i ], [ %boxget.i, %cont8.i ]
  %guard13.i = tail call i64 @rt_faulted(ptr %0)
  %trip14.not.i = icmp eq i64 %guard13.i, 0
  %spec.select17.i = select i1 %trip14.not.i, i64 %head12.sink.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i18.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %boxget.i = tail call i64 @rt_box_get(ptr %0, i64 %head5.i)
  br label %common.ret.sink.split.i

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %common.ret.sink.split.i, %cont4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %spec.select17.i, %common.ret.sink.split.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont11, %cont14
  %common.ret.op = phi i64 [ %call, %cont14 ], [ 0, %cont11 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  tail call void @rt_box_set(ptr %0, i64 %box, i64 10)
  %guard9 = tail call i64 @rt_faulted(ptr %0)
  %trip10.not = icmp eq i64 %guard9, 0
  br i1 %trip10.not, label %cont11, label %common.ret

cont11:                                           ; preds = %cont7
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont11
  %call = tail call fastcc i64 @apply0.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @apply0.4(ptr %0, i64 %1) unnamed_addr #0 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %"$apply1.0.exit"
  %common.ret.op = phi i64 [ %common.ret.op.i, %"$apply1.0.exit" ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %head.i = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  br i1 %trip3.not.i, label %cont4.i, label %"$apply1.0.exit"

i18.i:                                            ; preds = %cont.i
  %head12.i = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split.i

common.ret.sink.split.i:                          ; preds = %cont8.i, %i18.i
  %head12.sink.i = phi i64 [ %head12.i, %i18.i ], [ %boxget.i, %cont8.i ]
  %guard13.i = tail call i64 @rt_faulted(ptr %0)
  %trip14.not.i = icmp eq i64 %guard13.i, 0
  %spec.select17.i = select i1 %trip14.not.i, i64 %head12.sink.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i18.i

cont4.i:                                          ; preds = %i8.i
  %head5.i = tail call i64 @rt_head(ptr %0, i64 %tail.i)
  %guard6.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i = icmp eq i64 %guard6.i, 0
  br i1 %trip7.not.i, label %cont8.i, label %"$apply1.0.exit"

cont8.i:                                          ; preds = %cont4.i
  %boxget.i = tail call i64 @rt_box_get(ptr %0, i64 %head5.i)
  br label %common.ret.sink.split.i

"$apply1.0.exit":                                 ; preds = %cont, %i8.i, %common.ret.sink.split.i, %cont4.i
  %common.ret.op.i = phi i64 [ 0, %cont ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %spec.select17.i, %common.ret.sink.split.i ]
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

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont7, %cont11, %apply0.4.exit
  %common.ret.op = phi i64 [ %common.ret.op.i, %apply0.4.exit ], [ 0, %cont11 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %cons4 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard5 = tail call i64 @rt_faulted(ptr %0)
  %trip6.not = icmp eq i64 %guard5, 0
  br i1 %trip6.not, label %cont7, label %common.ret

cont7:                                            ; preds = %cont3
  tail call void @rt_box_set(ptr %0, i64 %box, i64 10)
  %guard9 = tail call i64 @rt_faulted(ptr %0)
  %trip10.not = icmp eq i64 %guard9, 0
  br i1 %trip10.not, label %cont11, label %common.ret

cont11:                                           ; preds = %cont7
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont11
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %apply0.4.exit

cont.i:                                           ; preds = %cont14
  %head.i.i = tail call i64 @rt_head(ptr %0, i64 %cons4)
  %guard.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i.i = icmp eq i64 %guard.i.i, 0
  br i1 %trip.not.i.i, label %cont.i.i, label %"$apply1.0.exit.i"

i8.i.i:                                           ; preds = %cont.i.i
  %tail.i.i = tail call i64 @rt_tail(ptr %0, i64 %cons4)
  %guard2.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i.i = icmp eq i64 %guard2.i.i, 0
  br i1 %trip3.not.i.i, label %cont4.i.i, label %"$apply1.0.exit.i"

i18.i.i:                                          ; preds = %cont.i.i
  %head12.i.i = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split.i.i

common.ret.sink.split.i.i:                        ; preds = %cont8.i.i, %i18.i.i
  %head12.sink.i.i = phi i64 [ %head12.i.i, %i18.i.i ], [ %boxget.i.i, %cont8.i.i ]
  %guard13.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip14.not.i.i = icmp eq i64 %guard13.i.i, 0
  %spec.select17.i.i = select i1 %trip14.not.i.i, i64 %head12.sink.i.i, i64 0
  br label %"$apply1.0.exit.i"

cont.i.i:                                         ; preds = %cont.i
  %cmp.not.i.i = icmp eq i64 %head.i.i, 0
  br i1 %cmp.not.i.i, label %i8.i.i, label %i18.i.i

cont4.i.i:                                        ; preds = %i8.i.i
  %head5.i.i = tail call i64 @rt_head(ptr %0, i64 %tail.i.i)
  %guard6.i.i = tail call i64 @rt_faulted(ptr %0)
  %trip7.not.i.i = icmp eq i64 %guard6.i.i, 0
  br i1 %trip7.not.i.i, label %cont8.i.i, label %"$apply1.0.exit.i"

cont8.i.i:                                        ; preds = %cont4.i.i
  %boxget.i.i = tail call i64 @rt_box_get(ptr %0, i64 %head5.i.i)
  br label %common.ret.sink.split.i.i

"$apply1.0.exit.i":                               ; preds = %cont4.i.i, %common.ret.sink.split.i.i, %i8.i.i, %cont.i
  %common.ret.op.i.i = phi i64 [ 0, %cont.i ], [ 0, %cont4.i.i ], [ 0, %i8.i.i ], [ %spec.select17.i.i, %common.ret.sink.split.i.i ]
  tail call void @rt_leave(ptr %0)
  br label %apply0.4.exit

apply0.4.exit:                                    ; preds = %cont14, %"$apply1.0.exit.i"
  %common.ret.op.i = phi i64 [ %common.ret.op.i.i, %"$apply1.0.exit.i" ], [ 0, %cont14 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { minsize optsize }
