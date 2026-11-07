;; measure-box30000
;; source:
;;   fn build(n) { if n == 0 { 0 } else { let mut v = n; let get = |x| v + x; v = v + 1; get(0) + build(n - 1) } } build(30000)
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
  br label %i21

i21:                                              ; preds = %i0
  br label %i57

i57:                                              ; preds = %i21
  store i64 30000, ptr %r0, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i59

i59:                                              ; preds = %i58
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i60:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i59
  ret i64 0

cont:                                             ; preds = %i59
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @build.4(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i60
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
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %r11 = alloca i64, align 8
  store i64 0, ptr %r11, align 8
  %r12 = alloca i64, align 8
  store i64 0, ptr %r12, align 8
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
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
  br i1 %jz, label %i18, label %i8

i8:                                               ; preds = %i7
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r7.v = load i64, ptr %r7, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r7.v)
  store i64 %tail, ptr %r6, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i10:                                              ; preds = %cont4
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r9, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r9.v = load i64, ptr %r9, align 8
  %head5 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head5, ptr %r8, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i12:                                              ; preds = %cont8
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r10, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %r12, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r12.v = load i64, ptr %r12, align 8
  %boxget = call i64 @rt_box_get(ptr %0, i64 %r12.v)
  store i64 %boxget, ptr %r11, align 8
  %guard9 = call i64 @rt_faulted(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i15:                                              ; preds = %cont11
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r13, align 8
  br label %i16

i16:                                              ; preds = %i15
  %r11.v = load i64, ptr %r11, align 8
  %r13.v = load i64, ptr %r13, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r13.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i17

i17:                                              ; preds = %i16
  br label %i20

i18:                                              ; preds = %i7
  store i64 0, ptr %r14, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r14.v = load i64, ptr %r14, align 8
  %head12 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head12, ptr %rr, align 8
  %guard13 = call i64 @rt_faulted(ptr %0)
  %trip14 = icmp ne i64 %guard13, 0
  br i1 %trip14, label %exit, label %cont15

i20:                                              ; preds = %cont15, %i17
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i19, %i14, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont11:                                           ; preds = %i14
  br label %i15

cont15:                                           ; preds = %i19
  br label %i20
}

define private i64 @build.4(ptr %0, i64 %1) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %r7 = alloca i64, align 8
  store i64 0, ptr %r7, align 8
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %r11 = alloca i64, align 8
  store i64 0, ptr %r11, align 8
  %r12 = alloca i64, align 8
  store i64 0, ptr %r12, align 8
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %r16 = alloca i64, align 8
  store i64 0, ptr %r16, align 8
  %r17 = alloca i64, align 8
  store i64 0, ptr %r17, align 8
  %r18 = alloca i64, align 8
  store i64 0, ptr %r18, align 8
  %r19 = alloca i64, align 8
  store i64 0, ptr %r19, align 8
  %r20 = alloca i64, align 8
  store i64 0, ptr %r20, align 8
  %r21 = alloca i64, align 8
  store i64 0, ptr %r21, align 8
  %r22 = alloca i64, align 8
  store i64 0, ptr %r22, align 8
  %r23 = alloca i64, align 8
  store i64 0, ptr %r23, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i22

i22:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i24

i24:                                              ; preds = %i23
  store i64 0, ptr %r3, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i29, label %i27

i27:                                              ; preds = %i26
  store i64 0, ptr %rr, align 8
  br label %i28

i28:                                              ; preds = %i27
  br label %i56

i29:                                              ; preds = %i26
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r5, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r5.v = load i64, ptr %r5, align 8
  %box = call i64 @rt_box(ptr %0, i64 %r5.v)
  store i64 %box, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i31:                                              ; preds = %cont
  store i64 0, ptr %r7, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %r9, align 8
  br label %i33

i33:                                              ; preds = %i32
  store i64 0, ptr %r10, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons, ptr %r8, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i35:                                              ; preds = %cont4
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons5, ptr %r6, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i36:                                              ; preds = %cont8
  %r4.v9 = load i64, ptr %r4, align 8
  store i64 %r4.v9, ptr %r12, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r4.v10 = load i64, ptr %r4, align 8
  store i64 %r4.v10, ptr %r15, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r15.v = load i64, ptr %r15, align 8
  %boxget = call i64 @rt_box_get(ptr %0, i64 %r15.v)
  store i64 %boxget, ptr %r14, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i39:                                              ; preds = %cont13
  store i64 1, ptr %r16, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r14.v = load i64, ptr %r14, align 8
  %r16.v = load i64, ptr %r16, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r14.v, i64 %r16.v)
  store i64 %sadd, ptr %r13, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  call void @rt_box_set(ptr %0, i64 %r12.v, i64 %r13.v)
  %guard14 = call i64 @rt_faulted(ptr %0)
  %trip15 = icmp ne i64 %guard14, 0
  br i1 %trip15, label %exit, label %cont16

