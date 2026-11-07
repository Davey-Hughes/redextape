;; first-order-38
;; source:
;;   fn v(x) { x * 10 } fn b(x) { x + 1 } fn ap(g, x) { g(x) } ap(v, 1) + ap(b, 1) + b(5)
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i31

i31:                                              ; preds = %i6
  br label %i40

i40:                                              ; preds = %i31
  store i64 0, ptr %r4, align 8
  br label %i41

i41:                                              ; preds = %i40
  store i64 0, ptr %r5, align 8
  br label %i42

i42:                                              ; preds = %i41
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons, ptr %r2, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i43:                                              ; preds = %cont
  store i64 1, ptr %r3, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i46

i46:                                              ; preds = %i45
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i47:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r1, align 8
  br label %i48

i48:                                              ; preds = %i47
  store i64 1, ptr %r9, align 8
  br label %i49

i49:                                              ; preds = %i48
  store i64 0, ptr %r10, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons4 = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons4, ptr %r7, align 8
  %guard5 = call i64 @rt_faulted(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i51:                                              ; preds = %cont7
  store i64 1, ptr %r8, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i54

i54:                                              ; preds = %i53
  %guard8 = call i64 @rt_enter(ptr %0)
  %trip9 = icmp ne i64 %guard8, 0
  br i1 %trip9, label %exit, label %cont10

i55:                                              ; preds = %cont10
  %rr.v14 = load i64, ptr %rr, align 8
  store i64 %rr.v14, ptr %r6, align 8
  br label %i56

i56:                                              ; preds = %i55
  %r1.v = load i64, ptr %r1, align 8
  %r6.v = load i64, ptr %r6, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r6.v)
  store i64 %sadd, ptr %r0, align 8
  br label %i57

i57:                                              ; preds = %i56
  store i64 5, ptr %r12, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r12.v = load i64, ptr %r12, align 8
  store i64 %r12.v, ptr %a0, align 8
  br label %i59

i59:                                              ; preds = %i58
  %guard15 = call i64 @rt_enter(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i60:                                              ; preds = %cont17
  %rr.v20 = load i64, ptr %rr, align 8
  store i64 %rr.v20, ptr %r11, align 8
  br label %i61

i61:                                              ; preds = %i60
  %r0.v = load i64, ptr %r0, align 8
  %r11.v = load i64, ptr %r11, align 8
  %sadd21 = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r11.v)
  store i64 %sadd21, ptr %rr, align 8
  br label %i62

i62:                                              ; preds = %i61
  %rr.v22 = load i64, ptr %rr, align 8
  ret i64 %rr.v22

exit:                                             ; preds = %i59, %i54, %i50, %i46, %i42
  ret i64 0

cont:                                             ; preds = %i42
  br label %i43

cont3:                                            ; preds = %i46
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.8(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i47

cont7:                                            ; preds = %i50
  br label %i51

cont10:                                           ; preds = %i54
  %a0.v11 = load i64, ptr %a0, align 8
  %a1.v12 = load i64, ptr %a1, align 8
  %call13 = call i64 @ap.8(ptr %0, i64 %a0.v11, i64 %a1.v12)
  store i64 %call13, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i55

cont17:                                           ; preds = %i59
  %a0.v18 = load i64, ptr %a0, align 8
  %call19 = call i64 @b.0(ptr %0, i64 %a0.v18)
  store i64 %call19, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i60
}

