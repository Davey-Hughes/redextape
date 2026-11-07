;; first-order-32
;; source:
;;   fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)
;; ==== O1 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ %call, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ev.4(ptr %0, i64 4, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @ev.4(ptr %0, i64 range(i64 0, 5) %1, i64 %2) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %cmp.not, label %i21, label %i27

i21:                                              ; preds = %prologue
  br i1 %trip.not, label %cont, label %common.ret

i27:                                              ; preds = %prologue
  br i1 %trip.not, label %cont7, label %common.ret

common.ret.sink.split:                            ; preds = %i47.i, %i41.i, %od.5.exit.sink.split, %cont.i, %i11.i, %cont
  %common.ret.op.ph = phi i64 [ 1, %cont.i ], [ 0, %cont ], [ %spec.select.i, %i11.i ], [ 0, %i41.i ], [ 0, %i47.i ], [ %common.ret.op.i18.ph, %od.5.exit.sink.split ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %i21, %i27
  %common.ret.op = phi i64 [ 0, %i21 ], [ 0, %i27 ], [ %common.ret.op.ph, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i21
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %common.ret.sink.split

i11.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %common.ret.sink.split

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %common.ret.sink.split, label %i11.i

cont7:                                            ; preds = %i27
  %cmp.not.i17 = icmp eq i64 %1, 1
  %guard.i19 = tail call i64 @rt_enter(ptr %0)
  %trip.not.i20 = icmp eq i64 %guard.i19, 0
  br i1 %cmp.not.i17, label %i41.i, label %i47.i

i41.i:                                            ; preds = %cont7
  br i1 %trip.not.i20, label %cont.i21, label %common.ret.sink.split

i47.i:                                            ; preds = %cont7
  br i1 %trip.not.i20, label %cont7.i, label %common.ret.sink.split

cont.i21:                                         ; preds = %i41.i
  %head.i22 = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i23 = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i24 = icmp ne i64 %guard.i23, 0
  %cmp.not.i27 = icmp eq i64 %head.i22, 0
  %or.cond = select i1 %trip.not.i24, i1 true, i1 %cmp.not.i27
  br i1 %or.cond, label %od.5.exit.sink.split, label %i11.i28

i11.i28:                                          ; preds = %cont.i21
  %head1.i29 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i30 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i31 = icmp eq i64 %guard2.i30, 0
  %spec.select.i32 = select i1 %trip3.not.i31, i64 %head1.i29, i64 0
  br label %od.5.exit.sink.split

cont7.i:                                          ; preds = %i47.i
  %ssub.i = tail call i64 @llvm.usub.sat.i64(i64 %1, i64 2)
  %call10.i = tail call fastcc i64 @ev.4(ptr %0, i64 %ssub.i, i64 %2), !inline_history !0
  br label %od.5.exit.sink.split

od.5.exit.sink.split:                             ; preds = %i11.i28, %cont.i21, %cont7.i
  %common.ret.op.i18.ph = phi i64 [ %call10.i, %cont7.i ], [ 0, %cont.i21 ], [ %spec.select.i32, %i11.i28 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret.sink.split
}

attributes #0 = { mustprogress nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }

!0 = distinct !{null}
;; ==== O2 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ %call, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ev.4(ptr %0, i64 4, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @ev.4(ptr %0, i64 range(i64 0, 5) %1, i64 %2) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %cmp.not, label %i21, label %i27

i21:                                              ; preds = %prologue
  br i1 %trip.not, label %cont, label %common.ret

i27:                                              ; preds = %prologue
  br i1 %trip.not, label %cont7, label %common.ret

common.ret.sink.split:                            ; preds = %i47.i, %i41.i, %od.5.exit.sink.split, %cont.i, %i11.i, %cont
  %common.ret.op.ph = phi i64 [ 1, %cont.i ], [ 0, %cont ], [ %spec.select.i, %i11.i ], [ 0, %i41.i ], [ 0, %i47.i ], [ %common.ret.op.i18.ph, %od.5.exit.sink.split ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %i21, %i27
  %common.ret.op = phi i64 [ 0, %i21 ], [ 0, %i27 ], [ %common.ret.op.ph, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i21
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %common.ret.sink.split

i11.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %common.ret.sink.split

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %common.ret.sink.split, label %i11.i

cont7:                                            ; preds = %i27
  %cmp.not.i17 = icmp eq i64 %1, 1
  %guard.i19 = tail call i64 @rt_enter(ptr %0)
  %trip.not.i20 = icmp eq i64 %guard.i19, 0
  br i1 %cmp.not.i17, label %i41.i, label %i47.i

i41.i:                                            ; preds = %cont7
  br i1 %trip.not.i20, label %cont.i21, label %common.ret.sink.split

i47.i:                                            ; preds = %cont7
  br i1 %trip.not.i20, label %cont7.i, label %common.ret.sink.split

cont.i21:                                         ; preds = %i41.i
  %head.i22 = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i23 = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i24 = icmp ne i64 %guard.i23, 0
  %cmp.not.i27 = icmp eq i64 %head.i22, 0
  %or.cond = select i1 %trip.not.i24, i1 true, i1 %cmp.not.i27
  br i1 %or.cond, label %od.5.exit.sink.split, label %i11.i28

i11.i28:                                          ; preds = %cont.i21
  %head1.i29 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i30 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i31 = icmp eq i64 %guard2.i30, 0
  %spec.select.i32 = select i1 %trip3.not.i31, i64 %head1.i29, i64 0
  br label %od.5.exit.sink.split

cont7.i:                                          ; preds = %i47.i
  %ssub.i35 = add nsw i64 %1, -2
  %call10.i = tail call fastcc i64 @ev.4(ptr %0, i64 %ssub.i35, i64 %2), !inline_history !0
  br label %od.5.exit.sink.split

od.5.exit.sink.split:                             ; preds = %i11.i28, %cont.i21, %cont7.i
  %common.ret.op.i18.ph = phi i64 [ %call10.i, %cont7.i ], [ 0, %cont.i21 ], [ %spec.select.i32, %i11.i28 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret.sink.split
}

!0 = distinct !{null}
;; ==== O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

define i64 @"$main"(ptr %0) local_unnamed_addr {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ %call, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ev.4(ptr %0, i64 4, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

define private fastcc i64 @ev.4(ptr %0, i64 range(i64 0, 5) %1, i64 %2) unnamed_addr {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %cmp.not, label %i21, label %i27

i21:                                              ; preds = %prologue
  br i1 %trip.not, label %cont, label %common.ret

i27:                                              ; preds = %prologue
  br i1 %trip.not, label %cont7, label %common.ret

common.ret.sink.split:                            ; preds = %i47.i, %i41.i, %od.5.exit.sink.split, %cont.i, %i11.i, %cont
  %common.ret.op.ph = phi i64 [ 1, %cont.i ], [ 0, %cont ], [ %spec.select.i, %i11.i ], [ 0, %i41.i ], [ 0, %i47.i ], [ %common.ret.op.i18.ph, %od.5.exit.sink.split ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %i21, %i27
  %common.ret.op = phi i64 [ 0, %i21 ], [ 0, %i27 ], [ %common.ret.op.ph, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i21
  %head.i = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %trip.not.i, label %cont.i, label %common.ret.sink.split

i11.i:                                            ; preds = %cont.i
  %head1.i = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i = icmp eq i64 %guard2.i, 0
  %spec.select.i = select i1 %trip3.not.i, i64 %head1.i, i64 0
  br label %common.ret.sink.split

cont.i:                                           ; preds = %cont
  %cmp.not.i = icmp eq i64 %head.i, 0
  br i1 %cmp.not.i, label %common.ret.sink.split, label %i11.i

cont7:                                            ; preds = %i27
  %cmp.not.i17 = icmp eq i64 %1, 1
  %guard.i19 = tail call i64 @rt_enter(ptr %0)
  %trip.not.i20 = icmp eq i64 %guard.i19, 0
  br i1 %cmp.not.i17, label %i41.i, label %i47.i

i41.i:                                            ; preds = %cont7
  br i1 %trip.not.i20, label %cont.i21, label %common.ret.sink.split

i47.i:                                            ; preds = %cont7
  br i1 %trip.not.i20, label %cont7.i, label %common.ret.sink.split

cont.i21:                                         ; preds = %i41.i
  %head.i22 = tail call i64 @rt_head(ptr %0, i64 %2)
  %guard.i23 = tail call i64 @rt_faulted(ptr %0)
  %trip.not.i24 = icmp ne i64 %guard.i23, 0
  %cmp.not.i27 = icmp eq i64 %head.i22, 0
  %or.cond = select i1 %trip.not.i24, i1 true, i1 %cmp.not.i27
  br i1 %or.cond, label %od.5.exit.sink.split, label %i11.i28

i11.i28:                                          ; preds = %cont.i21
  %head1.i29 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2.i30 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not.i31 = icmp eq i64 %guard2.i30, 0
  %spec.select.i32 = select i1 %trip3.not.i31, i64 %head1.i29, i64 0
  br label %od.5.exit.sink.split

cont7.i:                                          ; preds = %i47.i
  %ssub.i35 = add nsw i64 %1, -2
  %call10.i = tail call fastcc i64 @ev.4(ptr %0, i64 %ssub.i35, i64 %2), !inline_history !0
  br label %od.5.exit.sink.split

od.5.exit.sink.split:                             ; preds = %i11.i28, %cont.i21, %cont7.i
  %common.ret.op.i18.ph = phi i64 [ %call10.i, %cont7.i ], [ 0, %cont.i21 ], [ %spec.select.i32, %i11.i28 ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret.sink.split
}

!0 = distinct !{null}
;; ==== Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ %call, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ev.4(ptr %0, i64 4, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: optsize
define private fastcc i64 @"$apply1.0"(ptr %0, i64 %1, i64 range(i64 0, 2) %2) unnamed_addr #0 {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i11:                                              ; preds = %cont
  %head1 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %head1, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i11, %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %i11 ], [ %2, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %common.ret, label %i11
}

; Function Attrs: optsize
define private fastcc i64 @ev.4(ptr %0, i64 range(i64 0, 5) %1, i64 %2) unnamed_addr #0 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %cmp.not, label %i21, label %i27

i21:                                              ; preds = %prologue
  br i1 %trip.not, label %cont, label %common.ret

i27:                                              ; preds = %prologue
  br i1 %trip.not, label %cont7, label %common.ret

common.ret.sink.split:                            ; preds = %i47.i, %i41.i, %od.5.exit.sink.split, %cont
  %common.ret.op.ph = phi i64 [ %call, %cont ], [ 0, %i41.i ], [ 0, %i47.i ], [ %common.ret.op.i.ph, %od.5.exit.sink.split ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %i21, %i27
  %common.ret.op = phi i64 [ 0, %i21 ], [ 0, %i27 ], [ %common.ret.op.ph, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i21
  %call = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %2, i64 1)
  br label %common.ret.sink.split

cont7:                                            ; preds = %i27
  %cmp.not.i = icmp eq i64 %1, 1
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %cmp.not.i, label %i41.i, label %i47.i

i41.i:                                            ; preds = %cont7
  br i1 %trip.not.i, label %cont.i, label %common.ret.sink.split

i47.i:                                            ; preds = %cont7
  br i1 %trip.not.i, label %cont7.i, label %common.ret.sink.split

cont.i:                                           ; preds = %i41.i
  %call.i = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %2, i64 0), !inline_history !0
  br label %od.5.exit.sink.split

cont7.i:                                          ; preds = %i47.i
  %ssub.i18 = add nsw i64 %1, -2
  %call10.i = tail call fastcc i64 @ev.4(ptr %0, i64 %ssub.i18, i64 %2), !inline_history !0
  br label %od.5.exit.sink.split

od.5.exit.sink.split:                             ; preds = %cont7.i, %cont.i
  %common.ret.op.i.ph = phi i64 [ %call.i, %cont.i ], [ %call10.i, %cont7.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret.sink.split
}

attributes #0 = { optsize }

!0 = distinct !{null}
;; ==== Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64) local_unnamed_addr

declare i64 @rt_head(ptr, i64) local_unnamed_addr

declare i64 @rt_enter(ptr) local_unnamed_addr

declare void @rt_leave(ptr) local_unnamed_addr

declare i64 @rt_faulted(ptr) local_unnamed_addr

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) local_unnamed_addr #0 {
prologue:
  %cons = tail call i64 @rt_cons(ptr %0, i64 0, i64 0)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

common.ret:                                       ; preds = %prologue, %cont, %cont3
  %common.ret.op = phi i64 [ %call, %cont3 ], [ 0, %cont ], [ 0, %prologue ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %guard1 = tail call i64 @rt_enter(ptr %0)
  %trip2.not = icmp eq i64 %guard1, 0
  br i1 %trip2.not, label %cont3, label %common.ret

cont3:                                            ; preds = %cont
  %call = tail call fastcc i64 @ev.4(ptr %0, i64 4, i64 %cons)
  tail call void @rt_leave(ptr %0)
  br label %common.ret
}

; Function Attrs: minsize optsize
define private fastcc i64 @"$apply1.0"(ptr %0, i64 %1, i64 range(i64 0, 2) %2) unnamed_addr #0 {
prologue:
  %head = tail call i64 @rt_head(ptr %0, i64 %1)
  %guard = tail call i64 @rt_faulted(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %trip.not, label %cont, label %common.ret

i11:                                              ; preds = %cont
  %head1 = tail call i64 @rt_head(ptr %0, i64 0)
  %guard2 = tail call i64 @rt_faulted(ptr %0)
  %trip3.not = icmp eq i64 %guard2, 0
  %spec.select = select i1 %trip3.not, i64 %head1, i64 0
  br label %common.ret

common.ret:                                       ; preds = %i11, %cont, %prologue
  %common.ret.op = phi i64 [ 0, %prologue ], [ %spec.select, %i11 ], [ %2, %cont ]
  ret i64 %common.ret.op

cont:                                             ; preds = %prologue
  %cmp.not = icmp eq i64 %head, 0
  br i1 %cmp.not, label %common.ret, label %i11
}

; Function Attrs: minsize optsize
define private fastcc i64 @ev.4(ptr %0, i64 range(i64 0, 5) %1, i64 %2) unnamed_addr #0 {
prologue:
  %cmp.not = icmp eq i64 %1, 0
  %guard = tail call i64 @rt_enter(ptr %0)
  %trip.not = icmp eq i64 %guard, 0
  br i1 %cmp.not, label %i21, label %i27

i21:                                              ; preds = %prologue
  br i1 %trip.not, label %cont, label %common.ret

i27:                                              ; preds = %prologue
  br i1 %trip.not, label %cont7, label %common.ret

common.ret.sink.split:                            ; preds = %i47.i, %i41.i, %od.5.exit.sink.split, %cont
  %common.ret.op.ph = phi i64 [ %call, %cont ], [ 0, %i41.i ], [ 0, %i47.i ], [ %common.ret.op.i.ph, %od.5.exit.sink.split ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret

common.ret:                                       ; preds = %common.ret.sink.split, %i21, %i27
  %common.ret.op = phi i64 [ 0, %i21 ], [ 0, %i27 ], [ %common.ret.op.ph, %common.ret.sink.split ]
  ret i64 %common.ret.op

cont:                                             ; preds = %i21
  %call = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %2, i64 1)
  br label %common.ret.sink.split

cont7:                                            ; preds = %i27
  %cmp.not.i = icmp eq i64 %1, 1
  %guard.i = tail call i64 @rt_enter(ptr %0)
  %trip.not.i = icmp eq i64 %guard.i, 0
  br i1 %cmp.not.i, label %i41.i, label %i47.i

i41.i:                                            ; preds = %cont7
  br i1 %trip.not.i, label %cont.i, label %common.ret.sink.split

i47.i:                                            ; preds = %cont7
  br i1 %trip.not.i, label %cont7.i, label %common.ret.sink.split

cont.i:                                           ; preds = %i41.i
  %call.i = tail call fastcc i64 @"$apply1.0"(ptr %0, i64 %2, i64 0), !inline_history !0
  br label %od.5.exit.sink.split

cont7.i:                                          ; preds = %i47.i
  %ssub.i18 = add nsw i64 %1, -2
  %call10.i = tail call fastcc i64 @ev.4(ptr %0, i64 %ssub.i18, i64 %2), !inline_history !0
  br label %od.5.exit.sink.split

od.5.exit.sink.split:                             ; preds = %cont7.i, %cont.i
  %common.ret.op.i.ph = phi i64 [ %call.i, %cont.i ], [ %call10.i, %cont7.i ]
  tail call void @rt_leave(ptr %0)
  br label %common.ret.sink.split
}

attributes #0 = { minsize optsize }

!0 = distinct !{null}
