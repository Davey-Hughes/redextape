;; first-order-44
;; source:
;;   fn nil(x) { x + 1 } fn ap(g, x) { g(x) } fn add1(y) { y + 1 } nil(1) + ap(add1, 2)
;; ==== built: O0 O1 O2 O3 ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64)

declare i64 @rt_head(ptr, i64)

declare i64 @rt_tail(ptr, i64)

declare i64 @rt_is_empty(ptr, i64)

declare i64 @rt_box(ptr, i64)

declare i64 @rt_box_get(ptr, i64)

declare void @rt_box_set(ptr, i64, i64)

declare i64 @rt_tick(ptr)

declare i64 @rt_enter(ptr)

declare void @rt_leave(ptr)

declare i64 @rt_faulted(ptr)

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i64, i1 } @llvm.umul.with.overflow.i64(i64, i64) #0

define i64 @"$main"(ptr %0) {
prologue:
  %a0 = alloca i64, align 8
  store i64 0, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 0, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i22

i22:                                              ; preds = %i6
  br label %i31

i31:                                              ; preds = %i22
  store i64 1, ptr %r1, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i34:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i35

i35:                                              ; preds = %i34
  store i64 0, ptr %r5, align 8
  br label %i36

i36:                                              ; preds = %i35
  store i64 0, ptr %r6, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r5.v, i64 %r6.v)
  store i64 %cons, ptr %r3, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i38:                                              ; preds = %cont3
  store i64 2, ptr %r4, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i41

i41:                                              ; preds = %i40
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i42:                                              ; preds = %cont6
  %rr.v9 = load i64, ptr %rr, align 8
  store i64 %rr.v9, ptr %r2, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r0.v = load i64, ptr %r0, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i44

i44:                                              ; preds = %i43
  %rr.v10 = load i64, ptr %rr, align 8
  ret i64 %rr.v10

exit:                                             ; preds = %i41, %i37, %i33
  ret i64 0

cont:                                             ; preds = %i33
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @nil.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34

cont3:                                            ; preds = %i37
  br label %i38

cont6:                                            ; preds = %i41
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call8 = call i64 @ap.6(ptr %0, i64 %a0.v7, i64 %a1.v)
  store i64 %call8, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i42
}

define private i64 @nil.0(ptr %0, i64 %1) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 1, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i5

i5:                                               ; preds = %i4
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

define private i64 @"$apply1.2"(ptr %0, i64 %1, i64 %2) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %r7 = alloca i64, align 8
  store i64 0, ptr %r7, align 8
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i7

i7:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i8

i8:                                               ; preds = %i7
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i10

i10:                                              ; preds = %i9
  %r4.v = load i64, ptr %r4, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r4.v)
  store i64 %head, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i11:                                              ; preds = %cont
  store i64 0, ptr %r5, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r3.v = load i64, ptr %r3, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cmp = icmp eq i64 %r3.v, %r5.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i19, label %i14

i14:                                              ; preds = %i13
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r7, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 1, ptr %r8, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  br label %i21

i19:                                              ; preds = %i13
  store i64 0, ptr %r9, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r9.v = load i64, ptr %r9, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i21:                                              ; preds = %cont4, %i18
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i20, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont4:                                            ; preds = %i20
  br label %i21
}

define private i64 @ap.6(ptr %0, i64 %1, i64 %2) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i24

i24:                                              ; preds = %i23
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i27

i27:                                              ; preds = %i26
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i29
  ret i64 0

cont:                                             ; preds = %i29
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
;; ==== built: Os ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64)

declare i64 @rt_head(ptr, i64)

declare i64 @rt_tail(ptr, i64)

declare i64 @rt_is_empty(ptr, i64)

declare i64 @rt_box(ptr, i64)

declare i64 @rt_box_get(ptr, i64)

declare void @rt_box_set(ptr, i64, i64)

declare i64 @rt_tick(ptr)

declare i64 @rt_enter(ptr)

declare void @rt_leave(ptr)

declare i64 @rt_faulted(ptr)

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i64, i1 } @llvm.umul.with.overflow.i64(i64, i64) #0

; Function Attrs: optsize
define i64 @"$main"(ptr %0) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 0, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 0, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i22

i22:                                              ; preds = %i6
  br label %i31

i31:                                              ; preds = %i22
  store i64 1, ptr %r1, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i34:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i35

i35:                                              ; preds = %i34
  store i64 0, ptr %r5, align 8
  br label %i36

i36:                                              ; preds = %i35
  store i64 0, ptr %r6, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r5.v, i64 %r6.v)
  store i64 %cons, ptr %r3, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i38:                                              ; preds = %cont3
  store i64 2, ptr %r4, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i41

i41:                                              ; preds = %i40
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i42:                                              ; preds = %cont6
  %rr.v9 = load i64, ptr %rr, align 8
  store i64 %rr.v9, ptr %r2, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r0.v = load i64, ptr %r0, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i44

i44:                                              ; preds = %i43
  %rr.v10 = load i64, ptr %rr, align 8
  ret i64 %rr.v10

exit:                                             ; preds = %i41, %i37, %i33
  ret i64 0

cont:                                             ; preds = %i33
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @nil.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34

cont3:                                            ; preds = %i37
  br label %i38

cont6:                                            ; preds = %i41
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call8 = call i64 @ap.6(ptr %0, i64 %a0.v7, i64 %a1.v)
  store i64 %call8, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i42
}

