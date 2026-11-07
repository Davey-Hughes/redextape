;; first-order-32
;; source:
;;   fn ev(n,k){ if n == 0 { k(1) } else { od(n - 1, k) } } fn od(n,k){ if n == 0 { k(0) } else { ev(n - 1, k) } } fn id(x){ x } ev(4, id)
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i14

i14:                                              ; preds = %i0
  br label %i55

i55:                                              ; preds = %i14
  store i64 4, ptr %r0, align 8
  br label %i56

i56:                                              ; preds = %i55
  store i64 0, ptr %r2, align 8
  br label %i57

i57:                                              ; preds = %i56
  store i64 0, ptr %r3, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r2.v, i64 %r3.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i59:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i60

i60:                                              ; preds = %i59
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a1, align 8
  br label %i61

i61:                                              ; preds = %i60
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i62:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i61, %i58
  ret i64 0

cont:                                             ; preds = %i58
  br label %i59

cont3:                                            ; preds = %i61
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ev.4(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i62
}

define private i64 @"$apply1.0"(ptr %0, i64 %1, i64 %2) {
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r4.v = load i64, ptr %r4, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r4.v)
  store i64 %head, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i5:                                               ; preds = %cont
  store i64 0, ptr %r5, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r3.v = load i64, ptr %r3, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cmp = icmp eq i64 %r3.v, %r5.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i7

i7:                                               ; preds = %i6
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i11, label %i8

i8:                                               ; preds = %i7
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %rr, align 8
  br label %i10

i10:                                              ; preds = %i9
  br label %i13

i11:                                              ; preds = %i7
  store i64 0, ptr %r7, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r7.v = load i64, ptr %r7, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r7.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i13:                                              ; preds = %cont4, %i10
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i12, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i12
  br label %i13
}

define private i64 @ev.4(ptr %0, i64 %1, i64 %2) {
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
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i15

i15:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i16

i16:                                              ; preds = %i15
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i18

i18:                                              ; preds = %i17
  store i64 0, ptr %r4, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cmp = icmp eq i64 %r3.v, %r4.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i27, label %i21

i21:                                              ; preds = %i20
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i22

i22:                                              ; preds = %i21
  store i64 1, ptr %r6, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i25

i25:                                              ; preds = %i24
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i26:                                              ; preds = %cont
  br label %i34

i27:                                              ; preds = %i20
  %r0.v3 = load i64, ptr %r0, align 8
  store i64 %r0.v3, ptr %r9, align 8
  br label %i28

i28:                                              ; preds = %i27
  store i64 1, ptr %r10, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r9.v, i64 %r10.v)
  store i64 %ssub, ptr %r7, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r1.v4 = load i64, ptr %r1, align 8
  store i64 %r1.v4, ptr %r8, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i34:                                              ; preds = %cont7, %i26
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i25
  ret i64 0

cont:                                             ; preds = %i25
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i26

cont7:                                            ; preds = %i33
  %a0.v8 = load i64, ptr %a0, align 8
  %a1.v9 = load i64, ptr %a1, align 8
  %call10 = call i64 @od.5(ptr %0, i64 %a0.v8, i64 %a1.v9)
  store i64 %call10, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34
}

define private i64 @od.5(ptr %0, i64 %1, i64 %2) {
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
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i35

i35:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i36

i36:                                              ; preds = %i35
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i38

i38:                                              ; preds = %i37
  store i64 0, ptr %r4, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cmp = icmp eq i64 %r3.v, %r4.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i47, label %i41

i41:                                              ; preds = %i40
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 0, ptr %r6, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i45

i45:                                              ; preds = %i44
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  br label %i54

i47:                                              ; preds = %i40
  %r0.v3 = load i64, ptr %r0, align 8
  store i64 %r0.v3, ptr %r9, align 8
  br label %i48

i48:                                              ; preds = %i47
  store i64 1, ptr %r10, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r9.v, i64 %r10.v)
  store i64 %ssub, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r1.v4 = load i64, ptr %r1, align 8
  store i64 %r1.v4, ptr %r8, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i54:                                              ; preds = %cont7, %i46
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i53, %i45
  ret i64 0

cont:                                             ; preds = %i45
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i46

cont7:                                            ; preds = %i53
  %a0.v8 = load i64, ptr %a0, align 8
  %a1.v9 = load i64, ptr %a1, align 8
  %call10 = call i64 @ev.4(ptr %0, i64 %a0.v8, i64 %a1.v9)
  store i64 %call10, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i14

