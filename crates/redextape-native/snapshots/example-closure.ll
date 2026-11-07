;; example-closure
;; source:
;;   let n = 2;
;;   let add_n = |x| x + n;
;;   add_n(40)
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i20

i20:                                              ; preds = %i0
  store i64 2, ptr %r0, align 8
  br label %i21

i21:                                              ; preds = %i20
  store i64 0, ptr %r2, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i23

i23:                                              ; preds = %i22
  store i64 0, ptr %r5, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i25:                                              ; preds = %cont
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r2.v, i64 %r3.v)
  store i64 %cons1, ptr %r1, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i26:                                              ; preds = %cont4
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i27

i27:                                              ; preds = %i26
  store i64 40, ptr %r7, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a1, align 8
  br label %i30

i30:                                              ; preds = %i29
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i31:                                              ; preds = %cont7
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i30, %i25, %i24
  ret i64 0

cont:                                             ; preds = %i24
  br label %i25

cont4:                                            ; preds = %i25
  br label %i26

cont7:                                            ; preds = %i30
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i31
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
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r11, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %r12, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r11.v = load i64, ptr %r11, align 8
  %r12.v = load i64, ptr %r12, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r12.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15
  br label %i19

i17:                                              ; preds = %i7
  store i64 0, ptr %r13, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r13.v = load i64, ptr %r13, align 8
  %head9 = call i64 @rt_head(ptr %0, i64 %r13.v)
  store i64 %head9, ptr %rr, align 8
  %guard10 = call i64 @rt_faulted(ptr %0)
  %trip11 = icmp ne i64 %guard10, 0
  br i1 %trip11, label %exit, label %cont12

i19:                                              ; preds = %cont12, %i16
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i18, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont12:                                           ; preds = %i18
  br label %i19
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i20

i20:                                              ; preds = %i0
  store i64 2, ptr %r0, align 8
  br label %i21

i21:                                              ; preds = %i20
  store i64 0, ptr %r2, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i23

i23:                                              ; preds = %i22
  store i64 0, ptr %r5, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i25:                                              ; preds = %cont
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r2.v, i64 %r3.v)
  store i64 %cons1, ptr %r1, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i26:                                              ; preds = %cont4
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i27

i27:                                              ; preds = %i26
  store i64 40, ptr %r7, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a1, align 8
  br label %i30

i30:                                              ; preds = %i29
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i31:                                              ; preds = %cont7
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i30, %i25, %i24
  ret i64 0

cont:                                             ; preds = %i24
  br label %i25

cont4:                                            ; preds = %i25
  br label %i26

cont7:                                            ; preds = %i30
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i31
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
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r11, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %r12, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r11.v = load i64, ptr %r11, align 8
  %r12.v = load i64, ptr %r12, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r12.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15
  br label %i19

i17:                                              ; preds = %i7
  store i64 0, ptr %r13, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r13.v = load i64, ptr %r13, align 8
  %head9 = call i64 @rt_head(ptr %0, i64 %r13.v)
  store i64 %head9, ptr %rr, align 8
  %guard10 = call i64 @rt_faulted(ptr %0)
  %trip11 = icmp ne i64 %guard10, 0
  br i1 %trip11, label %exit, label %cont12

i19:                                              ; preds = %cont12, %i16
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i18, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont12:                                           ; preds = %i18
  br label %i19
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
  %rr = alloca i64, align 8
  store i64 0, ptr %rr, align 8
  br label %i0

i0:                                               ; preds = %prologue
  br label %i20

i20:                                              ; preds = %i0
  store i64 2, ptr %r0, align 8
  br label %i21

i21:                                              ; preds = %i20
  store i64 0, ptr %r2, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r4, align 8
  br label %i23

i23:                                              ; preds = %i22
  store i64 0, ptr %r5, align 8
  br label %i24

i24:                                              ; preds = %i23
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons, ptr %r3, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i25:                                              ; preds = %cont
  %r2.v = load i64, ptr %r2, align 8
  %r3.v = load i64, ptr %r3, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r2.v, i64 %r3.v)
  store i64 %cons1, ptr %r1, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i26:                                              ; preds = %cont4
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r6, align 8
  br label %i27

i27:                                              ; preds = %i26
  store i64 40, ptr %r7, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a0, align 8
  br label %i29

i29:                                              ; preds = %i28
  %r7.v = load i64, ptr %r7, align 8
  store i64 %r7.v, ptr %a1, align 8
  br label %i30

i30:                                              ; preds = %i29
  %guard5 = call i64 @rt_enter(ptr %0)
  %trip6 = icmp ne i64 %guard5, 0
  br i1 %trip6, label %exit, label %cont7

i31:                                              ; preds = %cont7
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i30, %i25, %i24
  ret i64 0

cont:                                             ; preds = %i24
  br label %i25

cont4:                                            ; preds = %i25
  br label %i26

cont7:                                            ; preds = %i30
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i31
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
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %r11, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r8.v = load i64, ptr %r8, align 8
  store i64 %r8.v, ptr %r12, align 8
  br label %i15

i15:                                              ; preds = %i14
  %r11.v = load i64, ptr %r11, align 8
  %r12.v = load i64, ptr %r12, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r11.v, i64 %r12.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i16

i16:                                              ; preds = %i15
  br label %i19

i17:                                              ; preds = %i7
  store i64 0, ptr %r13, align 8
  br label %i18

i18:                                              ; preds = %i17
  %r13.v = load i64, ptr %r13, align 8
  %head9 = call i64 @rt_head(ptr %0, i64 %r13.v)
  store i64 %head9, ptr %rr, align 8
  %guard10 = call i64 @rt_faulted(ptr %0)
  %trip11 = icmp ne i64 %guard10, 0
  br i1 %trip11, label %exit, label %cont12

i19:                                              ; preds = %cont12, %i16
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i18, %i11, %i9, %i4
  ret i64 0

cont:                                             ; preds = %i4
  br label %i5

cont4:                                            ; preds = %i9
  br label %i10

cont8:                                            ; preds = %i11
  br label %i12

cont12:                                           ; preds = %i18
  br label %i19
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
