;; first-order-42
;; source:
;;   let n = 7; fn tail(x) { x + 1 } fn ap(g, y) { g(y) } tail(3) + ap(tail, 2) + ap(|y| y + n, 5)
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
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i35

i35:                                              ; preds = %i6
  br label %i44

i44:                                              ; preds = %i35
  store i64 7, ptr %r0, align 8
  br label %i45

i45:                                              ; preds = %i44
  store i64 3, ptr %r3, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i47

i47:                                              ; preds = %i46
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i48:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r2, align 8
  br label %i49

i49:                                              ; preds = %i48
  store i64 0, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 0, ptr %r8, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons, ptr %r5, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i52:                                              ; preds = %cont3
  store i64 2, ptr %r6, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i54

i54:                                              ; preds = %i53
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i55

i55:                                              ; preds = %i54
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i56:                                              ; preds = %cont6
  %rr.v9 = load i64, ptr %rr, align 8
  store i64 %rr.v9, ptr %r4, align 8
  br label %i57

i57:                                              ; preds = %i56
  %r2.v = load i64, ptr %r2, align 8
  %r4.v = load i64, ptr %r4, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r2.v, i64 %r4.v)
  store i64 %sadd, ptr %r1, align 8
  br label %i58

i58:                                              ; preds = %i57
  store i64 1, ptr %r12, align 8
  br label %i59

i59:                                              ; preds = %i58
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r14, align 8
  br label %i60

i60:                                              ; preds = %i59
  store i64 0, ptr %r15, align 8
  br label %i61

i61:                                              ; preds = %i60
  %r14.v = load i64, ptr %r14, align 8
  %r15.v = load i64, ptr %r15, align 8
  %cons10 = call i64 @rt_cons(ptr %0, i64 %r14.v, i64 %r15.v)
  store i64 %cons10, ptr %r13, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i62:                                              ; preds = %cont13
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  %cons14 = call i64 @rt_cons(ptr %0, i64 %r12.v, i64 %r13.v)
  store i64 %cons14, ptr %r10, align 8
  %guard15 = call i64 @rt_faulted(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i63:                                              ; preds = %cont17
  store i64 5, ptr %r11, align 8
  br label %i64

i64:                                              ; preds = %i63
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %a0, align 8
  br label %i65

i65:                                              ; preds = %i64
  %r11.v = load i64, ptr %r11, align 8
  store i64 %r11.v, ptr %a1, align 8
  br label %i66

i66:                                              ; preds = %i65
  %guard18 = call i64 @rt_enter(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i67:                                              ; preds = %cont20
  %rr.v24 = load i64, ptr %rr, align 8
  store i64 %rr.v24, ptr %r9, align 8
  br label %i68

i68:                                              ; preds = %i67
  %r1.v = load i64, ptr %r1, align 8
  %r9.v = load i64, ptr %r9, align 8
  %sadd25 = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r9.v)
  store i64 %sadd25, ptr %rr, align 8
  br label %i69

i69:                                              ; preds = %i68
  %rr.v26 = load i64, ptr %rr, align 8
  ret i64 %rr.v26

exit:                                             ; preds = %i66, %i62, %i61, %i55, %i51, %i47
  ret i64 0

cont:                                             ; preds = %i47
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @tail.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i48

cont3:                                            ; preds = %i51
  br label %i52

cont6:                                            ; preds = %i55
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call8 = call i64 @ap.8(ptr %0, i64 %a0.v7, i64 %a1.v)
  store i64 %call8, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i56

cont13:                                           ; preds = %i61
  br label %i62

cont17:                                           ; preds = %i62
  br label %i63

cont20:                                           ; preds = %i66
  %a0.v21 = load i64, ptr %a0, align 8
  %a1.v22 = load i64, ptr %a1, align 8
  %call23 = call i64 @ap.8(ptr %0, i64 %a0.v21, i64 %a1.v22)
  store i64 %call23, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i67
}