i14:                                              ; preds = %i0
  br label %i55

i55:                                              ; preds = %i14
  store i64 4, ptr %r0, align 8
  br label %i56

i56:                                              ; preds = %i55
  store i64 0, ptr %r2, align 8
  br label %i57

i57:                                              ; preds = %i56
  store i64 0, ptr %r3, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r2.v, i64 %r3.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i59:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i60

i60:                                              ; preds = %i59
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a1, align 8
  br label %i61

i61:                                              ; preds = %i60
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i62:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i61, %i58
  ret i64 0

cont:                                             ; preds = %i58
  br label %i59

cont3:                                            ; preds = %i61
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ev.4(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i62
}

; Function Attrs: optsize
define private i64 @"$apply1.0"(ptr %0, i64 %1, i64 %2) #1 {
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r4.v = load i64, ptr %r4, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r4.v)
  store i64 %head, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i5:                                               ; preds = %cont
  store i64 0, ptr %r5, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r3.v = load i64, ptr %r3, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cmp = icmp eq i64 %r3.v, %r5.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i7

i7:                                               ; preds = %i6
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i11, label %i8

i8:                                               ; preds = %i7
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %rr, align 8
  br label %i10

i10:                                              ; preds = %i9
  br label %i13

i11:                                              ; preds = %i7
  store i64 0, ptr %r7, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r7.v = load i64, ptr %r7, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r7.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i13:                                              ; preds = %cont4, %i10
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i12, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i12
  br label %i13
}

; Function Attrs: optsize
define private i64 @ev.4(ptr %0, i64 %1, i64 %2) #1 {
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
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i15

i15:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i16

i16:                                              ; preds = %i15
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i18

i18:                                              ; preds = %i17
  store i64 0, ptr %r4, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cmp = icmp eq i64 %r3.v, %r4.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i27, label %i21

i21:                                              ; preds = %i20
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i22

i22:                                              ; preds = %i21
  store i64 1, ptr %r6, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i25

i25:                                              ; preds = %i24
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i26:                                              ; preds = %cont
  br label %i34

i27:                                              ; preds = %i20
  %r0.v3 = load i64, ptr %r0, align 8
  store i64 %r0.v3, ptr %r9, align 8
  br label %i28

i28:                                              ; preds = %i27
  store i64 1, ptr %r10, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r9.v, i64 %r10.v)
  store i64 %ssub, ptr %r7, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r1.v4 = load i64, ptr %r1, align 8
  store i64 %r1.v4, ptr %r8, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i34:                                              ; preds = %cont7, %i26
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i25
  ret i64 0

cont:                                             ; preds = %i25
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i26

cont7:                                            ; preds = %i33
  %a0.v8 = load i64, ptr %a0, align 8
  %a1.v9 = load i64, ptr %a1, align 8
  %call10 = call i64 @od.5(ptr %0, i64 %a0.v8, i64 %a1.v9)
  store i64 %call10, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34
}

; Function Attrs: optsize
define private i64 @od.5(ptr %0, i64 %1, i64 %2) #1 {
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
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i35

i35:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i36

i36:                                              ; preds = %i35
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i38

i38:                                              ; preds = %i37
  store i64 0, ptr %r4, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cmp = icmp eq i64 %r3.v, %r4.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i47, label %i41

i41:                                              ; preds = %i40
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 0, ptr %r6, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i45

i45:                                              ; preds = %i44
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  br label %i54

i47:                                              ; preds = %i40
  %r0.v3 = load i64, ptr %r0, align 8
  store i64 %r0.v3, ptr %r9, align 8
  br label %i48

i48:                                              ; preds = %i47
  store i64 1, ptr %r10, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r9.v, i64 %r10.v)
  store i64 %ssub, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r1.v4 = load i64, ptr %r1, align 8
  store i64 %r1.v4, ptr %r8, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i54:                                              ; preds = %cont7, %i46
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i53, %i45
  ret i64 0

cont:                                             ; preds = %i45
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i46

cont7:                                            ; preds = %i53
  %a0.v8 = load i64, ptr %a0, align 8
  %a1.v9 = load i64, ptr %a1, align 8
  %call10 = call i64 @ev.4(ptr %0, i64 %a0.v8, i64 %a1.v9)
  store i64 %call10, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i14

