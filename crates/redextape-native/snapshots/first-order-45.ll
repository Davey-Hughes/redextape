;; first-order-45
;; source:
;;   fn cons(a, b) { a + b } fn ap2(g, a, b) { g(a, b) } cons(1, 2) + ap2(cons, 3, 4)
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
  %a2 = alloca i64, align 8
  store i64 0, ptr %a2, align 8
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
  br label %i0

i0:                                               ; preds = %prologue
  br label %i7

i7:                                               ; preds = %i0
  br label %i25

i25:                                              ; preds = %i7
  br label %i37

i37:                                              ; preds = %i25
  store i64 1, ptr %r1, align 8
  br label %i38

i38:                                              ; preds = %i37
  store i64 2, ptr %r2, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a1, align 8
  br label %i41

i41:                                              ; preds = %i40
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i42:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i43

i43:                                              ; preds = %i42
  store i64 0, ptr %r7, align 8
  br label %i44

i44:                                              ; preds = %i43
  store i64 0, ptr %r8, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons, ptr %r4, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i46:                                              ; preds = %cont3
  store i64 3, ptr %r5, align 8
  br label %i47

i47:                                              ; preds = %i46
  store i64 4, ptr %r6, align 8
  br label %i48

i48:                                              ; preds = %i47
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a0, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a1, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a2, align 8
  br label %i51

i51:                                              ; preds = %i50
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i52:                                              ; preds = %cont6
  %rr.v10 = load i64, ptr %rr, align 8
  store i64 %rr.v10, ptr %r3, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r0.v = load i64, ptr %r0, align 8
  %r3.v = load i64, ptr %r3, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r3.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i54

i54:                                              ; preds = %i53
  %rr.v11 = load i64, ptr %rr, align 8
  ret i64 %rr.v11

exit:                                             ; preds = %i51, %i45, %i41
  ret i64 0

cont:                                             ; preds = %i41
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @cons.0(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i42

cont3:                                            ; preds = %i45
  br label %i46

cont6:                                            ; preds = %i51
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v8 = load i64, ptr %a1, align 8
  %a2.v = load i64, ptr %a2, align 8
  %call9 = call i64 @ap2.6(ptr %0, i64 %a0.v7, i64 %a1.v8, i64 %a2.v)
  store i64 %call9, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i52
}

define private i64 @cons.0(ptr %0, i64 %1, i64 %2) {
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
  store i64 %r0.v, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r2.v, i64 %r3.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i6

i6:                                               ; preds = %i5
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

define private i64 @"$apply2.2"(ptr %0, i64 %1, i64 %2, i64 %3) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %a2 = alloca i64, align 8
  store i64 %3, ptr %a2, align 8
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
  br label %i8

i8:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i9

i9:                                               ; preds = %i8
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i10

i10:                                              ; preds = %i9
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r5.v = load i64, ptr %r5, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r5.v)
  store i64 %head, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i13:                                              ; preds = %cont
  store i64 0, ptr %r6, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r4.v = load i64, ptr %r4, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp eq i64 %r4.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i22, label %i16

i16:                                              ; preds = %i15
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r7, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r8, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i20

i20:                                              ; preds = %i19
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i21:                                              ; preds = %cont3
  br label %i24

i22:                                              ; preds = %i15
  store i64 0, ptr %r9, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %rr, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i24:                                              ; preds = %cont9, %i21
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i23, %i20, %i12
  ret i64 0

cont:                                             ; preds = %i12
  br label %i13

cont3:                                            ; preds = %i20
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v5 = load i64, ptr %a1, align 8
  %call = call i64 @cons.0(ptr %0, i64 %a0.v4, i64 %a1.v5)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i21

cont9:                                            ; preds = %i23
  br label %i24
}

