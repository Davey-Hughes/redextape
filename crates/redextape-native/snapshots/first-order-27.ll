;; first-order-27
;; source:
;;   fn ap(f, x) { f(x) } let add = |y| |z| y + z; ap(ap(add, 4), 5)
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
  br label %i32

i32:                                              ; preds = %i0
  br label %i41

i41:                                              ; preds = %i32
  store i64 0, ptr %r1, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 0, ptr %r2, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r1.v, i64 %r2.v)
  store i64 %cons, ptr %r0, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i44:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i45

i45:                                              ; preds = %i44
  store i64 4, ptr %r6, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i48

i48:                                              ; preds = %i47
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i49:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r3, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 5, ptr %r4, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i54:                                              ; preds = %cont6
  %rr.v10 = load i64, ptr %rr, align 8
  ret i64 %rr.v10

exit:                                             ; preds = %i53, %i48, %i43
  ret i64 0

cont:                                             ; preds = %i43
  br label %i44

cont3:                                            ; preds = %i48
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.6(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i49

cont6:                                            ; preds = %i53
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v8 = load i64, ptr %a1, align 8
  %call9 = call i64 @ap.6(ptr %0, i64 %a0.v7, i64 %a1.v8)
  store i64 %call9, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
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
  store i64 1, ptr %r5, align 8
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
  br i1 %jz, label %i17, label %i8

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
  store i64 %r8.v, ptr %r11, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r12, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r11.v = load i64, ptr %r11, align 8
  %r12.v = load i64, ptr %r12, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r12.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15
  br label %i31

i17:                                              ; preds = %i7
  %r0.v9 = load i64, ptr %r0, align 8
  store i64 %r0.v9, ptr %r15, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r15.v = load i64, ptr %r15, align 8
  %head10 = call i64 @rt_head(ptr %0, i64 %r15.v)
  store i64 %head10, ptr %r14, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i19:                                              ; preds = %cont13
  store i64 0, ptr %r16, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r14.v = load i64, ptr %r14, align 8
  %r16.v = load i64, ptr %r16, align 8
  %cmp14 = icmp eq i64 %r14.v, %r16.v
  %cmpw15 = zext i1 %cmp14 to i64
  store i64 %cmpw15, ptr %r13, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r13.v = load i64, ptr %r13, align 8
  %jz16 = icmp eq i64 %r13.v, 0
  br i1 %jz16, label %i29, label %i22

i22:                                              ; preds = %i21
  %r1.v17 = load i64, ptr %r1, align 8
  store i64 %r1.v17, ptr %r17, align 8
  br label %i23

i23:                                              ; preds = %i22
  store i64 1, ptr %r18, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r17.v = load i64, ptr %r17, align 8
  store i64 %r17.v, ptr %r20, align 8
  br label %i25

i25:                                              ; preds = %i24
  store i64 0, ptr %r21, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r20.v = load i64, ptr %r20, align 8
  %r21.v = load i64, ptr %r21, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r20.v, i64 %r21.v)
  store i64 %cons, ptr %r19, align 8
  %guard18 = call i64 @rt_faulted(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i27:                                              ; preds = %cont20
  %r18.v = load i64, ptr %r18, align 8
  %r19.v = load i64, ptr %r19, align 8
  %cons21 = call i64 @rt_cons(ptr %0, i64 %r18.v, i64 %r19.v)
  store i64 %cons21, ptr %rr, align 8
  %guard22 = call i64 @rt_faulted(ptr %0)
  %trip23 = icmp ne i64 %guard22, 0
  br i1 %trip23, label %exit, label %cont24

i28:                                              ; preds = %cont24
  br label %i31

i29:                                              ; preds = %i21
  store i64 0, ptr %r22, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r22.v = load i64, ptr %r22, align 8
  %head25 = call i64 @rt_head(ptr %0, i64 %r22.v)
  store i64 %head25, ptr %rr, align 8
  %guard26 = call i64 @rt_faulted(ptr %0)
  %trip27 = icmp ne i64 %guard26, 0
  br i1 %trip27, label %exit, label %cont28

i31:                                              ; preds = %cont28, %i28, %i16
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i30, %i27, %i26, %i18, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont13:                                           ; preds = %i18
  br label %i19

cont20:                                           ; preds = %i26
  br label %i27

cont24:                                           ; preds = %i27
  br label %i28

cont28:                                           ; preds = %i30
  br label %i31
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
  br label %i33

i33:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i34

i34:                                              ; preds = %i33
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i39

i39:                                              ; preds = %i38
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i40:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i39
  ret i64 0

cont:                                             ; preds = %i39
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i40
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
  br label %i32

i32:                                              ; preds = %i0
  br label %i41

i41:                                              ; preds = %i32
  store i64 0, ptr %r1, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 0, ptr %r2, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r1.v, i64 %r2.v)
  store i64 %cons, ptr %r0, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i44:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i45