define private i64 @tail.0(ptr %0, i64 %1) {
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
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %r16 = alloca i64, align 8
  store i64 0, ptr %r16, align 8
  %r17 = alloca i64, align 8
  store i64 0, ptr %r17, align 8
  %r18 = alloca i64, align 8
  store i64 0, ptr %r18, align 8
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
  br i1 %jz, label %i18, label %i14

i14:                                              ; preds = %i13
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i16

i16:                                              ; preds = %i15
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i17:                                              ; preds = %cont3
  br label %i34

i18:                                              ; preds = %i13
  %r0.v5 = load i64, ptr %r0, align 8
  store i64 %r0.v5, ptr %r9, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %r8, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i20:                                              ; preds = %cont9
  store i64 1, ptr %r10, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r8.v = load i64, ptr %r8, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cmp10 = icmp eq i64 %r8.v, %r10.v
  %cmpw11 = zext i1 %cmp10 to i64
  store i64 %cmpw11, ptr %r7, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r7.v = load i64, ptr %r7, align 8
  %jz12 = icmp eq i64 %r7.v, 0
  br i1 %jz12, label %i32, label %i23

i23:                                              ; preds = %i22
  %r0.v13 = load i64, ptr %r0, align 8
  store i64 %r0.v13, ptr %r12, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r12.v = load i64, ptr %r12, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r12.v)
  store i64 %tail, ptr %r11, align 8
  %guard14 = call i64 @rt_faulted(ptr %0)
  %trip15 = icmp ne i64 %guard14, 0
  br i1 %trip15, label %exit, label %cont16

i25:                                              ; preds = %cont16
  %r11.v = load i64, ptr %r11, align 8
  store i64 %r11.v, ptr %r14, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r14.v = load i64, ptr %r14, align 8
  %head17 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head17, ptr %r13, align 8
  %guard18 = call i64 @rt_faulted(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i27:                                              ; preds = %cont20
  %r1.v21 = load i64, ptr %r1, align 8
  store i64 %r1.v21, ptr %r15, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r15.v = load i64, ptr %r15, align 8
  store i64 %r15.v, ptr %r16, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %r17, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r16.v = load i64, ptr %r16, align 8
  %r17.v = load i64, ptr %r17, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r16.v, i64 %r17.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i31

i31:                                              ; preds = %i30
  br label %i34

i32:                                              ; preds = %i22
  store i64 0, ptr %r18, align 8
  br label %i33

i33:                                              ; preds = %i32
  %r18.v = load i64, ptr %r18, align 8
  %head22 = call i64 @rt_head(ptr %0, i64 %r18.v)
  store i64 %head22, ptr %rr, align 8
  %guard23 = call i64 @rt_faulted(ptr %0)
  %trip24 = icmp ne i64 %guard23, 0
  br i1 %trip24, label %exit, label %cont25

i34:                                              ; preds = %cont25, %i31, %i17
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i26, %i24, %i19, %i16, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont3:                                            ; preds = %i16
  %a0.v4 = load i64, ptr %a0, align 8
  %call = call i64 @tail.0(ptr %0, i64 %a0.v4)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i17

cont9:                                            ; preds = %i19
  br label %i20

cont16:                                           ; preds = %i24
  br label %i25

cont20:                                           ; preds = %i26
  br label %i27

cont25:                                           ; preds = %i33
  br label %i34
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
  br label %i36

i36:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i42

i42:                                              ; preds = %i41
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i43:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i42
  ret i64 0

cont:                                             ; preds = %i42
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i43
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
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i35

i35:                                              ; preds = %i6
  br label %i44

i44:                                              ; preds = %i35
  store i64 7, ptr %r0, align 8
  br label %i45

i45:                                              ; preds = %i44
  store i64 3, ptr %r3, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i47

i47:                                              ; preds = %i46
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i48:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r2, align 8
  br label %i49

i49:                                              ; preds = %i48
  store i64 0, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 0, ptr %r8, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons, ptr %r5, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i52:                                              ; preds = %cont3
  store i64 2, ptr %r6, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i54

i54:                                              ; preds = %i53
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i55

i55:                                              ; preds = %i54
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i56:                                              ; preds = %cont6
  %rr.v9 = load i64, ptr %rr, align 8
  store i64 %rr.v9, ptr %r4, align 8
  br label %i57

i57:                                              ; preds = %i56
  %r2.v = load i64, ptr %r2, align 8
  %r4.v = load i64, ptr %r4, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r2.v, i64 %r4.v)
  store i64 %sadd, ptr %r1, align 8
  br label %i58

i58:                                              ; preds = %i57
  store i64 1, ptr %r12, align 8
  br label %i59

i59:                                              ; preds = %i58
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r14, align 8
  br label %i60

i60:                                              ; preds = %i59
  store i64 0, ptr %r15, align 8
  br label %i61

