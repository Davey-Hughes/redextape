;; example-countdown
;; source:
;;   fn countdown(n) {
;;       let mut xs = nil;
;;       let mut i = 1;
;;       while i <= n {
;;           xs = cons(i, xs);
;;           i = i + 1;
;;       }
;;       xs
;;   }
;;
;;   countdown(4)
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
  store i64 4, ptr %r0, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
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
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @countdown.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i24
}

define private i64 @countdown.0(ptr %0, i64 %1) {
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
  store i64 0, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 1, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %cont5, %i3
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r6, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp ule i64 %r5.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r4, align 8
  br label %i7

i7:                                               ; preds = %i6
  %r4.v = load i64, ptr %r4, align 8
  %jz = icmp eq i64 %r4.v, 0
  br i1 %jz, label %i18, label %i8

i8:                                               ; preds = %i7
  %r2.v1 = load i64, ptr %r2, align 8
  store i64 %r2.v1, ptr %r9, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r10, align 8
  br label %i10

i10:                                              ; preds = %i9
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i11:                                              ; preds = %cont
  store i64 0, ptr %r8, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r2.v2 = load i64, ptr %r2, align 8
  store i64 %r2.v2, ptr %r12, align 8
  br label %i13

i13:                                              ; preds = %i12
  store i64 1, ptr %r13, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r12.v, i64 %r13.v)
  store i64 %sadd, ptr %r2, align 8
  br label %i15

i15:                                              ; preds = %i14
  store i64 0, ptr %r11, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 0, ptr %r7, align 8
  br label %i17

i17:                                              ; preds = %i16
  %guard3 = call i64 @rt_tick(ptr %0)
  %trip4 = icmp ne i64 %guard3, 0
  br i1 %trip4, label %exit, label %cont5

i18:                                              ; preds = %i7
  store i64 0, ptr %r3, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r1.v6 = load i64, ptr %r1, align 8
  store i64 %r1.v6, ptr %rr, align 8
  br label %i20

i20:                                              ; preds = %i19
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i17, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont5:                                            ; preds = %i17
  br label %i4
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
  store i64 4, ptr %r0, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
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
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @countdown.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i24
}

; Function Attrs: optsize
define private i64 @countdown.0(ptr %0, i64 %1) #1 {
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
  store i64 0, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 1, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %cont5, %i3
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r6, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp ule i64 %r5.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r4, align 8
  br label %i7

i7:                                               ; preds = %i6
  %r4.v = load i64, ptr %r4, align 8
  %jz = icmp eq i64 %r4.v, 0
  br i1 %jz, label %i18, label %i8

i8:                                               ; preds = %i7
  %r2.v1 = load i64, ptr %r2, align 8
  store i64 %r2.v1, ptr %r9, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r10, align 8
  br label %i10

i10:                                              ; preds = %i9
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i11:                                              ; preds = %cont
  store i64 0, ptr %r8, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r2.v2 = load i64, ptr %r2, align 8
  store i64 %r2.v2, ptr %r12, align 8
  br label %i13

i13:                                              ; preds = %i12
  store i64 1, ptr %r13, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r12.v, i64 %r13.v)
  store i64 %sadd, ptr %r2, align 8
  br label %i15

i15:                                              ; preds = %i14
  store i64 0, ptr %r11, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 0, ptr %r7, align 8
  br label %i17

i17:                                              ; preds = %i16
  %guard3 = call i64 @rt_tick(ptr %0)
  %trip4 = icmp ne i64 %guard3, 0
  br i1 %trip4, label %exit, label %cont5

i18:                                              ; preds = %i7
  store i64 0, ptr %r3, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r1.v6 = load i64, ptr %r1, align 8
  store i64 %r1.v6, ptr %rr, align 8
  br label %i20

i20:                                              ; preds = %i19
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i17, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont5:                                            ; preds = %i17
  br label %i4
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
  store i64 4, ptr %r0, align 8
  br label %i22

i22:                                              ; preds = %i21
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %a0, align 8
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
  %a0.v = load i64, ptr %a0, align 8
  %call = call i64 @countdown.0(ptr %0, i64 %a0.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i24
}

; Function Attrs: minsize optsize
define private i64 @countdown.0(ptr %0, i64 %1) #1 {
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
  store i64 0, ptr %r1, align 8
  br label %i3

i3:                                               ; preds = %i2
  store i64 1, ptr %r2, align 8
  br label %i4

i4:                                               ; preds = %cont5, %i3
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i5

i5:                                               ; preds = %i4
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r6, align 8
  br label %i6

i6:                                               ; preds = %i5
  %r5.v = load i64, ptr %r5, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp ule i64 %r5.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r4, align 8
  br label %i7

i7:                                               ; preds = %i6
  %r4.v = load i64, ptr %r4, align 8
  %jz = icmp eq i64 %r4.v, 0
  br i1 %jz, label %i18, label %i8

i8:                                               ; preds = %i7
  %r2.v1 = load i64, ptr %r2, align 8
  store i64 %r2.v1, ptr %r9, align 8
  br label %i9

i9:                                               ; preds = %i8
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r10, align 8
  br label %i10

i10:                                              ; preds = %i9
  %r9.v = load i64, ptr %r9, align 8
  %r10.v = load i64, ptr %r10, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r9.v, i64 %r10.v)
  store i64 %cons, ptr %r1, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i11:                                              ; preds = %cont
  store i64 0, ptr %r8, align 8
  br label %i12

i12:                                              ; preds = %i11
  %r2.v2 = load i64, ptr %r2, align 8
  store i64 %r2.v2, ptr %r12, align 8
  br label %i13

i13:                                              ; preds = %i12
  store i64 1, ptr %r13, align 8
  br label %i14

i14:                                              ; preds = %i13
  %r12.v = load i64, ptr %r12, align 8
  %r13.v = load i64, ptr %r13, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r12.v, i64 %r13.v)
  store i64 %sadd, ptr %r2, align 8
  br label %i15

i15:                                              ; preds = %i14
  store i64 0, ptr %r11, align 8
  br label %i16

i16:                                              ; preds = %i15
  store i64 0, ptr %r7, align 8
  br label %i17

i17:                                              ; preds = %i16
  %guard3 = call i64 @rt_tick(ptr %0)
  %trip4 = icmp ne i64 %guard3, 0
  br i1 %trip4, label %exit, label %cont5

i18:                                              ; preds = %i7
  store i64 0, ptr %r3, align 8
  br label %i19

i19:                                              ; preds = %i18
  %r1.v6 = load i64, ptr %r1, align 8
  store i64 %r1.v6, ptr %rr, align 8
  br label %i20

i20:                                              ; preds = %i19
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i17, %i10
  ret i64 0

cont:                                             ; preds = %i10
  br label %i11

cont5:                                            ; preds = %i17
  br label %i4
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
