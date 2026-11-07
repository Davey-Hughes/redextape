;; first-order-24
;; source:
;;   fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } } fn add1(x) { x + 1 } [3, 1, 2].map(add1)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_is_empty(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15
  %common.ret.op = phi i64 [ %call, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons1)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %cons9 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %guard13 = tail call i64 @rt_enter(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %call = tail call fastcc i64 @map.4(ptr %0, i64 %cons5, i64 %cons9)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @map.4(ptr %0, i64 %1, i64 %2) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i24, label %common.ret32

i24:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret32

common.ret32:                                     ; preds = %cont10, %"$apply1.0.exit", %cont, %i24, %prologue, %cont14
  %common.ret32.op = phi i64 [ %spec.select, %cont14 ], [ 0, %prologue ], [ 0, %i24 ], [ 0, %cont ], [ 0, %"$apply1.0.exit" ], [ 0, %cont10 ]
  ret i64 %common.ret32.op

cont:                                             ; preds = %i24
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret32

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.0.exit"

i13.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i13.i

"$apply1.0.exit":                                 ; preds = %cont4, %i8.i, %i13.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i13.i ], [ %sadd.i, %i8.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret32

cont10:                                           ; preds = %"$apply1.0.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret32

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.4(ptr %0, i64 %tail, i64 %2)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %common.ret.op.i, i64 %call17)
  %guard19 = tail call i64 @rt_faulted(ptr %0)
  %trip20.not = icmp eq i64 %guard19, 0
  %spec.select = select i1 %trip20.not, i64 %cons, i64 0
  br label %common.ret32
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_is_empty(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15
  %common.ret.op = phi i64 [ %call, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons1)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %cons9 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %guard13 = tail call i64 @rt_enter(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %call = tail call fastcc i64 @map.4(ptr %0, i64 %cons5, i64 %cons9)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @map.4(ptr %0, i64 %1, i64 %2) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i24, label %common.ret

i24:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i24, %cont, %"$apply1.0.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.0.exit" ], [ 0, %cont ], [ 0, %i24 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i24
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.0.exit"

i13.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i13.i

"$apply1.0.exit":                                 ; preds = %cont4, %i8.i, %i13.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i13.i ], [ %sadd.i, %i8.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.0.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.4(ptr %0, i64 %tail, i64 %2)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %common.ret.op.i, i64 %call17)
  %guard19 = tail call i64 @rt_faulted(ptr %0)
  %trip20.not = icmp eq i64 %guard19, 0
  %spec.select = select i1 %trip20.not, i64 %cons, i64 0
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_is_empty(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15
  %common.ret.op = phi i64 [ %call, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons1)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %cons9 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %guard13 = tail call i64 @rt_enter(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %call = tail call fastcc i64 @map.4(ptr %0, i64 %cons5, i64 %cons9)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @map.4(ptr %0, i64 %1, i64 %2) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i24, label %common.ret

i24:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i24, %cont, %"$apply1.0.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.0.exit" ], [ 0, %cont ], [ 0, %i24 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i24
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.0.exit"

i13.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i13.i

"$apply1.0.exit":                                 ; preds = %cont4, %i8.i, %i13.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i13.i ], [ %sadd.i, %i8.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.0.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.4(ptr %0, i64 %tail, i64 %2)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %common.ret.op.i, i64 %call17)
  %guard19 = tail call i64 @rt_faulted(ptr %0)
  %trip20.not = icmp eq i64 %guard19, 0
  %spec.select = select i1 %trip20.not, i64 %cons, i64 0
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_is_empty(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15
  %common.ret.op = phi i64 [ %call, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons1)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %cons9 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %guard13 = tail call i64 @rt_enter(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %call = tail call fastcc i64 @map.4(ptr %0, i64 %cons5, i64 %cons9)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @map.4(ptr %0, i64 %1, i64 %2) unnamed_addr #1 {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i24, label %common.ret

i24:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i24, %cont, %"$apply1.0.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.0.exit" ], [ 0, %cont ], [ 0, %i24 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i24
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.0.exit"

i13.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i13.i

"$apply1.0.exit":                                 ; preds = %cont4, %i8.i, %i13.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i13.i ], [ %sadd.i, %i8.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.0.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.4(ptr %0, i64 %tail, i64 %2)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %common.ret.op.i, i64 %call17)
  %guard19 = tail call i64 @rt_faulted(ptr %0)
  %trip20.not = icmp eq i64 %guard19, 0
  %spec.select = select i1 %trip20.not, i64 %cons, i64 0
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { optsize }
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_tail(ptr, i64) local_unnamed_addr

declare i64 @rt_is_empty(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 2, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15
  %common.ret.op = phi i64 [ %call, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cons1 = tail call i64 @rt_cons(ptr %0, i64 1, i64 %cons)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 3, i64 %cons1)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %cons9 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %guard13 = tail call i64 @rt_enter(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %call = tail call fastcc i64 @map.4(ptr %0, i64 %cons5, i64 %cons9)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @map.4(ptr %0, i64 %1, i64 %2) unnamed_addr #1 {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i24, label %common.ret

i24:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i24, %cont, %"$apply1.0.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.0.exit" ], [ 0, %cont ], [ 0, %i24 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i24
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.0.exit"

i13.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.0.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i8.i, label %i13.i

"$apply1.0.exit":                                 ; preds = %cont4, %i8.i, %i13.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i13.i ], [ %sadd.i, %i8.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.0.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.4(ptr %0, i64 %tail, i64 %2)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %common.ret.op.i, i64 %call17)
  %guard19 = tail call i64 @rt_faulted(ptr %0)
  %trip20.not = icmp eq i64 %guard19, 0
  %spec.select = select i1 %trip20.not, i64 %cons, i64 0
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