i42:                                              ; preds = %cont16
  store i64 0, ptr %r11, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r18, align 8
  br label %i44

i44:                                              ; preds = %i43
  store i64 0, ptr %r19, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r18.v = load i64, ptr %r18, align 8
  store i64 %r18.v, ptr %a0, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r19.v = load i64, ptr %r19, align 8
  store i64 %r19.v, ptr %a1, align 8
  br label %i47

i47:                                              ; preds = %i46
  %guard17 = call i64 @rt_enter(ptr %0)
  %trip18 = icmp ne i64 %guard17, 0
  br i1 %trip18, label %exit, label %cont19

i48:                                              ; preds = %cont19
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r17, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r0.v21 = load i64, ptr %r0, align 8
  store i64 %r0.v21, ptr %r22, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 1, ptr %r23, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r22.v = load i64, ptr %r22, align 8
  %r23.v = load i64, ptr %r23, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r22.v, i64 %r23.v)
  store i64 %ssub, ptr %r21, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r21.v = load i64, ptr %r21, align 8
  store i64 %r21.v, ptr %a0, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard22 = call i64 @rt_enter(ptr %0)
  %trip23 = icmp ne i64 %guard22, 0
  br i1 %trip23, label %exit, label %cont24

i54:                                              ; preds = %cont24
  %rr.v27 = load i64, ptr %rr, align 8
  store i64 %rr.v27, ptr %r20, align 8
  br label %i55

i55:                                              ; preds = %i54
  %r17.v = load i64, ptr %r17, align 8
  %r20.v = load i64, ptr %r20, align 8
  %sadd28 = call i64 @llvm.uadd.sat.i64(i64 %r17.v, i64 %r20.v)
  store i64 %sadd28, ptr %rr, align 8
  br label %i56

i56:                                              ; preds = %i55, %i28
  %rr.v29 = load i64, ptr %rr, align 8
  ret i64 %rr.v29

exit:                                             ; preds = %i53, %i47, %i41, %i38, %i35, %i34, %i30
  ret i64 0

cont:                                             ; preds = %i30
  br label %i31

cont4:                                            ; preds = %i34
  br label %i35

cont8:                                            ; preds = %i35
  br label %i36

cont13:                                           ; preds = %i38
  br label %i39

cont16:                                           ; preds = %i41
  br label %i42

cont19:                                           ; preds = %i47
  %a0.v20 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v20, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i48

cont24:                                           ; preds = %i53
  %a0.v25 = load i64, ptr %a0, align 8
  %call26 = call i64 @build.4(ptr %0, i64 %a0.v25)
  store i64 %call26, ptr %rr, align 8
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
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i21

i21:                                              ; preds = %i0
  br label %i57

i57:                                              ; preds = %i21
  store i64 30000, ptr %r0, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i59

i59:                                              ; preds = %i58
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i60:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i59
  ret i64 0

cont:                                             ; preds = %i59
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @build.4(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i60
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
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %r11 = alloca i64, align 8
  store i64 0, ptr %r11, align 8
  %r12 = alloca i64, align 8
  store i64 0, ptr %r12, align 8
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
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
  br i1 %jz, label %i18, label %i8

i8:                                               ; preds = %i7
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r7.v = load i64, ptr %r7, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r7.v)
  store i64 %tail, ptr %r6, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i10:                                              ; preds = %cont4
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r9, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r9.v = load i64, ptr %r9, align 8
  %head5 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head5, ptr %r8, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i12:                                              ; preds = %cont8
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r10, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %r12, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r12.v = load i64, ptr %r12, align 8
  %boxget = call i64 @rt_box_get(ptr %0, i64 %r12.v)
  store i64 %boxget, ptr %r11, align 8
  %guard9 = call i64 @rt_faulted(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i15:                                              ; preds = %cont11
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r13, align 8
  br label %i16

i16:                                              ; preds = %i15
  %r11.v = load i64, ptr %r11, align 8
  %r13.v = load i64, ptr %r13, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r13.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i17

i17:                                              ; preds = %i16
  br label %i20

i18:                                              ; preds = %i7
  store i64 0, ptr %r14, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r14.v = load i64, ptr %r14, align 8
  %head12 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head12, ptr %rr, align 8
  %guard13 = call i64 @rt_faulted(ptr %0)
  %trip14 = icmp ne i64 %guard13, 0
  br i1 %trip14, label %exit, label %cont15

i20:                                              ; preds = %cont15, %i17
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i19, %i14, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont11:                                           ; preds = %i14
  br label %i15

cont15:                                           ; preds = %i19
  br label %i20
}

