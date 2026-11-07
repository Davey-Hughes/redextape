;; measure-map30000
;; source:
;;   fn build(n){ if n==0 {nil} else { cons(n, build(n-1)) } } fn map(xs,f){ if is_empty(xs){nil}else{cons(f(head(xs)),map(tail(xs),f))} } fn add1(x){x+1} map(build(30000),add1)
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

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call8, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call8 = tail call fastcc i64 @map.8(ptr %0, i64 %call, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @build.0(ptr %0, i64 %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret12, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret12

common.ret12:                                     ; preds = %i8, %prologue, %cont
  %common.ret12.op = phi i64 [ %spec.select, %cont ], [ 0, %prologue ], [ 0, %i8 ]
  ret i64 %common.ret12.op

cont:                                             ; preds = %i8
  %ssub = tail call i64 @llvm.usub.sat.i64(i64 %1, i64 1)
  %call = tail call fastcc i64 @build.0(ptr %0, i64 %ssub)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %1, i64 %call)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  %spec.select = select i1 %trip5.not, i64 %cons, i64 0
  br label %common.ret12
}

define private fastcc i64 @map.8(ptr %0, i64 %1, i64 %2) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i41, label %common.ret32

i41:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret32

common.ret32:                                     ; preds = %cont10, %"$apply1.4.exit", %cont, %i41, %prologue, %cont14
  %common.ret32.op = phi i64 [ %spec.select, %cont14 ], [ 0, %prologue ], [ 0, %i41 ], [ 0, %cont ], [ 0, %"$apply1.4.exit" ], [ 0, %cont10 ]
  ret i64 %common.ret32.op

cont:                                             ; preds = %i41
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret32

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.4.exit"

i25.i:                                            ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.4.exit"

i30.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.4.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i25.i, label %i30.i

"$apply1.4.exit":                                 ; preds = %cont4, %i25.i, %i30.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i30.i ], [ %sadd.i, %i25.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret32

cont10:                                           ; preds = %"$apply1.4.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret32

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.8(ptr %0, i64 %tail, i64 %2)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call8, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call8 = tail call fastcc i64 @map.8(ptr %0, i64 %call, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @build.0(ptr %0, i64 %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %spec.select, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub12 = add i64 %1, -1
  %call = tail call fastcc i64 @build.0(ptr %0, i64 %ssub12)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %1, i64 %call)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  %spec.select = select i1 %trip5.not, i64 %cons, i64 0
  br label %common.ret
}

define private fastcc i64 @map.8(ptr %0, i64 %1, i64 %2) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i41, label %common.ret

i41:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i41, %cont, %"$apply1.4.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.4.exit" ], [ 0, %cont ], [ 0, %i41 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i41
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.4.exit"

i25.i:                                            ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.4.exit"

i30.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.4.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i25.i, label %i30.i

"$apply1.4.exit":                                 ; preds = %cont4, %i25.i, %i30.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i30.i ], [ %sadd.i, %i25.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.4.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.8(ptr %0, i64 %tail, i64 %2)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call8, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call8 = tail call fastcc i64 @map.8(ptr %0, i64 %call, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @build.0(ptr %0, i64 %1) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %spec.select, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub12 = add i64 %1, -1
  %call = tail call fastcc i64 @build.0(ptr %0, i64 %ssub12)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %1, i64 %call)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  %spec.select = select i1 %trip5.not, i64 %cons, i64 0
  br label %common.ret
}

