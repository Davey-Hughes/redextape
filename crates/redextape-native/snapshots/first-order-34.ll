;; first-order-34
;; source:
;;   fn ap(h,x){ h(x) } fn f(n){ ap(g, n) } fn g(n){ n + 1 } f(3)
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
  br label %i16

i16:                                              ; preds = %i0
  br label %i25

i25:                                              ; preds = %i16
  br label %i35

i35:                                              ; preds = %i25
  store i64 3, ptr %r0, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i38:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i37
  ret i64 0

cont:                                             ; preds = %i37
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @f.6(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i38
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
  br i1 %jz, label %i13, label %i8

i8:                                               ; preds = %i7
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r7, align 8
  br label %i10

i10:                                              ; preds = %i9
  store i64 1, ptr %r8, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i12

i12:                                              ; preds = %i11
  br label %i15

i13:                                              ; preds = %i7
  store i64 0, ptr %r9, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r9.v = load i64, ptr %r9, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i15:                                              ; preds = %cont4, %i12
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i14, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i14
  br label %i15
}

define private i64 @ap.4(ptr %0, i64 %1, i64 %2) {
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
  br label %i17

i17:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i18

i18:                                              ; preds = %i17
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i23

i23:                                              ; preds = %i22
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i24:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i23
  ret i64 0

cont:                                             ; preds = %i23
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i24
}

define private i64 @f.6(ptr %0, i64 %1) {
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i26

i26:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i27

i27:                                              ; preds = %i26
  store i64 0, ptr %r3, align 8
  br label %i28

i28:                                              ; preds = %i27
  store i64 0, ptr %r4, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r3.v, i64 %r4.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a1, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i34:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i29
  ret i64 0

cont:                                             ; preds = %i29
  br label %i30

cont3:                                            ; preds = %i33
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.4(ptr %0, i64 %a0.v4, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34
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
  br label %i16

i16:                                              ; preds = %i0
  br label %i25

i25:                                              ; preds = %i16
  br label %i35

i35:                                              ; preds = %i25
  store i64 3, ptr %r0, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i38:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i37
  ret i64 0

cont:                                             ; preds = %i37
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @f.6(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i38
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
  br i1 %jz, label %i13, label %i8

i8:                                               ; preds = %i7
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r7, align 8
  br label %i10

i10:                                              ; preds = %i9
  store i64 1, ptr %r8, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i12

i12:                                              ; preds = %i11
  br label %i15

i13:                                              ; preds = %i7
  store i64 0, ptr %r9, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r9.v = load i64, ptr %r9, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i15:                                              ; preds = %cont4, %i12
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i14, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i14
  br label %i15
}

; Function Attrs: optsize
define private i64 @ap.4(ptr %0, i64 %1, i64 %2) #1 {
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
  br label %i17

i17:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i18

i18:                                              ; preds = %i17
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i23

i23:                                              ; preds = %i22
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i24:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i23
  ret i64 0

cont:                                             ; preds = %i23
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i24
}

; Function Attrs: optsize
define private i64 @f.6(ptr %0, i64 %1) #1 {
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i26

i26:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i27

i27:                                              ; preds = %i26
  store i64 0, ptr %r3, align 8
  br label %i28

i28:                                              ; preds = %i27
  store i64 0, ptr %r4, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r3.v, i64 %r4.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a1, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i34:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i29
  ret i64 0

cont:                                             ; preds = %i29
  br label %i30

cont3:                                            ; preds = %i33
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.4(ptr %0, i64 %a0.v4, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34
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
  br label %i16

i16:                                              ; preds = %i0
  br label %i25

i25:                                              ; preds = %i16
  br label %i35

i35:                                              ; preds = %i25
  store i64 3, ptr %r0, align 8
  br label %i36

i36:                                              ; preds = %i35
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
  br label %i37

i37:                                              ; preds = %i36
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i38:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i37
  ret i64 0

cont:                                             ; preds = %i37
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @f.6(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i38
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
  br i1 %jz, label %i13, label %i8

i8:                                               ; preds = %i7
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %r7, align 8
  br label %i10

i10:                                              ; preds = %i9
  store i64 1, ptr %r8, align 8
  br label %i11

i11:                                              ; preds = %i10
  %r7.v = load i64, ptr %r7, align 8
  %r8.v = load i64, ptr %r8, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r7.v, i64 %r8.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i12

i12:                                              ; preds = %i11
  br label %i15

i13:                                              ; preds = %i7
  store i64 0, ptr %r9, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r9.v = load i64, ptr %r9, align 8
  %head1 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head1, ptr %rr, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i15:                                              ; preds = %cont4, %i12
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i14, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i14
  br label %i15
}

; Function Attrs: minsize optsize
define private i64 @ap.4(ptr %0, i64 %1, i64 %2) #1 {
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
  br label %i17

i17:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i18

i18:                                              ; preds = %i17
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r3, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i23

i23:                                              ; preds = %i22
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i24:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i23
  ret i64 0

cont:                                             ; preds = %i23
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v1, i64 %a1.v2)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i24
}

; Function Attrs: minsize optsize
define private i64 @f.6(ptr %0, i64 %1) #1 {
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i26

i26:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i27

i27:                                              ; preds = %i26
  store i64 0, ptr %r3, align 8
  br label %i28

i28:                                              ; preds = %i27
  store i64 0, ptr %r4, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r3.v = load i64, ptr %r3, align 8
  %r4.v = load i64, ptr %r4, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r3.v, i64 %r4.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i30:                                              ; preds = %cont
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r2, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %a0, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a1, align 8
  br label %i33

i33:                                              ; preds = %i32
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i34:                                              ; preds = %cont3
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i33, %i29
  ret i64 0

cont:                                             ; preds = %i29
  br label %i30

cont3:                                            ; preds = %i33
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @ap.4(ptr %0, i64 %a0.v4, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i34
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
