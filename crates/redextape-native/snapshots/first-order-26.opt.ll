;; first-order-26
;; source:
;;   fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
;;   fn fold(xs, acc, f) { if is_empty(xs) { acc } else { fold(tail(xs), f(acc, head(xs)), f) } }
;;   fn add(a, b) { a + b }
;;   fn add1(x) { x + 1 }
;;   fold([3, 1, 2].map(add1), 0, add)
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

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15, %cont19, %cont22
  %common.ret.op = phi i64 [ %call25, %cont22 ], [ 0, %cont19 ], [ 0, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
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
  %cons16 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard17 = tail call i64 @rt_faulted(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont15
  %guard20 = tail call i64 @rt_enter(ptr %0)
  %trip21.not = icmp eq i64 %guard20, 0
  br i1 %trip21.not, label %cont22, label %common.ret

cont22:                                           ; preds = %cont19
  %call25 = tail call fastcc i64 @fold.12(ptr %0, i64 %call, i64 0, i64 %cons16)
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

define private fastcc i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i49:                                              ; preds = %cont
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %2, i64 %3)
  br label %common.ret

i55:                                              ; preds = %cont
  %head1 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %head1, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i55, %i49, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %i55 ], [ %sadd, %i49 ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i49, label %i55
}

define private fastcc i64 @fold.12(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i67, label %common.ret33

i67:                                              ; preds = %prologue
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret33

common.ret33:                                     ; preds = %cont9, %cont6, %cont, %i67, %prologue, %cont16
  %common.ret33.op = phi i64 [ %call20, %cont16 ], [ 0, %i67 ], [ 0, %cont9 ], [ 0, %cont6 ], [ 0, %cont ], [ %2, %prologue ]
  ret i64 %common.ret33.op

cont:                                             ; preds = %i67
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret33

cont6:                                            ; preds = %cont
  %guard7 = tail call i64 @rt_enter(ptr %0)
  %trip8.not = icmp eq i64 %guard7, 0
  br i1 %trip8.not, label %cont9, label %common.ret33

cont9:                                            ; preds = %cont6
  %call = tail call fastcc i64 @"$apply2.8"(ptr %0, i64 %3, i64 %2, i64 %head)
  tail call void @rt_leave(ptr %0)
  %guard14 = tail call i64 @rt_enter(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret33

cont16:                                           ; preds = %cont9
  %call20 = tail call fastcc i64 @fold.12(ptr %0, i64 %tail, i64 %call, i64 %3)
  tail call void @rt_leave(ptr %0)
  br label %common.ret33
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

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15, %cont19, %cont22
  %common.ret.op = phi i64 [ %call25, %cont22 ], [ 0, %cont19 ], [ 0, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
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
  %cons16 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard17 = tail call i64 @rt_faulted(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont15
  %guard20 = tail call i64 @rt_enter(ptr %0)
  %trip21.not = icmp eq i64 %guard20, 0
  br i1 %trip21.not, label %cont22, label %common.ret

cont22:                                           ; preds = %cont19
  %call25 = tail call fastcc i64 @fold.12(ptr %0, i64 %call, i64 0, i64 %cons16)
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

define private fastcc i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i49:                                              ; preds = %cont
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %2, i64 %3)
  br label %common.ret

i55:                                              ; preds = %cont
  %head1 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %head1, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i55, %i49, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %i55 ], [ %sadd, %i49 ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i49, label %i55
}

define private fastcc i64 @fold.12(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i67, label %common.ret

i67:                                              ; preds = %prologue
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i67, %cont, %cont6, %cont9, %cont16
  %common.ret.op = phi i64 [ %call20, %cont16 ], [ %2, %prologue ], [ 0, %i67 ], [ 0, %cont9 ], [ 0, %cont6 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i67
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont
  %guard7 = tail call i64 @rt_enter(ptr %0)
  %trip8.not = icmp eq i64 %guard7, 0
  br i1 %trip8.not, label %cont9, label %common.ret

cont9:                                            ; preds = %cont6
  %call = tail call fastcc i64 @"$apply2.8"(ptr %0, i64 %3, i64 %2, i64 %head)
  tail call void @rt_leave(ptr %0)
  %guard14 = tail call i64 @rt_enter(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont9
  %call20 = tail call fastcc i64 @fold.12(ptr %0, i64 %tail, i64 %call, i64 %3)
  tail call void @rt_leave(ptr %0)
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

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15, %cont19, %cont22
  %common.ret.op = phi i64 [ %call25, %cont22 ], [ 0, %cont19 ], [ 0, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
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
  %cons16 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard17 = tail call i64 @rt_faulted(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont15
  %guard20 = tail call i64 @rt_enter(ptr %0)
  %trip21.not = icmp eq i64 %guard20, 0
  br i1 %trip21.not, label %cont22, label %common.ret

cont22:                                           ; preds = %cont19
  %call25 = tail call fastcc i64 @fold.12(ptr %0, i64 %call, i64 0, i64 %cons16)
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

define private fastcc i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i49:                                              ; preds = %cont
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %2, i64 %3)
  br label %common.ret

i55:                                              ; preds = %cont
  %head1 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %head1, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i55, %i49, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %i55 ], [ %sadd, %i49 ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i49, label %i55
}

define private fastcc i64 @fold.12(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i67, label %common.ret

i67:                                              ; preds = %prologue
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i67, %cont, %cont6, %cont9, %cont16
  %common.ret.op = phi i64 [ %call20, %cont16 ], [ %2, %prologue ], [ 0, %i67 ], [ 0, %cont9 ], [ 0, %cont6 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i67
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont
  %guard7 = tail call i64 @rt_enter(ptr %0)
  %trip8.not = icmp eq i64 %guard7, 0
  br i1 %trip8.not, label %cont9, label %common.ret

cont9:                                            ; preds = %cont6
  %call = tail call fastcc i64 @"$apply2.8"(ptr %0, i64 %3, i64 %2, i64 %head)
  tail call void @rt_leave(ptr %0)
  %guard14 = tail call i64 @rt_enter(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont9
  %call20 = tail call fastcc i64 @fold.12(ptr %0, i64 %tail, i64 %call, i64 %3)
  tail call void @rt_leave(ptr %0)
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

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15, %cont19, %cont22
  %common.ret.op = phi i64 [ %call25, %cont22 ], [ 0, %cont19 ], [ 0, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
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
  %cons16 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard17 = tail call i64 @rt_faulted(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont15
  %guard20 = tail call i64 @rt_enter(ptr %0)
  %trip21.not = icmp eq i64 %guard20, 0
  br i1 %trip21.not, label %cont22, label %common.ret

cont22:                                           ; preds = %cont19
  %call25 = tail call fastcc i64 @fold.12(ptr %0, i64 %call, i64 0, i64 %cons16)
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

; Function Attrs: optsize
define private fastcc i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr #1 {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i49:                                              ; preds = %cont
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %2, i64 %3)
  br label %common.ret

i55:                                              ; preds = %cont
  %head1 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %head1, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i55, %i49, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %i55 ], [ %sadd, %i49 ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i49, label %i55
}

; Function Attrs: optsize
define private fastcc i64 @fold.12(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr #1 {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i67, label %common.ret

i67:                                              ; preds = %prologue
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i67, %cont, %cont6, %cont9, %cont16
  %common.ret.op = phi i64 [ %call20, %cont16 ], [ %2, %prologue ], [ 0, %i67 ], [ 0, %cont9 ], [ 0, %cont6 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i67
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont
  %guard7 = tail call i64 @rt_enter(ptr %0)
  %trip8.not = icmp eq i64 %guard7, 0
  br i1 %trip8.not, label %cont9, label %common.ret

cont9:                                            ; preds = %cont6
  %call = tail call fastcc i64 @"$apply2.8"(ptr %0, i64 %3, i64 %2, i64 %head)
  tail call void @rt_leave(ptr %0)
  %guard14 = tail call i64 @rt_enter(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont9
  %call20 = tail call fastcc i64 @fold.12(ptr %0, i64 %tail, i64 %call, i64 %3)
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

common.ret:                                       ; preds = %prologue, %cont, %cont4, %cont8, %cont12, %cont15, %cont19, %cont22
  %common.ret.op = phi i64 [ %call25, %cont22 ], [ 0, %cont19 ], [ 0, %cont15 ], [ 0, %cont12 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %prologue ]
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
  %cons16 = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard17 = tail call i64 @rt_faulted(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont15
  %guard20 = tail call i64 @rt_enter(ptr %0)
  %trip21.not = icmp eq i64 %guard20, 0
  br i1 %trip21.not, label %cont22, label %common.ret

cont22:                                           ; preds = %cont19
  %call25 = tail call fastcc i64 @fold.12(ptr %0, i64 %call, i64 0, i64 %cons16)
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

; Function Attrs: minsize optsize
define private fastcc i64 @fold.12(ptr %0, i64 %1, i64 %2, i64 %3) unnamed_addr #1 {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i67, label %common.ret

i67:                                              ; preds = %prologue
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i67, %cont, %cont6, %"$apply2.8.exit", %cont16
  %common.ret.op = phi i64 [ %call20, %cont16 ], [ %2, %prologue ], [ 0, %i67 ], [ 0, %"$apply2.8.exit" ], [ 0, %cont6 ], [ 0, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i67
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont
  %guard7 = tail call i64 @rt_enter(ptr %0)
  %trip8.not = icmp eq i64 %guard7, 0
  br i1 %trip8.not, label %cont9, label %common.ret

cont9:                                            ; preds = %cont6
  %head.i = tail call i64 @rt_head(ptr %0, i64 %3)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply2.8.exit"

i49.i:                                            ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %2, i64 %head)
  br label %"$apply2.8.exit"

i55.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply2.8.exit"

cont.i:                                           ; preds = %cont9
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i49.i, label %i55.i

"$apply2.8.exit":                                 ; preds = %cont9, %i49.i, %i55.i
  %common.ret.op.i = phi i64 [ 0, %cont9 ], [ %spec.select.i, %i55.i ], [ %sadd.i, %i49.i ]
  tail call void @rt_leave(ptr %0)
  %guard14 = tail call i64 @rt_enter(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %"$apply2.8.exit"
  %call20 = tail call fastcc i64 @fold.12(ptr %0, i64 %tail, i64 %common.ret.op.i, i64 %3)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