define private i64 @ap2.6(ptr %0, i64 %1, i64 %2, i64 %3) {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %a2 = alloca i64, align 8
  store i64 %3, ptr %a2, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i26

i26:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i27

i27:                                              ; preds = %i26
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i28

i28:                                              ; preds = %i27
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r4, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a2, align 8
  br label %i35

i35:                                              ; preds = %i34
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i36:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i35
  ret i64 0

cont:                                             ; preds = %i35
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %a2.v3 = load i64, ptr %a2, align 8
  %call = call i64 @"$apply2.2"(ptr %0, i64 %a0.v1, i64 %a1.v2, i64 %a2.v3)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i36
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
  %a2 = alloca i64, align 8
  store i64 0, ptr %a2, align 8
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
  br label %i0

i0:                                               ; preds = %prologue
  br label %i7

i7:                                               ; preds = %i0
  br label %i25

i25:                                              ; preds = %i7
  br label %i37

i37:                                              ; preds = %i25
  store i64 1, ptr %r1, align 8
  br label %i38

i38:                                              ; preds = %i37
  store i64 2, ptr %r2, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a1, align 8
  br label %i41

i41:                                              ; preds = %i40
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i42:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i43

i43:                                              ; preds = %i42
  store i64 0, ptr %r7, align 8
  br label %i44

i44:                                              ; preds = %i43
  store i64 0, ptr %r8, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons, ptr %r4, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i46:                                              ; preds = %cont3
  store i64 3, ptr %r5, align 8
  br label %i47

i47:                                              ; preds = %i46
  store i64 4, ptr %r6, align 8
  br label %i48

i48:                                              ; preds = %i47
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a0, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a1, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a2, align 8
  br label %i51

i51:                                              ; preds = %i50
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i52:                                              ; preds = %cont6
  %rr.v10 = load i64, ptr %rr, align 8
  store i64 %rr.v10, ptr %r3, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r0.v = load i64, ptr %r0, align 8
  %r3.v = load i64, ptr %r3, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r3.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i54

i54:                                              ; preds = %i53
  %rr.v11 = load i64, ptr %rr, align 8
  ret i64 %rr.v11

exit:                                             ; preds = %i51, %i45, %i41
  ret i64 0

cont:                                             ; preds = %i41
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @cons.0(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i42

cont3:                                            ; preds = %i45
  br label %i46

cont6:                                            ; preds = %i51
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v8 = load i64, ptr %a1, align 8
  %a2.v = load i64, ptr %a2, align 8
  %call9 = call i64 @ap2.6(ptr %0, i64 %a0.v7, i64 %a1.v8, i64 %a2.v)
  store i64 %call9, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i52
}

; Function Attrs: optsize
define private i64 @cons.0(ptr %0, i64 %1, i64 %2) #1 {
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
  store i64 %r0.v, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r2.v, i64 %r3.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i6

i6:                                               ; preds = %i5
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

; Function Attrs: optsize
define private i64 @"$apply2.2"(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %a2 = alloca i64, align 8
  store i64 %3, ptr %a2, align 8
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
  br label %i8

i8:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i9

i9:                                               ; preds = %i8
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i10

i10:                                              ; preds = %i9
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r5.v = load i64, ptr %r5, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r5.v)
  store i64 %head, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i13:                                              ; preds = %cont
  store i64 0, ptr %r6, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r4.v = load i64, ptr %r4, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp eq i64 %r4.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i22, label %i16

i16:                                              ; preds = %i15
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r7, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r8, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i20

i20:                                              ; preds = %i19
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i21:                                              ; preds = %cont3
  br label %i24

i22:                                              ; preds = %i15
  store i64 0, ptr %r9, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %rr, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i24:                                              ; preds = %cont9, %i21
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i23, %i20, %i12
  ret i64 0

cont:                                             ; preds = %i12
  br label %i13

cont3:                                            ; preds = %i20
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v5 = load i64, ptr %a1, align 8
  %call = call i64 @cons.0(ptr %0, i64 %a0.v4, i64 %a1.v5)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i21

cont9:                                            ; preds = %i23
  br label %i24
}