define private fastcc i64 @map.8(ptr %0, i64 %1, i64 %2) unnamed_addr {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i41, label %common.ret

i41:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i41, %cont, %"$apply1.4.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.4.exit" ], [ 0, %cont ], [ 0, %i41 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i41
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.4.exit"

i25.i:                                            ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.4.exit"

i30.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.4.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i25.i, label %i30.i

"$apply1.4.exit":                                 ; preds = %cont4, %i25.i, %i30.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i30.i ], [ %sadd.i, %i25.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.4.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.8(ptr %0, i64 %tail, i64 %2)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call8, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call8 = tail call fastcc i64 @map.8(ptr %0, i64 %call, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @build.0(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %spec.select, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub12 = add i64 %1, -1
  %call = tail call fastcc i64 @build.0(ptr %0, i64 %ssub12)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %1, i64 %call)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  %spec.select = select i1 %trip5.not, i64 %cons, i64 0
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @map.8(ptr %0, i64 %1, i64 %2) unnamed_addr #1 {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i41, label %common.ret

i41:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i41, %cont, %"$apply1.4.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.4.exit" ], [ 0, %cont ], [ 0, %i41 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i41
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.4.exit"

i25.i:                                            ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.4.exit"

i30.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.4.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i25.i, label %i30.i

"$apply1.4.exit":                                 ; preds = %cont4, %i25.i, %i30.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i30.i ], [ %sadd.i, %i25.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.4.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.8(ptr %0, i64 %tail, i64 %2)
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
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3, %cont6
  %common.ret.op = phi i64 [ %call8, %cont6 ], [ 0, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %call = tail call fastcc i64 @build.0(ptr %0, i64 30000)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard1 = tail call i64 @rt_faulted(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %guard4 = tail call i64 @rt_enter(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  br i1 %trip5.not, label %cont6, label %common.ret

cont6:                                            ; preds = %cont3
  %call8 = tail call fastcc i64 @map.8(ptr %0, i64 %call, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @build.0(ptr %0, i64 %1) unnamed_addr #1 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  br i1 %cmp.not, label %common.ret, label %i8

i8:                                               ; preds = %prologue
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i8, %cont
  %common.ret.op = phi i64 [ %spec.select, %cont ], [ 0, %i8 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i8
  %ssub12 = add i64 %1, -1
  %call = tail call fastcc i64 @build.0(ptr %0, i64 %ssub12)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %1, i64 %call)
  %guard4 = tail call i64 @rt_faulted(ptr %0)
  %trip5.not = icmp eq i64 %guard4, 0
  %spec.select = select i1 %trip5.not, i64 %cons, i64 0
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @map.8(ptr %0, i64 %1, i64 %2) unnamed_addr #1 {
prologue:
  %isempty = tail call i64 @rt_is_empty(ptr %0, i64 %1)
  %jz = icmp eq i64 %isempty, 0
  br i1 %jz, label %i41, label %common.ret

i41:                                              ; preds = %prologue
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %i41, %cont, %"$apply1.4.exit", %cont10, %cont14
  %common.ret.op = phi i64 [ %spec.select, %cont14 ], [ 0, %cont10 ], [ 0, %"$apply1.4.exit" ], [ 0, %cont ], [ 0, %i41 ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i41
  %guard2 = tail call i64 @rt_enter(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  br i1 %trip3.not, label %cont4, label %common.ret

cont4:                                            ; preds = %cont
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %"$apply1.4.exit"

i25.i:                                            ; preds = %cont.i
  %sadd.i = tail call i64 @llvm.uadd.sat.i64(i64 %head, i64 1)
  br label %"$apply1.4.exit"

i30.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %"$apply1.4.exit"

cont.i:                                           ; preds = %cont4
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %i25.i, label %i30.i

"$apply1.4.exit":                                 ; preds = %cont4, %i25.i, %i30.i
  %common.ret.op.i = phi i64 [ 0, %cont4 ], [ %spec.select.i, %i30.i ], [ %sadd.i, %i25.i ]
  tail call void @rt_leave(ptr %0)
  %tail = tail call i64 @rt_tail(ptr %0, i64 %1)
  %guard8 = tail call i64 @rt_faulted(ptr %0)
  %trip9.not = icmp eq i64 %guard8, 0
  br i1 %trip9.not, label %cont10, label %common.ret

cont10:                                           ; preds = %"$apply1.4.exit"
  %guard12 = tail call i64 @rt_enter(ptr %0)
  %trip13.not = icmp eq i64 %guard12, 0
  br i1 %trip13.not, label %cont14, label %common.ret

cont14:                                           ; preds = %cont10
  %call17 = tail call fastcc i64 @map.8(ptr %0, i64 %tail, i64 %2)
  tail call void @rt_leave(ptr %0)
  %cons = tail call i64 @rt_cons(ptr %0, i64 %common.ret.op.i, i64 %call17)
  %guard19 = tail call i64 @rt_faulted(ptr %0)
  %trip20.not = icmp eq i64 %guard19, 0
  %spec.select = select i1 %trip20.not, i64 %cons, i64 0
  br label %common.ret
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