i61:                                              ; preds = %i60
  %r14.v = load i64, ptr %r14, align 8
  %r15.v = load i64, ptr %r15, align 8
  %cons10 = call i64 @rt_cons(ptr %0, i64 %r14.v, i64 %r15.v)
  store i64 %cons10, ptr %r13, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i62:                                              ; preds = %cont13
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  %cons14 = call i64 @rt_cons(ptr %0, i64 %r12.v, i64 %r13.v)
  store i64 %cons14, ptr %r10, align 8
  %guard15 = call i64 @rt_faulted(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i63:                                              ; preds = %cont17
  store i64 5, ptr %r11, align 8
  br label %i64

i64:                                              ; preds = %i63
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %a0, align 8
  br label %i65

i65:                                              ; preds = %i64
  %r11.v = load i64, ptr %r11, align 8
  store i64 %r11.v, ptr %a1, align 8
  br label %i66

i66:                                              ; preds = %i65
  %guard18 = call i64 @rt_enter(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i67:                                              ; preds = %cont20
  %rr.v24 = load i64, ptr %rr, align 8
  store i64 %rr.v24, ptr %r9, align 8
  br label %i68

i68:                                              ; preds = %i67
  %r1.v = load i64, ptr %r1, align 8
  %r9.v = load i64, ptr %r9, align 8
  %sadd25 = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r9.v)
  store i64 %sadd25, ptr %rr, align 8
  br label %i69

i69:                                              ; preds = %i68
  %rr.v26 = load i64, ptr %rr, align 8
  ret i64 %rr.v26

exit:                                             ; preds = %i66, %i62, %i61, %i55, %i51, %i47
  ret i64 0

cont:                                             ; preds = %i47
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @tail.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i48

cont3:                                            ; preds = %i51
  br label %i52

cont6:                                            ; preds = %i55
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call8 = call i64 @ap.8(ptr %0, i64 %a0.v7, i64 %a1.v)
  store i64 %call8, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i56

cont13:                                           ; preds = %i61
  br label %i62

cont17:                                           ; preds = %i62
  br label %i63

cont20:                                           ; preds = %i66
  %a0.v21 = load i64, ptr %a0, align 8
  %a1.v22 = load i64, ptr %a1, align 8
  %call23 = call i64 @ap.8(ptr %0, i64 %a0.v21, i64 %a1.v22)
  store i64 %call23, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i67
}

; Function Attrs: optsize
define private i64 @tail.0(ptr %0, i64 %1) #1 {
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
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %r16 = alloca i64, align 8
  store i64 0, ptr %r16, align 8
  %r17 = alloca i64, align 8
  store i64 0, ptr %r17, align 8
  %r18 = alloca i64, align 8
  store i64 0, ptr %r18, align 8
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
  br i1 %jz, label %i18, label %i14

i14:                                              ; preds = %i13
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i16

i16:                                              ; preds = %i15
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i17:                                              ; preds = %cont3
  br label %i34

i18:                                              ; preds = %i13
  %r0.v5 = load i64, ptr %r0, align 8
  store i64 %r0.v5, ptr %r9, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %r8, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i20:                                              ; preds = %cont9
  store i64 1, ptr %r10, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r8.v = load i64, ptr %r8, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cmp10 = icmp eq i64 %r8.v, %r10.v
  %cmpw11 = zext i1 %cmp10 to i64
  store i64 %cmpw11, ptr %r7, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r7.v = load i64, ptr %r7, align 8
  %jz12 = icmp eq i64 %r7.v, 0
  br i1 %jz12, label %i32, label %i23

i23:                                              ; preds = %i22
  %r0.v13 = load i64, ptr %r0, align 8
  store i64 %r0.v13, ptr %r12, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r12.v = load i64, ptr %r12, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r12.v)
  store i64 %tail, ptr %r11, align 8
  %guard14 = call i64 @rt_faulted(ptr %0)
  %trip15 = icmp ne i64 %guard14, 0
  br i1 %trip15, label %exit, label %cont16