; Function Attrs: optsize
define private i64 @build.4(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %r7 = alloca i64, align 8
  store i64 0, ptr %r7, align 8
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %r11 = alloca i64, align 8
  store i64 0, ptr %r11, align 8
  %r12 = alloca i64, align 8
  store i64 0, ptr %r12, align 8
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %r16 = alloca i64, align 8
  store i64 0, ptr %r16, align 8
  %r17 = alloca i64, align 8
  store i64 0, ptr %r17, align 8
  %r18 = alloca i64, align 8
  store i64 0, ptr %r18, align 8
  %r19 = alloca i64, align 8
  store i64 0, ptr %r19, align 8
  %r20 = alloca i64, align 8
  store i64 0, ptr %r20, align 8
  %r21 = alloca i64, align 8
  store i64 0, ptr %r21, align 8
  %r22 = alloca i64, align 8
  store i64 0, ptr %r22, align 8
  %r23 = alloca i64, align 8
  store i64 0, ptr %r23, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i22

i22:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i24

i24:                                              ; preds = %i23
  store i64 0, ptr %r3, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i29, label %i27

i27:                                              ; preds = %i26
  store i64 0, ptr %rr, align 8
  br label %i28

i28:                                              ; preds = %i27
  br label %i56

i29:                                              ; preds = %i26
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r5, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r5.v = load i64, ptr %r5, align 8
  %box = call i64 @rt_box(ptr %0, i64 %r5.v)
  store i64 %box, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i31:                                              ; preds = %cont
  store i64 0, ptr %r7, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %r9, align 8
  br label %i33

i33:                                              ; preds = %i32
  store i64 0, ptr %r10, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons, ptr %r8, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i35:                                              ; preds = %cont4
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons5, ptr %r6, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i36:                                              ; preds = %cont8
  %r4.v9 = load i64, ptr %r4, align 8
  store i64 %r4.v9, ptr %r12, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r4.v10 = load i64, ptr %r4, align 8
  store i64 %r4.v10, ptr %r15, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r15.v = load i64, ptr %r15, align 8
  %boxget = call i64 @rt_box_get(ptr %0, i64 %r15.v)
  store i64 %boxget, ptr %r14, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i39:                                              ; preds = %cont13
  store i64 1, ptr %r16, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r14.v = load i64, ptr %r14, align 8
  %r16.v = load i64, ptr %r16, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r14.v, i64 %r16.v)
  store i64 %sadd, ptr %r13, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  call void @rt_box_set(ptr %0, i64 %r12.v, i64 %r13.v)
  %guard14 = call i64 @rt_faulted(ptr %0)
  %trip15 = icmp ne i64 %guard14, 0
  br i1 %trip15, label %exit, label %cont16

i42:                                              ; preds = %cont16
  store i64 0, ptr %r11, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r18, align 8
  br label %i44

i44:                                              ; preds = %i43
  store i64 0, ptr %r19, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r18.v = load i64, ptr %r18, align 8
  store i64 %r18.v, ptr %a0, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r19.v = load i64, ptr %r19, align 8
  store i64 %r19.v, ptr %a1, align 8
  br label %i47

i47:                                              ; preds = %i46
  %guard17 = call i64 @rt_enter(ptr %0)
  %trip18 = icmp ne i64 %guard17, 0
  br i1 %trip18, label %exit, label %cont19

i48:                                              ; preds = %cont19
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r17, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r0.v21 = load i64, ptr %r0, align 8
  store i64 %r0.v21, ptr %r22, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 1, ptr %r23, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r22.v = load i64, ptr %r22, align 8
  %r23.v = load i64, ptr %r23, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r22.v, i64 %r23.v)
  store i64 %ssub, ptr %r21, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r21.v = load i64, ptr %r21, align 8
  store i64 %r21.v, ptr %a0, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard22 = call i64 @rt_enter(ptr %0)
  %trip23 = icmp ne i64 %guard22, 0
  br i1 %trip23, label %exit, label %cont24

i54:                                              ; preds = %cont24
  %rr.v27 = load i64, ptr %rr, align 8
  store i64 %rr.v27, ptr %r20, align 8
  br label %i55

