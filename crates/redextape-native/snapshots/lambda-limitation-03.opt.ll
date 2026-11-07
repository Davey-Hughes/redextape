;; lambda-limitation-03
;; source:
;;   let mut c = 0; fn twice(g) { g(0); g(0); } let bump = |x| { c = c + 1; c }; twice(bump); c
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont10, %prologue, %cont, %cont3, %cont7
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ]
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
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  tail call fastcc void @twice.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard12 = tail call i64 @rt_faulted(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  %spec.select = select i1 %trip13.not, i64 %boxget, i64 0
  br label %common.ret
}

define private fastcc void @"$apply1.0"(ptr %0, i64 %1) unnamed_addr {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i8:                                               ; preds = %cont
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

i23:                                              ; preds = %cont
  %head21 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont15, %i23
  %guard22 = tail call i64 @rt_faulted(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4, %cont8, %cont12
  ret void

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i23

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %head5, i64 %sadd)
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %boxget17 = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

define private fastcc void @twice.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont5
  ret void

cont:                                             ; preds = %prologue
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
  tail call void @rt_leave(ptr %0)
  %guard3 = tail call i64 @rt_enter(ptr %0)
  %trip4.not = icmp eq i64 %guard3, 0
  br i1 %trip4.not, label %cont5, label %common.ret

cont5:                                            ; preds = %cont
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
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

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont10, %prologue, %cont, %cont3, %cont7
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ]
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
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  tail call fastcc void @twice.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard12 = tail call i64 @rt_faulted(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  %spec.select = select i1 %trip13.not, i64 %boxget, i64 0
  br label %common.ret
}

define private fastcc void @"$apply1.0"(ptr %0, i64 %1) unnamed_addr {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i8:                                               ; preds = %cont
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

i23:                                              ; preds = %cont
  %head21 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont15, %i23
  %guard22 = tail call i64 @rt_faulted(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4, %cont8, %cont12
  ret void

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i23

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %head5, i64 %sadd)
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %boxget17 = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

define private fastcc void @twice.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont5
  ret void

cont:                                             ; preds = %prologue
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
  tail call void @rt_leave(ptr %0)
  %guard3 = tail call i64 @rt_enter(ptr %0)
  %trip4.not = icmp eq i64 %guard3, 0
  br i1 %trip4.not, label %cont5, label %common.ret

cont5:                                            ; preds = %cont
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
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

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont10, %prologue, %cont, %cont3, %cont7
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ]
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
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  tail call fastcc void @twice.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard12 = tail call i64 @rt_faulted(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  %spec.select = select i1 %trip13.not, i64 %boxget, i64 0
  br label %common.ret
}

define private fastcc void @"$apply1.0"(ptr %0, i64 %1) unnamed_addr {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i8:                                               ; preds = %cont
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

i23:                                              ; preds = %cont
  %head21 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont15, %i23
  %guard22 = tail call i64 @rt_faulted(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4, %cont8, %cont12
  ret void

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i23

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %head5, i64 %sadd)
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %boxget17 = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

define private fastcc void @twice.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont5
  ret void

cont:                                             ; preds = %prologue
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
  tail call void @rt_leave(ptr %0)
  %guard3 = tail call i64 @rt_enter(ptr %0)
  %trip4.not = icmp eq i64 %guard3, 0
  br i1 %trip4.not, label %cont5, label %common.ret

cont5:                                            ; preds = %cont
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
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

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %cont10, %prologue, %cont, %cont3, %cont7
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %cont10 ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ]
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
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  tail call fastcc void @twice.4(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard12 = tail call i64 @rt_faulted(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  %spec.select = select i1 %trip13.not, i64 %boxget, i64 0
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc void @"$apply1.0"(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i8:                                               ; preds = %cont
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

i23:                                              ; preds = %cont
  %head21 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont15, %i23
  %guard22 = tail call i64 @rt_faulted(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4, %cont8, %cont12
  ret void

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i23

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %head5, i64 %sadd)
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %boxget17 = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

; Function Attrs: optsize
define private fastcc void @twice.4(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont5
  ret void

cont:                                             ; preds = %prologue
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
  tail call void @rt_leave(ptr %0)
  %guard3 = tail call i64 @rt_enter(ptr %0)
  %trip4.not = icmp eq i64 %guard3, 0
  br i1 %trip4.not, label %cont5, label %common.ret

cont5:                                            ; preds = %cont
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %1)
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

declare i64 @rt_box(ptr, i64) local_unnamed_addr

declare i64 @rt_box_get(ptr, i64) local_unnamed_addr

declare void @rt_box_set(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #1 {
prologue:
  %box = tail call i64 @rt_box(ptr %0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %twice.4.exit, %prologue, %cont, %cont3, %cont7
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %twice.4.exit ], [ 0, %cont7 ], [ 0, %cont3 ], [ 0, %cont ]
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
  %guard8 = tail call i64 @rt_enter(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %cont7
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %twice.4.exit

cont.i:                                           ; preds = %cont10
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  %guard3.i = tail call i64 @rt_enter(ptr %0)
  %trip4.not.i = icmp eq i64 %guard3.i, 0
  br i1 %trip4.not.i, label %cont5.i, label %twice.4.exit

cont5.i:                                          ; preds = %cont.i
  tail call fastcc void @"$apply1.0"(ptr %0, i64 %cons4)
  tail call void @rt_leave(ptr %0)
  br label %twice.4.exit

twice.4.exit:                                     ; preds = %cont10, %cont.i, %cont5.i
  tail call void @rt_leave(ptr %0)
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard12 = tail call i64 @rt_faulted(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  %spec.select = select i1 %trip13.not, i64 %boxget, i64 0
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc void @"$apply1.0"(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i8:                                               ; preds = %cont
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

i23:                                              ; preds = %cont
  %head21 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont15, %i23
  %guard22 = tail call i64 @rt_faulted(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4, %cont8, %cont12
  ret void

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i23

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  %guard10 = tail call i64 @rt_faulted(ptr %0)
  %trip11.not = icmp eq i64 %guard10, 0
  br i1 %trip11.not, label %cont12, label %common.ret

cont12:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %head5, i64 %sadd)
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  br i1 %trip14.not, label %cont15, label %common.ret

cont15:                                           ; preds = %cont12
  %boxget17 = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