; Function Attrs: optsize
define private i64 @nil.0(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 1, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i5

i5:                                               ; preds = %i4
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

; Function Attrs: optsize
define private i64 @"$apply1.2"(ptr %0, i64 %1, i64 %2) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %r7 = alloca i64, align 8
  store i64 0, ptr %r7, align 8
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i7

i7:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i8

i8:                                               ; preds = %i7
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i10

i10:                                              ; preds = %i9
  %r4.v = load i64, ptr %r4, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r4.v)
  store i64 %head, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i11:                                              ; preds = %cont
  store i64 0, ptr %r5, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r3.v = load i64, ptr %r3, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cmp = icmp eq i64 %r3.v, %r5.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i19, label %i14

i14:                                              ; preds = %i13
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r7, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 1, ptr %r8, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  br label %i21

i19:                                              ; preds = %i13
  store i64 0, ptr %r9, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r9.v = load i64, ptr %r9, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i21:                                              ; preds = %cont4, %i18
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i20, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont4:                                            ; preds = %i20
  br label %i21
}

; Function Attrs: optsize
define private i64 @ap.6(ptr %0, i64 %1, i64 %2) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i24

i24:                                              ; preds = %i23
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i27

i27:                                              ; preds = %i26
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i29
  ret i64 0

cont:                                             ; preds = %i29
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { optsize }
;; ==== built: Oz ====
; ModuleID = 'redextape'
source_filename = "redextape"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

declare i64 @rt_cons(ptr, i64, i64)

declare i64 @rt_head(ptr, i64)

declare i64 @rt_tail(ptr, i64)

declare i64 @rt_is_empty(ptr, i64)

declare i64 @rt_box(ptr, i64)

declare i64 @rt_box_get(ptr, i64)

declare void @rt_box_set(ptr, i64, i64)

declare i64 @rt_tick(ptr)

declare i64 @rt_enter(ptr)

declare void @rt_leave(ptr)

declare i64 @rt_faulted(ptr)

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.uadd.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare i64 @llvm.usub.sat.i64(i64, i64) #0

; Function Attrs: nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none)
declare { i64, i1 } @llvm.umul.with.overflow.i64(i64, i64) #0

; Function Attrs: minsize optsize
define i64 @"$main"(ptr %0) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 0, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 0, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i22

i22:                                              ; preds = %i6
  br label %i31

i31:                                              ; preds = %i22
  store i64 1, ptr %r1, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i34:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i35

i35:                                              ; preds = %i34
  store i64 0, ptr %r5, align 8
  br label %i36

i36:                                              ; preds = %i35
  store i64 0, ptr %r6, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r5.v, i64 %r6.v)
  store i64 %cons, ptr %r3, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i38:                                              ; preds = %cont3
  store i64 2, ptr %r4, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i41

i41:                                              ; preds = %i40
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i42:                                              ; preds = %cont6
  %rr.v9 = load i64, ptr %rr, align 8
  store i64 %rr.v9, ptr %r2, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r0.v = load i64, ptr %r0, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i44

i44:                                              ; preds = %i43
  %rr.v10 = load i64, ptr %rr, align 8
  ret i64 %rr.v10

exit:                                             ; preds = %i41, %i37, %i33
  ret i64 0

cont:                                             ; preds = %i33
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @nil.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34

cont3:                                            ; preds = %i37
  br label %i38

cont6:                                            ; preds = %i41
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call8 = call i64 @ap.6(ptr %0, i64 %a0.v7, i64 %a1.v)
  store i64 %call8, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i42
}

; Function Attrs: minsize optsize
define private i64 @nil.0(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 1, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r2.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i5

i5:                                               ; preds = %i4
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

; Function Attrs: minsize optsize
define private i64 @"$apply1.2"(ptr %0, i64 %1, i64 %2) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %r4 = alloca i64, align 8
  store i64 0, ptr %r4, align 8
  %r5 = alloca i64, align 8
  store i64 0, ptr %r5, align 8
  %r6 = alloca i64, align 8
  store i64 0, ptr %r6, align 8
  %r7 = alloca i64, align 8
  store i64 0, ptr %r7, align 8
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i7

i7:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i8

i8:                                               ; preds = %i7
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i10

i10:                                              ; preds = %i9
  %r4.v = load i64, ptr %r4, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r4.v)
  store i64 %head, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i11:                                              ; preds = %cont
  store i64 0, ptr %r5, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r3.v = load i64, ptr %r3, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cmp = icmp eq i64 %r3.v, %r5.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i19, label %i14

i14:                                              ; preds = %i13
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r7, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 1, ptr %r8, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  br label %i21

i19:                                              ; preds = %i13
  store i64 0, ptr %r9, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r9.v = load i64, ptr %r9, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i21:                                              ; preds = %cont4, %i18
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i20, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont4:                                            ; preds = %i20
  br label %i21
}

; Function Attrs: minsize optsize
define private i64 @ap.6(ptr %0, i64 %1, i64 %2) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %r1 = alloca i64, align 8
  store i64 0, ptr %r1, align 8
  %r2 = alloca i64, align 8
  store i64 0, ptr %r2, align 8
  %r3 = alloca i64, align 8
  store i64 0, ptr %r3, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i24

i24:                                              ; preds = %i23
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i27

i27:                                              ; preds = %i26
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i29
  ret i64 0

cont:                                             ; preds = %i29
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