i55:                                              ; preds = %i54
  %r17.v = load i64, ptr %r17, align 8
  %r20.v = load i64, ptr %r20, align 8
  %sadd28 = call i64 @llvm.uadd.sat.i64(i64 %r17.v, i64 %r20.v)
  store i64 %sadd28, ptr %rr, align 8
  br label %i56

i56:                                              ; preds = %i55, %i28
  %rr.v29 = load i64, ptr %rr, align 8
  ret i64 %rr.v29

exit:                                             ; preds = %i53, %i47, %i41, %i38, %i35, %i34, %i30
  ret i64 0

cont:                                             ; preds = %i30
  br label %i31

cont4:                                            ; preds = %i34
  br label %i35

cont8:                                            ; preds = %i35
  br label %i36

cont13:                                           ; preds = %i38
  br label %i39

cont16:                                           ; preds = %i41
  br label %i42

cont19:                                           ; preds = %i47
  %a0.v20 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v20, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i48

cont24:                                           ; preds = %i53
  %a0.v25 = load i64, ptr %a0, align 8
  %call26 = call i64 @build.4(ptr %0, i64 %a0.v25)
  store i64 %call26, ptr %rr, align 8
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
  %r0 = alloca i64, align 8
  store i64 0, ptr %r0, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i21

i21:                                              ; preds = %i0
  br label %i57

i57:                                              ; preds = %i21
  store i64 30000, ptr %r0, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i59

i59:                                              ; preds = %i58
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i60:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i59
  ret i64 0

cont:                                             ; preds = %i59
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @build.4(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i60
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
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %r11 = alloca i64, align 8
  store i64 0, ptr %r11, align 8
  %r12 = alloca i64, align 8
  store i64 0, ptr %r12, align 8
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
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
  br i1 %jz, label %i18, label %i8

i8:                                               ; preds = %i7
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r7.v = load i64, ptr %r7, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r7.v)
  store i64 %tail, ptr %r6, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i10:                                              ; preds = %cont4
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r9, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r9.v = load i64, ptr %r9, align 8
  %head5 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head5, ptr %r8, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i12:                                              ; preds = %cont8
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r10, align 8
  br label %i13

i13:                                              ; preds = %i12
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %r12, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r12.v = load i64, ptr %r12, align 8
  %boxget = call i64 @rt_box_get(ptr %0, i64 %r12.v)
  store i64 %boxget, ptr %r11, align 8
  %guard9 = call i64 @rt_faulted(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i15:                                              ; preds = %cont11
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r13, align 8
  br label %i16

i16:                                              ; preds = %i15
  %r11.v = load i64, ptr %r11, align 8
  %r13.v = load i64, ptr %r13, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r13.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i17

i17:                                              ; preds = %i16
  br label %i20

i18:                                              ; preds = %i7
  store i64 0, ptr %r14, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r14.v = load i64, ptr %r14, align 8
  %head12 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head12, ptr %rr, align 8
  %guard13 = call i64 @rt_faulted(ptr %0)
  %trip14 = icmp ne i64 %guard13, 0
  br i1 %trip14, label %exit, label %cont15

i20:                                              ; preds = %cont15, %i17
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i19, %i14, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont11:                                           ; preds = %i14
  br label %i15

cont15:                                           ; preds = %i19
  br label %i20
}

; Function Attrs: minsize optsize
define private i64 @build.4(ptr %0, i64 %1) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
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
  %r7 = alloca i64, align 8
  store i64 0, ptr %r7, align 8
  %r8 = alloca i64, align 8
  store i64 0, ptr %r8, align 8
  %r9 = alloca i64, align 8
  store i64 0, ptr %r9, align 8
  %r10 = alloca i64, align 8
  store i64 0, ptr %r10, align 8
  %r11 = alloca i64, align 8
  store i64 0, ptr %r11, align 8
  %r12 = alloca i64, align 8
  store i64 0, ptr %r12, align 8
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %r16 = alloca i64, align 8
  store i64 0, ptr %r16, align 8
  %r17 = alloca i64, align 8
  store i64 0, ptr %r17, align 8
  %r18 = alloca i64, align 8
  store i64 0, ptr %r18, align 8
  %r19 = alloca i64, align 8
  store i64 0, ptr %r19, align 8
  %r20 = alloca i64, align 8
  store i64 0, ptr %r20, align 8
  %r21 = alloca i64, align 8
  store i64 0, ptr %r21, align 8
  %r22 = alloca i64, align 8
  store i64 0, ptr %r22, align 8
  %r23 = alloca i64, align 8
  store i64 0, ptr %r23, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i22

i22:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i24

