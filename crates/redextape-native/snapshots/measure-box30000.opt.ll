;; measure-box30000
;; source:
;;   fn build(n) { if n == 0 { 0 } else { let mut v = n; let get = |x| v + x; v = v + 1; get(0) + build(n - 1) } } build(30000)
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.4(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @"$apply1.0"(ptr %0, i64 %1) unnamed_addr {
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

i18:                                              ; preds = %cont
  %head12 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont8, %i18
  %head12.sink = phi i64 [ %head12, %i18 ], [ %boxget, %cont8 ]
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  %spec.select17 = select i1 %trip14.not, i64 %head12.sink, i64 0
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %cont4 ], [ 0, %i8 ], [ %spec.select17, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i18

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

define private fastcc i64 @build.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret38, label %i29

i29:                                              ; preds = %prologue
  %box = tail call i64 @rt_box(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret38

common.ret38:                                     ; preds = %cont19, %cont16, %cont13, %cont8, %cont4, %cont, %i29, %prologue, %cont24
  %common.ret38.op = phi i64 [ %sadd28, %cont24 ], [ 0, %prologue ], [ 0, %i29 ], [ 0, %cont ], [ 0, %cont4 ], [ 0, %cont8 ], [ 0, %cont13 ], [ 0, %cont16 ], [ 0, %cont19 ]
  ret i64 %common.ret38.op

cont:                                             ; preds = %i29
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret38

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret38

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret38

cont13:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %box, i64 %sadd)
  %guard14 = tail call i64 @rt_faulted(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret38

cont16:                                           ; preds = %cont13
  %guard17 = tail call i64 @rt_enter(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret38

cont19:                                           ; preds = %cont16
  %call = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %cons5)
  tail call void @rt_leave(ptr %0)
  %guard22 = tail call i64 @rt_enter(ptr %0)
  %trip23.not = icmp eq i64 %guard22, 0
  br i1 %trip23.not, label %cont24, label %common.ret38

cont24:                                           ; preds = %cont19
  %ssub = tail call i64 @llvm.usub.sat.i64(i64 %1, i64 1)
  %call26 = tail call fastcc i64 @build.4(ptr %0, i64 %ssub)
  tail call void @rt_leave(ptr %0)
  %sadd28 = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call26)
  br label %common.ret38
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.4(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @"$apply1.0"(ptr %0, i64 %1) unnamed_addr {
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

i18:                                              ; preds = %cont
  %head12 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont8, %i18
  %head12.sink = phi i64 [ %head12, %i18 ], [ %boxget, %cont8 ]
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  %spec.select17 = select i1 %trip14.not, i64 %head12.sink, i64 0
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %cont4 ], [ 0, %i8 ], [ %spec.select17, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i18

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

define private fastcc i64 @build.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i29

i29:                                              ; preds = %prologue
  %box = tail call i64 @rt_box(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i29, %cont, %cont4, %cont8, %cont13, %cont16, %cont19, %cont24
  %common.ret.op = phi i64 [ %sadd28, %cont24 ], [ 0, %cont19 ], [ 0, %cont16 ], [ 0, %cont13 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %i29 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i29
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %box, i64 %sadd)
  %guard14 = tail call i64 @rt_faulted(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont13
  %guard17 = tail call i64 @rt_enter(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont16
  %call = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %cons5)
  tail call void @rt_leave(ptr %0)
  %guard22 = tail call i64 @rt_enter(ptr %0)
  %trip23.not = icmp eq i64 %guard22, 0
  br i1 %trip23.not, label %cont24, label %common.ret

cont24:                                           ; preds = %cont19
  %ssub38 = add i64 %1, -1
  %call26 = tail call fastcc i64 @build.4(ptr %0, i64 %ssub38)
  tail call void @rt_leave(ptr %0)
  %sadd28 = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call26)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.4(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @"$apply1.0"(ptr %0, i64 %1) unnamed_addr {
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

i18:                                              ; preds = %cont
  %head12 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont8, %i18
  %head12.sink = phi i64 [ %head12, %i18 ], [ %boxget, %cont8 ]
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  %spec.select17 = select i1 %trip14.not, i64 %head12.sink, i64 0
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %cont4 ], [ 0, %i8 ], [ %spec.select17, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i18

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

define private fastcc i64 @build.4(ptr %0, i64 %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i29

i29:                                              ; preds = %prologue
  %box = tail call i64 @rt_box(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i29, %cont, %cont4, %cont8, %cont13, %cont16, %cont19, %cont24
  %common.ret.op = phi i64 [ %sadd28, %cont24 ], [ 0, %cont19 ], [ 0, %cont16 ], [ 0, %cont13 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %i29 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i29
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %box, i64 %sadd)
  %guard14 = tail call i64 @rt_faulted(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont13
  %guard17 = tail call i64 @rt_enter(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont16
  %call = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %cons5)
  tail call void @rt_leave(ptr %0)
  %guard22 = tail call i64 @rt_enter(ptr %0)
  %trip23.not = icmp eq i64 %guard22, 0
  br i1 %trip23.not, label %cont24, label %common.ret

cont24:                                           ; preds = %cont19
  %ssub38 = add i64 %1, -1
  %call26 = tail call fastcc i64 @build.4(ptr %0, i64 %ssub38)
  tail call void @rt_leave(ptr %0)
  %sadd28 = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call26)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.4(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @"$apply1.0"(ptr %0, i64 %1) unnamed_addr #1 {
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

i18:                                              ; preds = %cont
  %head12 = tail call i64 @rt_head(ptr %0, i64 0)
  br label %common.ret.sink.split

common.ret.sink.split:                            ; preds = %cont8, %i18
  %head12.sink = phi i64 [ %head12, %i18 ], [ %boxget, %cont8 ]
  %guard13 = tail call i64 @rt_faulted(ptr %0)
  %trip14.not = icmp eq i64 %guard13, 0
  %spec.select17 = select i1 %trip14.not, i64 %head12.sink, i64 0
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %prologue, %i8, %cont4
  %common.ret.op = phi i64 [ 0, %prologue ], [ 0, %cont4 ], [ 0, %i8 ], [ %spec.select17, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %i8, label %i18

cont4:                                            ; preds = %i8
  %head5 = tail call i64 @rt_head(ptr %0, i64 %tail)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %head5)
  br label %common.ret.sink.split
}

; Function Attrs: optsize
define private fastcc i64 @build.4(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i29

i29:                                              ; preds = %prologue
  %box = tail call i64 @rt_box(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i29, %cont, %cont4, %cont8, %cont13, %cont16, %cont19, %cont24
  %common.ret.op = phi i64 [ %sadd28, %cont24 ], [ 0, %cont19 ], [ 0, %cont16 ], [ 0, %cont13 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %i29 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i29
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %box, i64 %sadd)
  %guard14 = tail call i64 @rt_faulted(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont13
  %guard17 = tail call i64 @rt_enter(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont16
  %call = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %cons5)
  tail call void @rt_leave(ptr %0)
  %guard22 = tail call i64 @rt_enter(ptr %0)
  %trip23.not = icmp eq i64 %guard22, 0
  br i1 %trip23.not, label %cont24, label %common.ret

cont24:                                           ; preds = %cont19
  %ssub38 = add i64 %1, -1
  %call26 = tail call fastcc i64 @build.4(ptr %0, i64 %ssub38)
  tail call void @rt_leave(ptr %0)
  %sadd28 = tail call i64 @llvm.uadd.sat.i64(i64 %call, i64 %call26)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont
  %common.ret.op = phi i64 [ %call, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.4(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @build.4(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i29

i29:                                              ; preds = %prologue
  %box = tail call i64 @rt_box(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i29, %cont, %cont4, %cont8, %cont13, %cont16, %"$apply1.0.exit", %cont24
  %common.ret.op = phi i64 [ %sadd28, %cont24 ], [ 0, %"$apply1.0.exit" ], [ 0, %cont16 ], [ 0, %cont13 ], [ 0, %cont8 ], [ 0, %cont4 ], [ 0, %cont ], [ 0, %i29 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i29
  %cons = tail call i64 @rt_cons(ptr %0, i64 %box, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %cons5 = tail call i64 @rt_cons(ptr %0, i64 0, i64 %cons)
  %guard6 = tail call i64 @rt_faulted(ptr %0)
  %trip7.not = icmp eq i64 %guard6, 0
  br i1 %trip7.not, label %cont8, label %common.ret

cont8:                                            ; preds = %cont4
  %boxget = tail call i64 @rt_box_get(ptr %0, i64 %box)
  %guard11 = tail call i64 @rt_faulted(ptr %0)
  %trip12.not = icmp eq i64 %guard11, 0
  br i1 %trip12.not, label %cont13, label %common.ret

cont13:                                           ; preds = %cont8
  %sadd = tail call i64 @llvm.uadd.sat.i64(i64 %boxget, i64 1)
  tail call void @rt_box_set(ptr %0, i64 %box, i64 %sadd)
  %guard14 = tail call i64 @rt_faulted(ptr %0)
  %trip15.not = icmp eq i64 %guard14, 0
  br i1 %trip15.not, label %cont16, label %common.ret

cont16:                                           ; preds = %cont13
  %guard17 = tail call i64 @rt_enter(ptr %0)
  %trip18.not = icmp eq i64 %guard17, 0
  br i1 %trip18.not, label %cont19, label %common.ret

cont19:                                           ; preds = %cont16
  %head.i = tail call i64 @rt_head(ptr %0, i64 %cons5)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.0.exit"

i8.i:                                             ; preds = %cont.i
  %tail.i = tail call i64 @rt_tail(ptr %0, i64 %cons5)
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

cont.i:                                           ; preds = %cont19
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

"$apply1.0.exit":                                 ; preds = %cont19, %i8.i, %common.ret.sink.split.i, %cont4.i
  %common.ret.op.i = phi i64 [ 0, %cont19 ], [ 0, %cont4.i ], [ 0, %i8.i ], [ %spec.select17.i, %common.ret.sink.split.i ]
  tail call void @rt_leave(ptr %0)
  %guard22 = tail call i64 @rt_enter(ptr %0)
  %trip23.not = icmp eq i64 %guard22, 0
  br i1 %trip23.not, label %cont24, label %common.ret

cont24:                                           ; preds = %"$apply1.0.exit"
  %ssub38 = add i64 %1, -1
  %call26 = tail call fastcc i64 @build.4(ptr %0, i64 %ssub38)
  tail call void @rt_leave(ptr %0)
  %sadd28 = tail call i64 @llvm.uadd.sat.i64(i64 %common.ret.op.i, i64 %call26)
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
