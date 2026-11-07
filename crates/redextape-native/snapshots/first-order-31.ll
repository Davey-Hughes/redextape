;; first-order-31
;; source:
;;   fn s0(n){ if n == 0 { 0 } else { 1 + s1(n - 1) } } fn s1(n){ if n == 0 { 0 } else { 2 + s2(n - 1) } } fn s2(n){ if n == 0 { 0 } else { 4 + s0(n - 1) } } s0(4)
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
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i49

i49:                                              ; preds = %i0
  store i64 4, ptr %r0, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i51

i51:                                              ; preds = %i50
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i52:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i51
  ret i64 0

cont:                                             ; preds = %i51
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @s0.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i52
}

define private i64 @s0.0(ptr %0, i64 %1) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %r3, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i8, label %i6

i6:                                               ; preds = %i5
  store i64 0, ptr %rr, align 8
  br label %i7

i7:                                               ; preds = %i6
  br label %i16

i8:                                               ; preds = %i5
  store i64 1, ptr %r4, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i10

i10:                                              ; preds = %i9
  store i64 1, ptr %r8, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i13

i13:                                              ; preds = %i12
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i14:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15, %i7
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i13
  ret i64 0

cont:                                             ; preds = %i13
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s1.1(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i14
}

define private i64 @s1.1(ptr %0, i64 %1) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i17

i17:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i19

i19:                                              ; preds = %i18
  store i64 0, ptr %r3, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i24, label %i22

i22:                                              ; preds = %i21
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %i22
  br label %i32

i24:                                              ; preds = %i21
  store i64 2, ptr %r4, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i26

i26:                                              ; preds = %i25
  store i64 1, ptr %r8, align 8
  br label %i27

i27:                                              ; preds = %i26
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i32

i32:                                              ; preds = %i31, %i23
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i29
  ret i64 0

cont:                                             ; preds = %i29
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s2.2(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30
}

define private i64 @s2.2(ptr %0, i64 %1) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i33

i33:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i35

i35:                                              ; preds = %i34
  store i64 0, ptr %r3, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i40, label %i38

i38:                                              ; preds = %i37
  store i64 0, ptr %rr, align 8
  br label %i39

i39:                                              ; preds = %i38
  br label %i48

i40:                                              ; preds = %i37
  store i64 4, ptr %r4, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 1, ptr %r8, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i45

i45:                                              ; preds = %i44
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i48

i48:                                              ; preds = %i47, %i39
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i45
  ret i64 0

cont:                                             ; preds = %i45
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s0.0(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i46
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
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i49

i49:                                              ; preds = %i0
  store i64 4, ptr %r0, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i51

i51:                                              ; preds = %i50
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i52:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i51
  ret i64 0

cont:                                             ; preds = %i51
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @s0.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i52
}

; Function Attrs: optsize
define private i64 @s0.0(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %r3, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i8, label %i6

i6:                                               ; preds = %i5
  store i64 0, ptr %rr, align 8
  br label %i7

i7:                                               ; preds = %i6
  br label %i16

i8:                                               ; preds = %i5
  store i64 1, ptr %r4, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i10

i10:                                              ; preds = %i9
  store i64 1, ptr %r8, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i13

i13:                                              ; preds = %i12
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i14:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15, %i7
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i13
  ret i64 0

cont:                                             ; preds = %i13
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s1.1(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i14
}

; Function Attrs: optsize
define private i64 @s1.1(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i17

i17:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i19

i19:                                              ; preds = %i18
  store i64 0, ptr %r3, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i24, label %i22

i22:                                              ; preds = %i21
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %i22
  br label %i32

i24:                                              ; preds = %i21
  store i64 2, ptr %r4, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i26

i26:                                              ; preds = %i25
  store i64 1, ptr %r8, align 8
  br label %i27

i27:                                              ; preds = %i26
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i32

i32:                                              ; preds = %i31, %i23
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i29
  ret i64 0

cont:                                             ; preds = %i29
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s2.2(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30
}

; Function Attrs: optsize
define private i64 @s2.2(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i33

i33:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i35

i35:                                              ; preds = %i34
  store i64 0, ptr %r3, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i40, label %i38

i38:                                              ; preds = %i37
  store i64 0, ptr %rr, align 8
  br label %i39

i39:                                              ; preds = %i38
  br label %i48

i40:                                              ; preds = %i37
  store i64 4, ptr %r4, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 1, ptr %r8, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i45

i45:                                              ; preds = %i44
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i48

i48:                                              ; preds = %i47, %i39
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i45
  ret i64 0

cont:                                             ; preds = %i45
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s0.0(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i46
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
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i49

i49:                                              ; preds = %i0
  store i64 4, ptr %r0, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i51

i51:                                              ; preds = %i50
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i52:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i51
  ret i64 0

cont:                                             ; preds = %i51
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @s0.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i52
}

; Function Attrs: minsize optsize
define private i64 @s0.0(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 0, ptr %r3, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i8, label %i6

i6:                                               ; preds = %i5
  store i64 0, ptr %rr, align 8
  br label %i7

i7:                                               ; preds = %i6
  br label %i16

i8:                                               ; preds = %i5
  store i64 1, ptr %r4, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i10

i10:                                              ; preds = %i9
  store i64 1, ptr %r8, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i13

i13:                                              ; preds = %i12
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i14:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15, %i7
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i13
  ret i64 0

cont:                                             ; preds = %i13
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s1.1(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i14
}

; Function Attrs: minsize optsize
define private i64 @s1.1(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i17

i17:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i19

i19:                                              ; preds = %i18
  store i64 0, ptr %r3, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i24, label %i22

i22:                                              ; preds = %i21
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %i22
  br label %i32

i24:                                              ; preds = %i21
  store i64 2, ptr %r4, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i26

i26:                                              ; preds = %i25
  store i64 1, ptr %r8, align 8
  br label %i27

i27:                                              ; preds = %i26
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i32

i32:                                              ; preds = %i31, %i23
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i29
  ret i64 0

cont:                                             ; preds = %i29
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s2.2(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30
}

; Function Attrs: minsize optsize
define private i64 @s2.2(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i33

i33:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i35

i35:                                              ; preds = %i34
  store i64 0, ptr %r3, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i40, label %i38

i38:                                              ; preds = %i37
  store i64 0, ptr %rr, align 8
  br label %i39

i39:                                              ; preds = %i38
  br label %i48

i40:                                              ; preds = %i37
  store i64 4, ptr %r4, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 1, ptr %r8, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %ssub, ptr %r6, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i45

i45:                                              ; preds = %i44
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r5, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r4.v, i64 %r5.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i48

i48:                                              ; preds = %i47, %i39
  %rr.v3 = load i64, ptr %rr, align 8
  ret i64 %rr.v3

exit:                                             ; preds = %i45
  ret i64 0

cont:                                             ; preds = %i45
  %a0.v2 = load i64, ptr %a0, align 8
  %call = call i64 @s0.0(ptr %0, i64 %a0.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i46
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