i45:                                              ; preds = %i44
  store i64 4, ptr %r6, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i48

i48:                                              ; preds = %i47
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i49:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r3, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 5, ptr %r4, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i54:                                              ; preds = %cont6
  %rr.v10 = load i64, ptr %rr, align 8
  ret i64 %rr.v10

exit:                                             ; preds = %i53, %i48, %i43
  ret i64 0

cont:                                             ; preds = %i43
  br label %i44

cont3:                                            ; preds = %i48
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.6(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i49

cont6:                                            ; preds = %i53
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v8 = load i64, ptr %a1, align 8
  %call9 = call i64 @ap.6(ptr %0, i64 %a0.v7, i64 %a1.v8)
  store i64 %call9, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
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
  store i64 1, ptr %r5, align 8
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
  br i1 %jz, label %i17, label %i8

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
  store i64 %r8.v, ptr %r11, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r12, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r11.v = load i64, ptr %r11, align 8
  %r12.v = load i64, ptr %r12, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r12.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15
  br label %i31

i17:                                              ; preds = %i7
  %r0.v9 = load i64, ptr %r0, align 8
  store i64 %r0.v9, ptr %r15, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r15.v = load i64, ptr %r15, align 8
  %head10 = call i64 @rt_head(ptr %0, i64 %r15.v)
  store i64 %head10, ptr %r14, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i19:                                              ; preds = %cont13
  store i64 0, ptr %r16, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r14.v = load i64, ptr %r14, align 8
  %r16.v = load i64, ptr %r16, align 8
  %cmp14 = icmp eq i64 %r14.v, %r16.v
  %cmpw15 = zext i1 %cmp14 to i64
  store i64 %cmpw15, ptr %r13, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r13.v = load i64, ptr %r13, align 8
  %jz16 = icmp eq i64 %r13.v, 0
  br i1 %jz16, label %i29, label %i22

i22:                                              ; preds = %i21
  %r1.v17 = load i64, ptr %r1, align 8
  store i64 %r1.v17, ptr %r17, align 8
  br label %i23

i23:                                              ; preds = %i22
  store i64 1, ptr %r18, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r17.v = load i64, ptr %r17, align 8
  store i64 %r17.v, ptr %r20, align 8
  br label %i25

i25:                                              ; preds = %i24
  store i64 0, ptr %r21, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r20.v = load i64, ptr %r20, align 8
  %r21.v = load i64, ptr %r21, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r20.v, i64 %r21.v)
  store i64 %cons, ptr %r19, align 8
  %guard18 = call i64 @rt_faulted(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i27:                                              ; preds = %cont20
  %r18.v = load i64, ptr %r18, align 8
  %r19.v = load i64, ptr %r19, align 8
  %cons21 = call i64 @rt_cons(ptr %0, i64 %r18.v, i64 %r19.v)
  store i64 %cons21, ptr %rr, align 8
  %guard22 = call i64 @rt_faulted(ptr %0)
  %trip23 = icmp ne i64 %guard22, 0
  br i1 %trip23, label %exit, label %cont24

i28:                                              ; preds = %cont24
  br label %i31

i29:                                              ; preds = %i21
  store i64 0, ptr %r22, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r22.v = load i64, ptr %r22, align 8
  %head25 = call i64 @rt_head(ptr %0, i64 %r22.v)
  store i64 %head25, ptr %rr, align 8
  %guard26 = call i64 @rt_faulted(ptr %0)
  %trip27 = icmp ne i64 %guard26, 0
  br i1 %trip27, label %exit, label %cont28

i31:                                              ; preds = %cont28, %i28, %i16
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i30, %i27, %i26, %i18, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont13:                                           ; preds = %i18
  br label %i19

cont20:                                           ; preds = %i26
  br label %i27

cont24:                                           ; preds = %i27
  br label %i28

cont28:                                           ; preds = %i30
  br label %i31
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
  br label %i33

i33:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i34

i34:                                              ; preds = %i33
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i39

i39:                                              ; preds = %i38
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i40:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i39
  ret i64 0

cont:                                             ; preds = %i39
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i40
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
  br label %i32

i32:                                              ; preds = %i0
  br label %i41

i41:                                              ; preds = %i32
  store i64 0, ptr %r1, align 8
  br label %i42

i42:                                              ; preds = %i41
  store i64 0, ptr %r2, align 8
  br label %i43

i43:                                              ; preds = %i42
  %r1.v = load i64, ptr %r1, align 8
  %r2.v = load i64, ptr %r2, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r1.v, i64 %r2.v)
  store i64 %cons, ptr %r0, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i44:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i45

i45:                                              ; preds = %i44
  store i64 4, ptr %r6, align 8
  br label %i46

i46:                                              ; preds = %i45
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i48

i48:                                              ; preds = %i47
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i49:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r3, align 8
  br label %i50