i25:                                              ; preds = %cont16
  %r11.v = load i64, ptr %r11, align 8
  store i64 %r11.v, ptr %r14, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r14.v = load i64, ptr %r14, align 8
  %head17 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head17, ptr %r13, align 8
  %guard18 = call i64 @rt_faulted(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i27:                                              ; preds = %cont20
  %r1.v21 = load i64, ptr %r1, align 8
  store i64 %r1.v21, ptr %r15, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r15.v = load i64, ptr %r15, align 8
  store i64 %r15.v, ptr %r16, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %r17, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r16.v = load i64, ptr %r16, align 8
  %r17.v = load i64, ptr %r17, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r16.v, i64 %r17.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i31

i31:                                              ; preds = %i30
  br label %i34

i32:                                              ; preds = %i22
  store i64 0, ptr %r18, align 8
  br label %i33

i33:                                              ; preds = %i32
  %r18.v = load i64, ptr %r18, align 8
  %head22 = call i64 @rt_head(ptr %0, i64 %r18.v)
  store i64 %head22, ptr %rr, align 8
  %guard23 = call i64 @rt_faulted(ptr %0)
  %trip24 = icmp ne i64 %guard23, 0
  br i1 %trip24, label %exit, label %cont25

i34:                                              ; preds = %cont25, %i31, %i17
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i26, %i24, %i19, %i16, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont3:                                            ; preds = %i16
  %a0.v4 = load i64, ptr %a0, align 8
  %call = call i64 @tail.0(ptr %0, i64 %a0.v4)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i17

cont9:                                            ; preds = %i19
  br label %i20

cont16:                                           ; preds = %i24
  br label %i25

cont20:                                           ; preds = %i26
  br label %i27

cont25:                                           ; preds = %i33
  br label %i34
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
  br label %i36

i36:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i42

i42:                                              ; preds = %i41
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i43:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i42
  ret i64 0

cont:                                             ; preds = %i42
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i43
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
  %r13 = alloca i64, align 8
  store i64 0, ptr %r13, align 8
  %r14 = alloca i64, align 8
  store i64 0, ptr %r14, align 8
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i6

i6:                                               ; preds = %i0
  br label %i35

i35:                                              ; preds = %i6
  br label %i44

i44:                                              ; preds = %i35
  store i64 7, ptr %r0, align 8
  br label %i45

i45:                                              ; preds = %i44
  store i64 3, ptr %r3, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i47

i47:                                              ; preds = %i46
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i48:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r2, align 8
  br label %i49

i49:                                              ; preds = %i48
  store i64 0, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 0, ptr %r8, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons, ptr %r5, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i52:                                              ; preds = %cont3
  store i64 2, ptr %r6, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i54

i54:                                              ; preds = %i53
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i55

i55:                                              ; preds = %i54
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i56:                                              ; preds = %cont6
  %rr.v9 = load i64, ptr %rr, align 8
  store i64 %rr.v9, ptr %r4, align 8
  br label %i57

i57:                                              ; preds = %i56
  %r2.v = load i64, ptr %r2, align 8
  %r4.v = load i64, ptr %r4, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r2.v, i64 %r4.v)
  store i64 %sadd, ptr %r1, align 8
  br label %i58

i58:                                              ; preds = %i57
  store i64 1, ptr %r12, align 8
  br label %i59

i59:                                              ; preds = %i58
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r14, align 8
  br label %i60

i60:                                              ; preds = %i59
  store i64 0, ptr %r15, align 8
  br label %i61

i61:                                              ; preds = %i60
  %r14.v = load i64, ptr %r14, align 8
  %r15.v = load i64, ptr %r15, align 8
  %cons10 = call i64 @rt_cons(ptr %0, i64 %r14.v, i64 %r15.v)
  store i64 %cons10, ptr %r13, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i62:                                              ; preds = %cont13
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  %cons14 = call i64 @rt_cons(ptr %0, i64 %r12.v, i64 %r13.v)
  store i64 %cons14, ptr %r10, align 8
  %guard15 = call i64 @rt_faulted(ptr %0)
  %trip16 = icmp ne i64 %guard15, 0
  br i1 %trip16, label %exit, label %cont17

i63:                                              ; preds = %cont17
  store i64 5, ptr %r11, align 8
  br label %i64

i64:                                              ; preds = %i63
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %a0, align 8
  br label %i65

i65:                                              ; preds = %i64
  %r11.v = load i64, ptr %r11, align 8
  store i64 %r11.v, ptr %a1, align 8
  br label %i66

i66:                                              ; preds = %i65
  %guard18 = call i64 @rt_enter(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i67:                                              ; preds = %cont20
  %rr.v24 = load i64, ptr %rr, align 8
  store i64 %rr.v24, ptr %r9, align 8
  br label %i68

i68:                                              ; preds = %i67
  %r1.v = load i64, ptr %r1, align 8
  %r9.v = load i64, ptr %r9, align 8
  %sadd25 = call i64 @llvm.uadd.sat.i64(i64 %r1.v, i64 %r9.v)
  store i64 %sadd25, ptr %rr, align 8
  br label %i69

i69:                                              ; preds = %i68
  %rr.v26 = load i64, ptr %rr, align 8
  ret i64 %rr.v26

exit:                                             ; preds = %i66, %i62, %i61, %i55, %i51, %i47
  ret i64 0

cont:                                             ; preds = %i47
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @tail.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i48

cont3:                                            ; preds = %i51
  br label %i52

cont6:                                            ; preds = %i55
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call8 = call i64 @ap.8(ptr %0, i64 %a0.v7, i64 %a1.v)
  store i64 %call8, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i56

cont13:                                           ; preds = %i61
  br label %i62

cont17:                                           ; preds = %i62
  br label %i63

cont20:                                           ; preds = %i66
  %a0.v21 = load i64, ptr %a0, align 8
  %a1.v22 = load i64, ptr %a1, align 8
  %call23 = call i64 @ap.8(ptr %0, i64 %a0.v21, i64 %a1.v22)
  store i64 %call23, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i67
}