; Function Attrs: optsize
define private i64 @ap2.6(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %a2 = alloca i64, align 8
  store i64 %3, ptr %a2, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i26

i26:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i27

i27:                                              ; preds = %i26
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i28

i28:                                              ; preds = %i27
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r4, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a2, align 8
  br label %i35

i35:                                              ; preds = %i34
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i36:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i35
  ret i64 0

cont:                                             ; preds = %i35
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %a2.v3 = load i64, ptr %a2, align 8
  %call = call i64 @"$apply2.2"(ptr %0, i64 %a0.v1, i64 %a1.v2, i64 %a2.v3)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i36
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
  %a2 = alloca i64, align 8
  store i64 0, ptr %a2, align 8
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
  br label %i0

i0:                                               ; preds = %prologue
  br label %i7

i7:                                               ; preds = %i0
  br label %i25

i25:                                              ; preds = %i7
  br label %i37

i37:                                              ; preds = %i25
  store i64 1, ptr %r1, align 8
  br label %i38

i38:                                              ; preds = %i37
  store i64 2, ptr %r2, align 8
  br label %i39

i39:                                              ; preds = %i38
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i40

i40:                                              ; preds = %i39
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a1, align 8
  br label %i41

i41:                                              ; preds = %i40
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i42:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r0, align 8
  br label %i43

i43:                                              ; preds = %i42
  store i64 0, ptr %r7, align 8
  br label %i44

i44:                                              ; preds = %i43
  store i64 0, ptr %r8, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r7.v, i64 %r8.v)
  store i64 %cons, ptr %r4, align 8
  %guard1 = call i64 @rt_faulted(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i46:                                              ; preds = %cont3
  store i64 3, ptr %r5, align 8
  br label %i47

i47:                                              ; preds = %i46
  store i64 4, ptr %r6, align 8
  br label %i48

i48:                                              ; preds = %i47
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a0, align 8
  br label %i49

i49:                                              ; preds = %i48
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a1, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a2, align 8
  br label %i51

i51:                                              ; preds = %i50
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i52:                                              ; preds = %cont6
  %rr.v10 = load i64, ptr %rr, align 8
  store i64 %rr.v10, ptr %r3, align 8
  br label %i53

i53:                                              ; preds = %i52
  %r0.v = load i64, ptr %r0, align 8
  %r3.v = load i64, ptr %r3, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r3.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i54

i54:                                              ; preds = %i53
  %rr.v11 = load i64, ptr %rr, align 8
  ret i64 %rr.v11

exit:                                             ; preds = %i51, %i45, %i41
  ret i64 0

cont:                                             ; preds = %i41
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @cons.0(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i42

cont3:                                            ; preds = %i45
  br label %i46

cont6:                                            ; preds = %i51
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v8 = load i64, ptr %a1, align 8
  %a2.v = load i64, ptr %a2, align 8
  %call9 = call i64 @ap2.6(ptr %0, i64 %a0.v7, i64 %a1.v8, i64 %a2.v)
  store i64 %call9, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i52
}

; Function Attrs: minsize optsize
define private i64 @cons.0(ptr %0, i64 %1, i64 %2) #1 {
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
  store i64 %r0.v, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %i3
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r2.v, i64 %r3.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i6

i6:                                               ; preds = %i5
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; No predecessors!
  ret i64 0
}

; Function Attrs: minsize optsize
define private i64 @"$apply2.2"(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %a2 = alloca i64, align 8
  store i64 %3, ptr %a2, align 8
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
  br label %i8

i8:                                               ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i9

i9:                                               ; preds = %i8
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i10

i10:                                              ; preds = %i9
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r5.v = load i64, ptr %r5, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r5.v)
  store i64 %head, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i13:                                              ; preds = %cont
  store i64 0, ptr %r6, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r4.v = load i64, ptr %r4, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp eq i64 %r4.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i22, label %i16

i16:                                              ; preds = %i15
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r7, align 8
  br label %i17

i17:                                              ; preds = %i16
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r8, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a0, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %a1, align 8
  br label %i20

i20:                                              ; preds = %i19
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i21:                                              ; preds = %cont3
  br label %i24

i22:                                              ; preds = %i15
  store i64 0, ptr %r9, align 8
  br label %i23

i23:                                              ; preds = %i22
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %rr, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i24:                                              ; preds = %cont9, %i21
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i23, %i20, %i12
  ret i64 0

cont:                                             ; preds = %i12
  br label %i13

cont3:                                            ; preds = %i20
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v5 = load i64, ptr %a1, align 8
  %call = call i64 @cons.0(ptr %0, i64 %a0.v4, i64 %a1.v5)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i21

cont9:                                            ; preds = %i23
  br label %i24
}

; Function Attrs: minsize optsize
define private i64 @ap2.6(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
prologue:
  %a0 = alloca i64, align 8
  store i64 %1, ptr %a0, align 8
  %a1 = alloca i64, align 8
  store i64 %2, ptr %a1, align 8
  %a2 = alloca i64, align 8
  store i64 %3, ptr %a2, align 8
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i26

i26:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i27

i27:                                              ; preds = %i26
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i28

i28:                                              ; preds = %i27
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r4, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i33

i33:                                              ; preds = %i32
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a2, align 8
  br label %i35

i35:                                              ; preds = %i34
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i36:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i35
  ret i64 0

cont:                                             ; preds = %i35
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %a2.v3 = load i64, ptr %a2, align 8
  %call = call i64 @"$apply2.2"(ptr %0, i64 %a0.v1, i64 %a1.v2, i64 %a2.v3)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i36
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