i50:                                              ; preds = %i49
  store i64 5, ptr %r4, align 8
  br label %i51

i51:                                              ; preds = %i50
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i52

i52:                                              ; preds = %i51
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i53

i53:                                              ; preds = %i52
  %guard4 = call i64 @rt_enter(ptr %0)
  %trip5 = icmp ne i64 %guard4, 0
  br i1 %trip5, label %exit, label %cont6

i54:                                              ; preds = %cont6
  %rr.v10 = load i64, ptr %rr, align 8
  ret i64 %rr.v10

exit:                                             ; preds = %i53, %i48, %i43
  ret i64 0

cont:                                             ; preds = %i43
  br label %i44

cont3:                                            ; preds = %i48
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.6(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i49

cont6:                                            ; preds = %i53
  %a0.v7 = load i64, ptr %a0, align 8
  %a1.v8 = load i64, ptr %a1, align 8
  %call9 = call i64 @ap.6(ptr %0, i64 %a0.v7, i64 %a1.v8)
  store i64 %call9, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54
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
  store i64 1, ptr %r5, align 8
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
  br i1 %jz, label %i17, label %i8

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
  store i64 %r8.v, ptr %r11, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r12, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r11.v = load i64, ptr %r11, align 8
  %r12.v = load i64, ptr %r12, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r12.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15
  br label %i31

i17:                                              ; preds = %i7
  %r0.v9 = load i64, ptr %r0, align 8
  store i64 %r0.v9, ptr %r15, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r15.v = load i64, ptr %r15, align 8
  %head10 = call i64 @rt_head(ptr %0, i64 %r15.v)
  store i64 %head10, ptr %r14, align 8
  %guard11 = call i64 @rt_faulted(ptr %0)
  %trip12 = icmp ne i64 %guard11, 0
  br i1 %trip12, label %exit, label %cont13

i19:                                              ; preds = %cont13
  store i64 0, ptr %r16, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r14.v = load i64, ptr %r14, align 8
  %r16.v = load i64, ptr %r16, align 8
  %cmp14 = icmp eq i64 %r14.v, %r16.v
  %cmpw15 = zext i1 %cmp14 to i64
  store i64 %cmpw15, ptr %r13, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r13.v = load i64, ptr %r13, align 8
  %jz16 = icmp eq i64 %r13.v, 0
  br i1 %jz16, label %i29, label %i22

i22:                                              ; preds = %i21
  %r1.v17 = load i64, ptr %r1, align 8
  store i64 %r1.v17, ptr %r17, align 8
  br label %i23

i23:                                              ; preds = %i22
  store i64 1, ptr %r18, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r17.v = load i64, ptr %r17, align 8
  store i64 %r17.v, ptr %r20, align 8
  br label %i25

i25:                                              ; preds = %i24
  store i64 0, ptr %r21, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r20.v = load i64, ptr %r20, align 8
  %r21.v = load i64, ptr %r21, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r20.v, i64 %r21.v)
  store i64 %cons, ptr %r19, align 8
  %guard18 = call i64 @rt_faulted(ptr %0)
  %trip19 = icmp ne i64 %guard18, 0
  br i1 %trip19, label %exit, label %cont20

i27:                                              ; preds = %cont20
  %r18.v = load i64, ptr %r18, align 8
  %r19.v = load i64, ptr %r19, align 8
  %cons21 = call i64 @rt_cons(ptr %0, i64 %r18.v, i64 %r19.v)
  store i64 %cons21, ptr %rr, align 8
  %guard22 = call i64 @rt_faulted(ptr %0)
  %trip23 = icmp ne i64 %guard22, 0
  br i1 %trip23, label %exit, label %cont24

i28:                                              ; preds = %cont24
  br label %i31

i29:                                              ; preds = %i21
  store i64 0, ptr %r22, align 8
  br label %i30

i30:                                              ; preds = %i29
  %r22.v = load i64, ptr %r22, align 8
  %head25 = call i64 @rt_head(ptr %0, i64 %r22.v)
  store i64 %head25, ptr %rr, align 8
  %guard26 = call i64 @rt_faulted(ptr %0)
  %trip27 = icmp ne i64 %guard26, 0
  br i1 %trip27, label %exit, label %cont28

i31:                                              ; preds = %cont28, %i28, %i16
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i30, %i27, %i26, %i18, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont13:                                           ; preds = %i18
  br label %i19

cont20:                                           ; preds = %i26
  br label %i27

cont24:                                           ; preds = %i27
  br label %i28

cont28:                                           ; preds = %i30
  br label %i31
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
  br label %i33

i33:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i34

i34:                                              ; preds = %i33
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i37

i37:                                              ; preds = %i36
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i39

i39:                                              ; preds = %i38
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i40:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i39
  ret i64 0

cont:                                             ; preds = %i39
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i40
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