define private i64 @b.0(ptr %0, i64 %1) {
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
  store i64 10, ptr %r8, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %mulo = call { i64, i1 } @llvm.umul.with.overflow.i64(i64 %r7.v, i64 %r8.v)
  %prod = extractvalue { i64, i1 } %mulo, 0
  %ovf = extractvalue { i64, i1 } %mulo, 1
  %smul = select i1 %ovf, i64 -1, i64 %prod
  store i64 %smul, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  br label %i30

i19:                                              ; preds = %i13
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r11, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r11.v = load i64, ptr %r11, align 8
  %head2 = call i64 @rt_head(ptr %0, i64 %r11.v)
  store i64 %head2, ptr %r10, align 8
  %guard3 = call i64 @rt_faulted(ptr %0)
  %trip4 = icmp ne i64 %guard3, 0
  br i1 %trip4, label %exit, label %cont5

i21:                                              ; preds = %cont5
  store i64 1, ptr %r12, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r10.v = load i64, ptr %r10, align 8
  %r12.v = load i64, ptr %r12, align 8
  %cmp6 = icmp eq i64 %r10.v, %r12.v
  %cmpw7 = zext i1 %cmp6 to i64
  store i64 %cmpw7, ptr %r9, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r9.v = load i64, ptr %r9, align 8
  %jz8 = icmp eq i64 %r9.v, 0
  br i1 %jz8, label %i28, label %i24

i24:                                              ; preds = %i23
  %r1.v9 = load i64, ptr %r1, align 8
  store i64 %r1.v9, ptr %r13, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %a0, align 8
  br label %i26

i26:                                              ; preds = %i25
  %guard10 = call i64 @rt_enter(ptr %0)
  %trip11 = icmp ne i64 %guard10, 0
  br i1 %trip11, label %exit, label %cont12

i27:                                              ; preds = %cont12
  br label %i30

i28:                                              ; preds = %i23
  store i64 0, ptr %r14, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r14.v = load i64, ptr %r14, align 8
  %head14 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head14, ptr %rr, align 8
  %guard15 = call i64 @rt_faulted(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i30:                                              ; preds = %cont17, %i27, %i18
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i29, %i26, %i20, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont5:                                            ; preds = %i20
  br label %i21

cont12:                                           ; preds = %i26
  %a0.v13 = load i64, ptr %a0, align 8
  %call = call i64 @b.0(ptr %0, i64 %a0.v13)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i27

cont17:                                           ; preds = %i29
  br label %i30
}

define private i64 @ap.8(ptr %0, i64 %1, i64 %2) {
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
  br label %i32

i32:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i38

i38:                                              ; preds = %i37
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i39:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i38
  ret i64 0

cont:                                             ; preds = %i38
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i39
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i31

i31:                                              ; preds = %i6
  br label %i40

i40:                                              ; preds = %i31
  store i64 0, ptr %r4, align 8
  br label %i41

i41:                                              ; preds = %i40
  store i64 0, ptr %r5, align 8
  br label %i42

i42:                                              ; preds = %i41
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons, ptr %r2, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i43:                                              ; preds = %cont
  store i64 1, ptr %r3, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i46

i46:                                              ; preds = %i45
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i47:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r1, align 8
  br label %i48

i48:                                              ; preds = %i47
  store i64 1, ptr %r9, align 8
  br label %i49

i49:                                              ; preds = %i48
  store i64 0, ptr %r10, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons4 = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons4, ptr %r7, align 8
  %guard5 = call i64 @rt_faulted(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i51:                                              ; preds = %cont7
  store i64 1, ptr %r8, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i54

i54:                                              ; preds = %i53
  %guard8 = call i64 @rt_enter(ptr %0)
  %trip9 = icmp ne i64 %guard8, 0
  br i1 %trip9, label %exit, label %cont10

i55:                                              ; preds = %cont10
  %rr.v14 = load i64, ptr %rr, align 8
  store i64 %rr.v14, ptr %r6, align 8
  br label %i56

i56:                                              ; preds = %i55
  %r1.v = load i64, ptr %r1, align 8
  %r6.v = load i64, ptr %r6, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r6.v)
  store i64 %sadd, ptr %r0, align 8
  br label %i57

i57:                                              ; preds = %i56
  store i64 5, ptr %r12, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r12.v = load i64, ptr %r12, align 8
  store i64 %r12.v, ptr %a0, align 8
  br label %i59

i59:                                              ; preds = %i58
  %guard15 = call i64 @rt_enter(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i60:                                              ; preds = %cont17
  %rr.v20 = load i64, ptr %rr, align 8
  store i64 %rr.v20, ptr %r11, align 8
  br label %i61

i61:                                              ; preds = %i60
  %r0.v = load i64, ptr %r0, align 8
  %r11.v = load i64, ptr %r11, align 8
  %sadd21 = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r11.v)
  store i64 %sadd21, ptr %rr, align 8
  br label %i62

i62:                                              ; preds = %i61
  %rr.v22 = load i64, ptr %rr, align 8
  ret i64 %rr.v22

exit:                                             ; preds = %i59, %i54, %i50, %i46, %i42
  ret i64 0

cont:                                             ; preds = %i42
  br label %i43

cont3:                                            ; preds = %i46
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.8(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i47

cont7:                                            ; preds = %i50
  br label %i51

cont10:                                           ; preds = %i54
  %a0.v11 = load i64, ptr %a0, align 8
  %a1.v12 = load i64, ptr %a1, align 8
  %call13 = call i64 @ap.8(ptr %0, i64 %a0.v11, i64 %a1.v12)
  store i64 %call13, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i55

cont17:                                           ; preds = %i59
  %a0.v18 = load i64, ptr %a0, align 8
  %call19 = call i64 @b.0(ptr %0, i64 %a0.v18)
  store i64 %call19, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i60
}

; Function Attrs: optsize
define private i64 @b.0(ptr %0, i64 %1) #1 {
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
  store i64 10, ptr %r8, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %mulo = call { i64, i1 } @llvm.umul.with.overflow.i64(i64 %r7.v, i64 %r8.v)
  %prod = extractvalue { i64, i1 } %mulo, 0
  %ovf = extractvalue { i64, i1 } %mulo, 1
  %smul = select i1 %ovf, i64 -1, i64 %prod
  store i64 %smul, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  br label %i30

i19:                                              ; preds = %i13
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r11, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r11.v = load i64, ptr %r11, align 8
  %head2 = call i64 @rt_head(ptr %0, i64 %r11.v)
  store i64 %head2, ptr %r10, align 8
  %guard3 = call i64 @rt_faulted(ptr %0)
  %trip4 = icmp ne i64 %guard3, 0
  br i1 %trip4, label %exit, label %cont5

i21:                                              ; preds = %cont5
  store i64 1, ptr %r12, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r10.v = load i64, ptr %r10, align 8
  %r12.v = load i64, ptr %r12, align 8
  %cmp6 = icmp eq i64 %r10.v, %r12.v
  %cmpw7 = zext i1 %cmp6 to i64
  store i64 %cmpw7, ptr %r9, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r9.v = load i64, ptr %r9, align 8
  %jz8 = icmp eq i64 %r9.v, 0
  br i1 %jz8, label %i28, label %i24

i24:                                              ; preds = %i23
  %r1.v9 = load i64, ptr %r1, align 8
  store i64 %r1.v9, ptr %r13, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %a0, align 8
  br label %i26

i26:                                              ; preds = %i25
  %guard10 = call i64 @rt_enter(ptr %0)
  %trip11 = icmp ne i64 %guard10, 0
  br i1 %trip11, label %exit, label %cont12

i27:                                              ; preds = %cont12
  br label %i30

i28:                                              ; preds = %i23
  store i64 0, ptr %r14, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r14.v = load i64, ptr %r14, align 8
  %head14 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head14, ptr %rr, align 8
  %guard15 = call i64 @rt_faulted(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i30:                                              ; preds = %cont17, %i27, %i18
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i29, %i26, %i20, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont5:                                            ; preds = %i20
  br label %i21

cont12:                                           ; preds = %i26
  %a0.v13 = load i64, ptr %a0, align 8
  %call = call i64 @b.0(ptr %0, i64 %a0.v13)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i27

cont17:                                           ; preds = %i29
  br label %i30
}

; Function Attrs: optsize
define private i64 @ap.8(ptr %0, i64 %1, i64 %2) #1 {
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
  br label %i32

i32:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i38

i38:                                              ; preds = %i37
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i39:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i38
  ret i64 0

cont:                                             ; preds = %i38
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i39
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i31

i31:                                              ; preds = %i6
  br label %i40

i40:                                              ; preds = %i31
  store i64 0, ptr %r4, align 8
  br label %i41

i41:                                              ; preds = %i40
  store i64 0, ptr %r5, align 8
  br label %i42

i42:                                              ; preds = %i41
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons, ptr %r2, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i43:                                              ; preds = %cont
  store i64 1, ptr %r3, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i46

i46:                                              ; preds = %i45
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i47:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r1, align 8
  br label %i48

i48:                                              ; preds = %i47
  store i64 1, ptr %r9, align 8
  br label %i49

i49:                                              ; preds = %i48
  store i64 0, ptr %r10, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons4 = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons4, ptr %r7, align 8
  %guard5 = call i64 @rt_faulted(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i51:                                              ; preds = %cont7
  store i64 1, ptr %r8, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i54

i54:                                              ; preds = %i53
  %guard8 = call i64 @rt_enter(ptr %0)
  %trip9 = icmp ne i64 %guard8, 0
  br i1 %trip9, label %exit, label %cont10

i55:                                              ; preds = %cont10
  %rr.v14 = load i64, ptr %rr, align 8
  store i64 %rr.v14, ptr %r6, align 8
  br label %i56

i56:                                              ; preds = %i55
  %r1.v = load i64, ptr %r1, align 8
  %r6.v = load i64, ptr %r6, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r6.v)
  store i64 %sadd, ptr %r0, align 8
  br label %i57

i57:                                              ; preds = %i56
  store i64 5, ptr %r12, align 8
  br label %i58

i58:                                              ; preds = %i57
  %r12.v = load i64, ptr %r12, align 8
  store i64 %r12.v, ptr %a0, align 8
  br label %i59

i59:                                              ; preds = %i58
  %guard15 = call i64 @rt_enter(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i60:                                              ; preds = %cont17
  %rr.v20 = load i64, ptr %rr, align 8
  store i64 %rr.v20, ptr %r11, align 8
  br label %i61

i61:                                              ; preds = %i60
  %r0.v = load i64, ptr %r0, align 8
  %r11.v = load i64, ptr %r11, align 8
  %sadd21 = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r11.v)
  store i64 %sadd21, ptr %rr, align 8
  br label %i62

i62:                                              ; preds = %i61
  %rr.v22 = load i64, ptr %rr, align 8
  ret i64 %rr.v22

exit:                                             ; preds = %i59, %i54, %i50, %i46, %i42
  ret i64 0

cont:                                             ; preds = %i42
  br label %i43

cont3:                                            ; preds = %i46
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.8(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i47

cont7:                                            ; preds = %i50
  br label %i51

cont10:                                           ; preds = %i54
  %a0.v11 = load i64, ptr %a0, align 8
  %a1.v12 = load i64, ptr %a1, align 8
  %call13 = call i64 @ap.8(ptr %0, i64 %a0.v11, i64 %a1.v12)
  store i64 %call13, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i55

cont17:                                           ; preds = %i59
  %a0.v18 = load i64, ptr %a0, align 8
  %call19 = call i64 @b.0(ptr %0, i64 %a0.v18)
  store i64 %call19, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i60
}

; Function Attrs: minsize optsize
define private i64 @b.0(ptr %0, i64 %1) #1 {
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
  store i64 10, ptr %r8, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %mulo = call { i64, i1 } @llvm.umul.with.overflow.i64(i64 %r7.v, i64 %r8.v)
  %prod = extractvalue { i64, i1 } %mulo, 0
  %ovf = extractvalue { i64, i1 } %mulo, 1
  %smul = select i1 %ovf, i64 -1, i64 %prod
  store i64 %smul, ptr %rr, align 8
  br label %i18

i18:                                              ; preds = %i17
  br label %i30

i19:                                              ; preds = %i13
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r11, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r11.v = load i64, ptr %r11, align 8
  %head2 = call i64 @rt_head(ptr %0, i64 %r11.v)
  store i64 %head2, ptr %r10, align 8
  %guard3 = call i64 @rt_faulted(ptr %0)
  %trip4 = icmp ne i64 %guard3, 0
  br i1 %trip4, label %exit, label %cont5

i21:                                              ; preds = %cont5
  store i64 1, ptr %r12, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r10.v = load i64, ptr %r10, align 8
  %r12.v = load i64, ptr %r12, align 8
  %cmp6 = icmp eq i64 %r10.v, %r12.v
  %cmpw7 = zext i1 %cmp6 to i64
  store i64 %cmpw7, ptr %r9, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r9.v = load i64, ptr %r9, align 8
  %jz8 = icmp eq i64 %r9.v, 0
  br i1 %jz8, label %i28, label %i24

i24:                                              ; preds = %i23
  %r1.v9 = load i64, ptr %r1, align 8
  store i64 %r1.v9, ptr %r13, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %a0, align 8
  br label %i26

i26:                                              ; preds = %i25
  %guard10 = call i64 @rt_enter(ptr %0)
  %trip11 = icmp ne i64 %guard10, 0
  br i1 %trip11, label %exit, label %cont12

i27:                                              ; preds = %cont12
  br label %i30

i28:                                              ; preds = %i23
  store i64 0, ptr %r14, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r14.v = load i64, ptr %r14, align 8
  %head14 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head14, ptr %rr, align 8
  %guard15 = call i64 @rt_faulted(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i30:                                              ; preds = %cont17, %i27, %i18
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i29, %i26, %i20, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont5:                                            ; preds = %i20
  br label %i21

cont12:                                           ; preds = %i26
  %a0.v13 = load i64, ptr %a0, align 8
  %call = call i64 @b.0(ptr %0, i64 %a0.v13)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i27

cont17:                                           ; preds = %i29
  br label %i30
}

; Function Attrs: minsize optsize
define private i64 @ap.8(ptr %0, i64 %1, i64 %2) #1 {
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
  br label %i32

i32:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i38

i38:                                              ; preds = %i37
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i39:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i38
  ret i64 0

cont:                                             ; preds = %i38
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i39
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