; Function Attrs: minsize optsize
define private i64 @tail.0(ptr %0, i64 %1) #1 {
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
  %r15 = alloca i64, align 8
  store i64 0, ptr %r15, align 8
  %r16 = alloca i64, align 8
  store i64 0, ptr %r16, align 8
  %r17 = alloca i64, align 8
  store i64 0, ptr %r17, align 8
  %r18 = alloca i64, align 8
  store i64 0, ptr %r18, align 8
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
  br i1 %jz, label %i18, label %i14

i14:                                              ; preds = %i13
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i16

i16:                                              ; preds = %i15
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i17:                                              ; preds = %cont3
  br label %i34

i18:                                              ; preds = %i13
  %r0.v5 = load i64, ptr %r0, align 8
  store i64 %r0.v5, ptr %r9, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %r8, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i20:                                              ; preds = %cont9
  store i64 1, ptr %r10, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r8.v = load i64, ptr %r8, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cmp10 = icmp eq i64 %r8.v, %r10.v
  %cmpw11 = zext i1 %cmp10 to i64
  store i64 %cmpw11, ptr %r7, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r7.v = load i64, ptr %r7, align 8
  %jz12 = icmp eq i64 %r7.v, 0
  br i1 %jz12, label %i32, label %i23

i23:                                              ; preds = %i22
  %r0.v13 = load i64, ptr %r0, align 8
  store i64 %r0.v13, ptr %r12, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r12.v = load i64, ptr %r12, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r12.v)
  store i64 %tail, ptr %r11, align 8
  %guard14 = call i64 @rt_faulted(ptr %0)
  %trip15 = icmp ne i64 %guard14, 0
  br i1 %trip15, label %exit, label %cont16

i25:                                              ; preds = %cont16
  %r11.v = load i64, ptr %r11, align 8
  store i64 %r11.v, ptr %r14, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r14.v = load i64, ptr %r14, align 8
  %head17 = call i64 @rt_head(ptr %0, i64 %r14.v)
  store i64 %head17, ptr %r13, align 8
  %guard18 = call i64 @rt_faulted(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i27:                                              ; preds = %cont20
  %r1.v21 = load i64, ptr %r1, align 8
  store i64 %r1.v21, ptr %r15, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r15.v = load i64, ptr %r15, align 8
  store i64 %r15.v, ptr %r16, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %r17, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r16.v = load i64, ptr %r16, align 8
  %r17.v = load i64, ptr %r17, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r16.v, i64 %r17.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i31

i31:                                              ; preds = %i30
  br label %i34

i32:                                              ; preds = %i22
  store i64 0, ptr %r18, align 8
  br label %i33

i33:                                              ; preds = %i32
  %r18.v = load i64, ptr %r18, align 8
  %head22 = call i64 @rt_head(ptr %0, i64 %r18.v)
  store i64 %head22, ptr %rr, align 8
  %guard23 = call i64 @rt_faulted(ptr %0)
  %trip24 = icmp ne i64 %guard23, 0
  br i1 %trip24, label %exit, label %cont25

i34:                                              ; preds = %cont25, %i31, %i17
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i26, %i24, %i19, %i16, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont3:                                            ; preds = %i16
  %a0.v4 = load i64, ptr %a0, align 8
  %call = call i64 @tail.0(ptr %0, i64 %a0.v4)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i17

cont9:                                            ; preds = %i19
  br label %i20

cont16:                                           ; preds = %i24
  br label %i25

cont20:                                           ; preds = %i26
  br label %i27

cont25:                                           ; preds = %i33
  br label %i34
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
  br label %i36

i36:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i41

i41:                                              ; preds = %i40
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i42

i42:                                              ; preds = %i41
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i43:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i42
  ret i64 0

cont:                                             ; preds = %i42
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.2"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i43
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