i14:                                              ; preds = %i0
  br label %i55

i55:                                              ; preds = %i14
  store i64 4, ptr %r0, align 8
  br label %i56

i56:                                              ; preds = %i55
  store i64 0, ptr %r2, align 8
  br label %i57

i57:                                              ; preds = %i56
  store i64 0, ptr %r3, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r2.v, i64 %r3.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i59:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i60

i60:                                              ; preds = %i59
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a1, align 8
  br label %i61

i61:                                              ; preds = %i60
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i62:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i61, %i58
  ret i64 0

cont:                                             ; preds = %i58
  br label %i59

cont3:                                            ; preds = %i61
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ev.4(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i62
}

; Function Attrs: minsize optsize
define private i64 @"$apply1.0"(ptr %0, i64 %1, i64 %2) #1 {
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i1

i1:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i2

i2:                                               ; preds = %i1
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r4.v = load i64, ptr %r4, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r4.v)
  store i64 %head, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i5:                                               ; preds = %cont
  store i64 0, ptr %r5, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r3.v = load i64, ptr %r3, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cmp = icmp eq i64 %r3.v, %r5.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i7

i7:                                               ; preds = %i6
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i11, label %i8

i8:                                               ; preds = %i7
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %rr, align 8
  br label %i10

i10:                                              ; preds = %i9
  br label %i13

i11:                                              ; preds = %i7
  store i64 0, ptr %r7, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r7.v = load i64, ptr %r7, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r7.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i13:                                              ; preds = %cont4, %i10
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i12, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i12
  br label %i13
}

; Function Attrs: minsize optsize
define private i64 @ev.4(ptr %0, i64 %1, i64 %2) #1 {
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
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i15

i15:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i16

i16:                                              ; preds = %i15
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i18

i18:                                              ; preds = %i17
  store i64 0, ptr %r4, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cmp = icmp eq i64 %r3.v, %r4.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i27, label %i21

i21:                                              ; preds = %i20
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i22

i22:                                              ; preds = %i21
  store i64 1, ptr %r6, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i25

i25:                                              ; preds = %i24
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i26:                                              ; preds = %cont
  br label %i34

i27:                                              ; preds = %i20
  %r0.v3 = load i64, ptr %r0, align 8
  store i64 %r0.v3, ptr %r9, align 8
  br label %i28

i28:                                              ; preds = %i27
  store i64 1, ptr %r10, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r9.v, i64 %r10.v)
  store i64 %ssub, ptr %r7, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r1.v4 = load i64, ptr %r1, align 8
  store i64 %r1.v4, ptr %r8, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i34:                                              ; preds = %cont7, %i26
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i25
  ret i64 0

cont:                                             ; preds = %i25
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i26

cont7:                                            ; preds = %i33
  %a0.v8 = load i64, ptr %a0, align 8
  %a1.v9 = load i64, ptr %a1, align 8
  %call10 = call i64 @od.5(ptr %0, i64 %a0.v8, i64 %a1.v9)
  store i64 %call10, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34
}

; Function Attrs: minsize optsize
define private i64 @od.5(ptr %0, i64 %1, i64 %2) #1 {
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
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i35

i35:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i36

i36:                                              ; preds = %i35
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i38

i38:                                              ; preds = %i37
  store i64 0, ptr %r4, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cmp = icmp eq i64 %r3.v, %r4.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r2, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i47, label %i41

i41:                                              ; preds = %i40
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 0, ptr %r6, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i45

i45:                                              ; preds = %i44
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  br label %i54

i47:                                              ; preds = %i40
  %r0.v3 = load i64, ptr %r0, align 8
  store i64 %r0.v3, ptr %r9, align 8
  br label %i48

i48:                                              ; preds = %i47
  store i64 1, ptr %r10, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r9.v, i64 %r10.v)
  store i64 %ssub, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r1.v4 = load i64, ptr %r1, align 8
  store i64 %r1.v4, ptr %r8, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i54:                                              ; preds = %cont7, %i46
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i53, %i45
  ret i64 0

cont:                                             ; preds = %i45
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i46

cont7:                                            ; preds = %i53
  %a0.v8 = load i64, ptr %a0, align 8
  %a1.v9 = load i64, ptr %a1, align 8
  %call10 = call i64 @ev.4(ptr %0, i64 %a0.v8, i64 %a1.v9)
  store i64 %call10, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