i24:                                              ; preds = %i23
  store i64 0, ptr %r3, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cmp = icmp eq i64 %r2.v, %r3.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r1, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r1.v = load i64, ptr %r1, align 8
  %jz = icmp eq i64 %r1.v, 0
  br i1 %jz, label %i29, label %i27

i27:                                              ; preds = %i26
  store i64 0, ptr %rr, align 8
  br label %i28

i28:                                              ; preds = %i27
  br label %i56

i29:                                              ; preds = %i26
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r5, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r5.v = load i64, ptr %r5, align 8
  %box = call i64 @rt_box(ptr %0, i64 %r5.v)
  store i64 %box, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i31:                                              ; preds = %cont
  store i64 0, ptr %r7, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %r9, align 8
  br label %i33

i33:                                              ; preds = %i32
  store i64 0, ptr %r10, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons, ptr %r8, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i35:                                              ; preds = %cont4
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons5, ptr %r6, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i36:                                              ; preds = %cont8
  %r4.v9 = load i64, ptr %r4, align 8
  store i64 %r4.v9, ptr %r12, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r4.v10 = load i64, ptr %r4, align 8
  store i64 %r4.v10, ptr %r15, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r15.v = load i64, ptr %r15, align 8
  %boxget = call i64 @rt_box_get(ptr %0, i64 %r15.v)
  store i64 %boxget, ptr %r14, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i39:                                              ; preds = %cont13
  store i64 1, ptr %r16, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r14.v = load i64, ptr %r14, align 8
  %r16.v = load i64, ptr %r16, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r14.v, i64 %r16.v)
  store i64 %sadd, ptr %r13, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  call void @rt_box_set(ptr %0, i64 %r12.v, i64 %r13.v)
  %guard14 = call i64 @rt_faulted(ptr %0)
  %trip15 = icmp ne i64 %guard14, 0
  br i1 %trip15, label %exit, label %cont16

i42:                                              ; preds = %cont16
  store i64 0, ptr %r11, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r18, align 8
  br label %i44

i44:                                              ; preds = %i43
  store i64 0, ptr %r19, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r18.v = load i64, ptr %r18, align 8
  store i64 %r18.v, ptr %a0, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r19.v = load i64, ptr %r19, align 8
  store i64 %r19.v, ptr %a1, align 8
  br label %i47

i47:                                              ; preds = %i46
  %guard17 = call i64 @rt_enter(ptr %0)
  %trip18 = icmp ne i64 %guard17, 0
  br i1 %trip18, label %exit, label %cont19

i48:                                              ; preds = %cont19
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r17, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r0.v21 = load i64, ptr %r0, align 8
  store i64 %r0.v21, ptr %r22, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 1, ptr %r23, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r22.v = load i64, ptr %r22, align 8
  %r23.v = load i64, ptr %r23, align 8
  %ssub = call i64 @llvm.usub.sat.i64(i64 %r22.v, i64 %r23.v)
  store i64 %ssub, ptr %r21, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r21.v = load i64, ptr %r21, align 8
  store i64 %r21.v, ptr %a0, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard22 = call i64 @rt_enter(ptr %0)
  %trip23 = icmp ne i64 %guard22, 0
  br i1 %trip23, label %exit, label %cont24

i54:                                              ; preds = %cont24
  %rr.v27 = load i64, ptr %rr, align 8
  store i64 %rr.v27, ptr %r20, align 8
  br label %i55

i55:                                              ; preds = %i54
  %r17.v = load i64, ptr %r17, align 8
  %r20.v = load i64, ptr %r20, align 8
  %sadd28 = call i64 @llvm.uadd.sat.i64(i64 %r17.v, i64 %r20.v)
  store i64 %sadd28, ptr %rr, align 8
  br label %i56

i56:                                              ; preds = %i55, %i28
  %rr.v29 = load i64, ptr %rr, align 8
  ret i64 %rr.v29

exit:                                             ; preds = %i53, %i47, %i41, %i38, %i35, %i34, %i30
  ret i64 0

cont:                                             ; preds = %i30
  br label %i31

cont4:                                            ; preds = %i34
  br label %i35

cont8:                                            ; preds = %i35
  br label %i36

cont13:                                           ; preds = %i38
  br label %i39

cont16:                                           ; preds = %i41
  br label %i42

cont19:                                           ; preds = %i47
  %a0.v20 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v20, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i48

cont24:                                           ; preds = %i53
  %a0.v25 = load i64, ptr %a0, align 8
  %call26 = call i64 @build.4(ptr %0, i64 %a0.v25)
  store i64 %call26, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
