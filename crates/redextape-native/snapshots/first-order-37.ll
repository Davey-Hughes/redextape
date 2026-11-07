;; first-order-37
;; source:
;;   fn map(xs, f) { if is_empty(xs) { nil } else { cons(f(head(xs)), map(tail(xs), f)) } }
;;   fn add1(x) { x + 1 }
;;   fn ap2(g, a, b) { g(a, b) }
;;   head(map([1, 2], add1)) + head(ap2(map, [5, 6], add1))
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
  br label %i0

i0:                                               ; preds = %prologue
  br label %i16

i16:                                              ; preds = %i0
  br label %i40

i40:                                              ; preds = %i16
  br label %i58

i58:                                              ; preds = %i40
  br label %i70

i70:                                              ; preds = %i58
  store i64 1, ptr %r4, align 8
  br label %i71

i71:                                              ; preds = %i70
  store i64 2, ptr %r6, align 8
  br label %i72

i72:                                              ; preds = %i71
  store i64 0, ptr %r7, align 8
  br label %i73

i73:                                              ; preds = %i72
  %r6.v = load i64, ptr %r6, align 8
  %r7.v = load i64, ptr %r7, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r6.v, i64 %r7.v)
  store i64 %cons, ptr %r5, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i74:                                              ; preds = %cont
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons1, ptr %r2, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i75:                                              ; preds = %cont4
  store i64 0, ptr %r8, align 8
  br label %i76

i76:                                              ; preds = %i75
  store i64 0, ptr %r9, align 8
  br label %i77

i77:                                              ; preds = %i76
  %r8.v = load i64, ptr %r8, align 8
  %r9.v = load i64, ptr %r9, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r8.v, i64 %r9.v)
  store i64 %cons5, ptr %r3, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i78:                                              ; preds = %cont8
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i79

i79:                                              ; preds = %i78
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i80

i80:                                              ; preds = %i79
  %guard9 = call i64 @rt_enter(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i81:                                              ; preds = %cont11
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r1, align 8
  br label %i82

i82:                                              ; preds = %i81
  %r1.v = load i64, ptr %r1, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r1.v)
  store i64 %head, ptr %r0, align 8
  %guard12 = call i64 @rt_faulted(ptr %0)
  %trip13 = icmp ne i64 %guard12, 0
  br i1 %trip13, label %exit, label %cont14

i83:                                              ; preds = %cont14
  store i64 0, ptr %r15, align 8
  br label %i84

i84:                                              ; preds = %i83
  store i64 0, ptr %r16, align 8
  br label %i85

i85:                                              ; preds = %i84
  %r15.v = load i64, ptr %r15, align 8
  %r16.v = load i64, ptr %r16, align 8
  %cons15 = call i64 @rt_cons(ptr %0, i64 %r15.v, i64 %r16.v)
  store i64 %cons15, ptr %r12, align 8
  %guard16 = call i64 @rt_faulted(ptr %0)
  %trip17 = icmp ne i64 %guard16, 0
  br i1 %trip17, label %exit, label %cont18

i86:                                              ; preds = %cont18
  store i64 5, ptr %r17, align 8
  br label %i87

i87:                                              ; preds = %i86
  store i64 6, ptr %r19, align 8
  br label %i88

i88:                                              ; preds = %i87
  store i64 0, ptr %r20, align 8
  br label %i89

i89:                                              ; preds = %i88
  %r19.v = load i64, ptr %r19, align 8
  %r20.v = load i64, ptr %r20, align 8
  %cons19 = call i64 @rt_cons(ptr %0, i64 %r19.v, i64 %r20.v)
  store i64 %cons19, ptr %r18, align 8
  %guard20 = call i64 @rt_faulted(ptr %0)
  %trip21 = icmp ne i64 %guard20, 0
  br i1 %trip21, label %exit, label %cont22

i90:                                              ; preds = %cont22
  %r17.v = load i64, ptr %r17, align 8
  %r18.v = load i64, ptr %r18, align 8
  %cons23 = call i64 @rt_cons(ptr %0, i64 %r17.v, i64 %r18.v)
  store i64 %cons23, ptr %r13, align 8
  %guard24 = call i64 @rt_faulted(ptr %0)
  %trip25 = icmp ne i64 %guard24, 0
  br i1 %trip25, label %exit, label %cont26

i91:                                              ; preds = %cont26
  store i64 0, ptr %r21, align 8
  br label %i92

i92:                                              ; preds = %i91
  store i64 0, ptr %r22, align 8
  br label %i93

i93:                                              ; preds = %i92
  %r21.v = load i64, ptr %r21, align 8
  %r22.v = load i64, ptr %r22, align 8
  %cons27 = call i64 @rt_cons(ptr %0, i64 %r21.v, i64 %r22.v)
  store i64 %cons27, ptr %r14, align 8
  %guard28 = call i64 @rt_faulted(ptr %0)
  %trip29 = icmp ne i64 %guard28, 0
  br i1 %trip29, label %exit, label %cont30

i94:                                              ; preds = %cont30
  %r12.v = load i64, ptr %r12, align 8
  store i64 %r12.v, ptr %a0, align 8
  br label %i95

i95:                                              ; preds = %i94
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %a1, align 8
  br label %i96

i96:                                              ; preds = %i95
  %r14.v = load i64, ptr %r14, align 8
  store i64 %r14.v, ptr %a2, align 8
  br label %i97

i97:                                              ; preds = %i96
  %guard31 = call i64 @rt_enter(ptr %0)
  %trip32 = icmp ne i64 %guard31, 0
  br i1 %trip32, label %exit, label %cont33

i98:                                              ; preds = %cont33
  %rr.v37 = load i64, ptr %rr, align 8
  store i64 %rr.v37, ptr %r11, align 8
  br label %i99

i99:                                              ; preds = %i98
  %r11.v = load i64, ptr %r11, align 8
  %head38 = call i64 @rt_head(ptr %0, i64 %r11.v)
  store i64 %head38, ptr %r10, align 8
  %guard39 = call i64 @rt_faulted(ptr %0)
  %trip40 = icmp ne i64 %guard39, 0
  br i1 %trip40, label %exit, label %cont41

i100:                                             ; preds = %cont41
  %r0.v = load i64, ptr %r0, align 8
  %r10.v = load i64, ptr %r10, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r10.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i101

i101:                                             ; preds = %i100
  %rr.v42 = load i64, ptr %rr, align 8
  ret i64 %rr.v42

exit:                                             ; preds = %i99, %i97, %i93, %i90, %i89, %i85, %i82, %i80, %i77, %i74, %i73
  ret i64 0

cont:                                             ; preds = %i73
  br label %i74

cont4:                                            ; preds = %i74
  br label %i75

cont8:                                            ; preds = %i77
  br label %i78

cont11:                                           ; preds = %i80
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @map.4(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i81

cont14:                                           ; preds = %i82
  br label %i83

cont18:                                           ; preds = %i85
  br label %i86

cont22:                                           ; preds = %i89
  br label %i90

cont26:                                           ; preds = %i90
  br label %i91

cont30:                                           ; preds = %i93
  br label %i94

cont33:                                           ; preds = %i97
  %a0.v34 = load i64, ptr %a0, align 8
  %a1.v35 = load i64, ptr %a1, align 8
  %a2.v = load i64, ptr %a2, align 8
  %call36 = call i64 @ap2.12(ptr %0, i64 %a0.v34, i64 %a1.v35, i64 %a2.v)
  store i64 %call36, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i98

cont41:                                           ; preds = %i99
  br label %i100
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

define private i64 @map.4(ptr %0, i64 %1, i64 %2) {
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
  store i64 %r0.v, ptr %r3, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r3.v = load i64, ptr %r3, align 8
  %isempty = call i64 @rt_is_empty(ptr %0, i64 %r3.v)
  store i64 %isempty, ptr %r2, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i24, label %i22

i22:                                              ; preds = %i21
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %i22
  br label %i39

i24:                                              ; preds = %i21
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r7.v = load i64, ptr %r7, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r7.v)
  store i64 %head, ptr %r6, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i27:                                              ; preds = %cont
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard2 = call i64 @rt_enter(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i30:                                              ; preds = %cont4
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r4, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r0.v7 = load i64, ptr %r0, align 8
  store i64 %r0.v7, ptr %r11, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r11.v = load i64, ptr %r11, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r11.v)
  store i64 %tail, ptr %r9, align 8
  %guard8 = call i64 @rt_faulted(ptr %0)
  %trip9 = icmp ne i64 %guard8, 0
  br i1 %trip9, label %exit, label %cont10

i33:                                              ; preds = %cont10
  %r1.v11 = load i64, ptr %r1, align 8
  store i64 %r1.v11, ptr %r10, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r9.v = load i64, ptr %r9, align 8
  store i64 %r9.v, ptr %a0, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %a1, align 8
  br label %i36

i36:                                              ; preds = %i35
  %guard12 = call i64 @rt_enter(ptr %0)
  %trip13 = icmp ne i64 %guard12, 0
  br i1 %trip13, label %exit, label %cont14

i37:                                              ; preds = %cont14
  %rr.v18 = load i64, ptr %rr, align 8
  store i64 %rr.v18, ptr %r8, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r4.v = load i64, ptr %r4, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r8.v)
  store i64 %cons, ptr %rr, align 8
  %guard19 = call i64 @rt_faulted(ptr %0)
  %trip20 = icmp ne i64 %guard19, 0
  br i1 %trip20, label %exit, label %cont21

i39:                                              ; preds = %cont21, %i23
  %rr.v22 = load i64, ptr %rr, align 8
  ret i64 %rr.v22

exit:                                             ; preds = %i38, %i36, %i32, %i29, %i26
  ret i64 0

cont:                                             ; preds = %i26
  br label %i27

cont4:                                            ; preds = %i29
  %a0.v5 = load i64, ptr %a0, align 8
  %a1.v6 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v5, i64 %a1.v6)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30

cont10:                                           ; preds = %i32
  br label %i33

cont14:                                           ; preds = %i36
  %a0.v15 = load i64, ptr %a0, align 8
  %a1.v16 = load i64, ptr %a1, align 8
  %call17 = call i64 @map.4(ptr %0, i64 %a0.v15, i64 %a1.v16)
  store i64 %call17, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i37

cont21:                                           ; preds = %i38
  br label %i39
}

define private i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) {
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
  br label %i41

i41:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i42

i42:                                              ; preds = %i41
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i43

i43:                                              ; preds = %i42
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r5.v = load i64, ptr %r5, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r5.v)
  store i64 %head, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  store i64 0, ptr %r6, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r4.v = load i64, ptr %r4, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp eq i64 %r4.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i48

i48:                                              ; preds = %i47
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i55, label %i49

i49:                                              ; preds = %i48
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r8, align 8
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
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i54:                                              ; preds = %cont3
  br label %i57

i55:                                              ; preds = %i48
  store i64 0, ptr %r9, align 8
  br label %i56

i56:                                              ; preds = %i55
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %rr, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i57:                                              ; preds = %cont9, %i54
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i56, %i53, %i45
  ret i64 0

cont:                                             ; preds = %i45
  br label %i46

cont3:                                            ; preds = %i53
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v5 = load i64, ptr %a1, align 8
  %call = call i64 @map.4(ptr %0, i64 %a0.v4, i64 %a1.v5)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54

cont9:                                            ; preds = %i56
  br label %i57
}

define private i64 @ap2.12(ptr %0, i64 %1, i64 %2, i64 %3) {
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
  br label %i59

i59:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i60

i60:                                              ; preds = %i59
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i61

i61:                                              ; preds = %i60
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i62

i62:                                              ; preds = %i61
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i63

i63:                                              ; preds = %i62
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r4, align 8
  br label %i64

i64:                                              ; preds = %i63
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i65

i65:                                              ; preds = %i64
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i66

i66:                                              ; preds = %i65
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i67

i67:                                              ; preds = %i66
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a2, align 8
  br label %i68

i68:                                              ; preds = %i67
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i69:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i68
  ret i64 0

cont:                                             ; preds = %i68
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %a2.v3 = load i64, ptr %a2, align 8
  %call = call i64 @"$apply2.8"(ptr %0, i64 %a0.v1, i64 %a1.v2, i64 %a2.v3)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i69
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
  br label %i0

i0:                                               ; preds = %prologue
  br label %i16

i16:                                              ; preds = %i0
  br label %i40

i40:                                              ; preds = %i16
  br label %i58

i58:                                              ; preds = %i40
  br label %i70

i70:                                              ; preds = %i58
  store i64 1, ptr %r4, align 8
  br label %i71

i71:                                              ; preds = %i70
  store i64 2, ptr %r6, align 8
  br label %i72

i72:                                              ; preds = %i71
  store i64 0, ptr %r7, align 8
  br label %i73

i73:                                              ; preds = %i72
  %r6.v = load i64, ptr %r6, align 8
  %r7.v = load i64, ptr %r7, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r6.v, i64 %r7.v)
  store i64 %cons, ptr %r5, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i74:                                              ; preds = %cont
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons1, ptr %r2, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i75:                                              ; preds = %cont4
  store i64 0, ptr %r8, align 8
  br label %i76

i76:                                              ; preds = %i75
  store i64 0, ptr %r9, align 8
  br label %i77

i77:                                              ; preds = %i76
  %r8.v = load i64, ptr %r8, align 8
  %r9.v = load i64, ptr %r9, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r8.v, i64 %r9.v)
  store i64 %cons5, ptr %r3, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i78:                                              ; preds = %cont8
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i79

i79:                                              ; preds = %i78
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i80

i80:                                              ; preds = %i79
  %guard9 = call i64 @rt_enter(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i81:                                              ; preds = %cont11
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r1, align 8
  br label %i82

i82:                                              ; preds = %i81
  %r1.v = load i64, ptr %r1, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r1.v)
  store i64 %head, ptr %r0, align 8
  %guard12 = call i64 @rt_faulted(ptr %0)
  %trip13 = icmp ne i64 %guard12, 0
  br i1 %trip13, label %exit, label %cont14

i83:                                              ; preds = %cont14
  store i64 0, ptr %r15, align 8
  br label %i84

i84:                                              ; preds = %i83
  store i64 0, ptr %r16, align 8
  br label %i85

i85:                                              ; preds = %i84
  %r15.v = load i64, ptr %r15, align 8
  %r16.v = load i64, ptr %r16, align 8
  %cons15 = call i64 @rt_cons(ptr %0, i64 %r15.v, i64 %r16.v)
  store i64 %cons15, ptr %r12, align 8
  %guard16 = call i64 @rt_faulted(ptr %0)
  %trip17 = icmp ne i64 %guard16, 0
  br i1 %trip17, label %exit, label %cont18

i86:                                              ; preds = %cont18
  store i64 5, ptr %r17, align 8
  br label %i87

i87:                                              ; preds = %i86
  store i64 6, ptr %r19, align 8
  br label %i88

i88:                                              ; preds = %i87
  store i64 0, ptr %r20, align 8
  br label %i89

i89:                                              ; preds = %i88
  %r19.v = load i64, ptr %r19, align 8
  %r20.v = load i64, ptr %r20, align 8
  %cons19 = call i64 @rt_cons(ptr %0, i64 %r19.v, i64 %r20.v)
  store i64 %cons19, ptr %r18, align 8
  %guard20 = call i64 @rt_faulted(ptr %0)
  %trip21 = icmp ne i64 %guard20, 0
  br i1 %trip21, label %exit, label %cont22

i90:                                              ; preds = %cont22
  %r17.v = load i64, ptr %r17, align 8
  %r18.v = load i64, ptr %r18, align 8
  %cons23 = call i64 @rt_cons(ptr %0, i64 %r17.v, i64 %r18.v)
  store i64 %cons23, ptr %r13, align 8
  %guard24 = call i64 @rt_faulted(ptr %0)
  %trip25 = icmp ne i64 %guard24, 0
  br i1 %trip25, label %exit, label %cont26

i91:                                              ; preds = %cont26
  store i64 0, ptr %r21, align 8
  br label %i92

i92:                                              ; preds = %i91
  store i64 0, ptr %r22, align 8
  br label %i93

i93:                                              ; preds = %i92
  %r21.v = load i64, ptr %r21, align 8
  %r22.v = load i64, ptr %r22, align 8
  %cons27 = call i64 @rt_cons(ptr %0, i64 %r21.v, i64 %r22.v)
  store i64 %cons27, ptr %r14, align 8
  %guard28 = call i64 @rt_faulted(ptr %0)
  %trip29 = icmp ne i64 %guard28, 0
  br i1 %trip29, label %exit, label %cont30

i94:                                              ; preds = %cont30
  %r12.v = load i64, ptr %r12, align 8
  store i64 %r12.v, ptr %a0, align 8
  br label %i95

i95:                                              ; preds = %i94
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %a1, align 8
  br label %i96

i96:                                              ; preds = %i95
  %r14.v = load i64, ptr %r14, align 8
  store i64 %r14.v, ptr %a2, align 8
  br label %i97

i97:                                              ; preds = %i96
  %guard31 = call i64 @rt_enter(ptr %0)
  %trip32 = icmp ne i64 %guard31, 0
  br i1 %trip32, label %exit, label %cont33

i98:                                              ; preds = %cont33
  %rr.v37 = load i64, ptr %rr, align 8
  store i64 %rr.v37, ptr %r11, align 8
  br label %i99

i99:                                              ; preds = %i98
  %r11.v = load i64, ptr %r11, align 8
  %head38 = call i64 @rt_head(ptr %0, i64 %r11.v)
  store i64 %head38, ptr %r10, align 8
  %guard39 = call i64 @rt_faulted(ptr %0)
  %trip40 = icmp ne i64 %guard39, 0
  br i1 %trip40, label %exit, label %cont41

i100:                                             ; preds = %cont41
  %r0.v = load i64, ptr %r0, align 8
  %r10.v = load i64, ptr %r10, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r10.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i101

i101:                                             ; preds = %i100
  %rr.v42 = load i64, ptr %rr, align 8
  ret i64 %rr.v42

exit:                                             ; preds = %i99, %i97, %i93, %i90, %i89, %i85, %i82, %i80, %i77, %i74, %i73
  ret i64 0

cont:                                             ; preds = %i73
  br label %i74

cont4:                                            ; preds = %i74
  br label %i75

cont8:                                            ; preds = %i77
  br label %i78

cont11:                                           ; preds = %i80
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @map.4(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i81

cont14:                                           ; preds = %i82
  br label %i83

cont18:                                           ; preds = %i85
  br label %i86

cont22:                                           ; preds = %i89
  br label %i90

cont26:                                           ; preds = %i90
  br label %i91

cont30:                                           ; preds = %i93
  br label %i94

cont33:                                           ; preds = %i97
  %a0.v34 = load i64, ptr %a0, align 8
  %a1.v35 = load i64, ptr %a1, align 8
  %a2.v = load i64, ptr %a2, align 8
  %call36 = call i64 @ap2.12(ptr %0, i64 %a0.v34, i64 %a1.v35, i64 %a2.v)
  store i64 %call36, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i98

cont41:                                           ; preds = %i99
  br label %i100
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
define private i64 @map.4(ptr %0, i64 %1, i64 %2) #1 {
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
  store i64 %r0.v, ptr %r3, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r3.v = load i64, ptr %r3, align 8
  %isempty = call i64 @rt_is_empty(ptr %0, i64 %r3.v)
  store i64 %isempty, ptr %r2, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i24, label %i22

i22:                                              ; preds = %i21
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %i22
  br label %i39

i24:                                              ; preds = %i21
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r7.v = load i64, ptr %r7, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r7.v)
  store i64 %head, ptr %r6, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i27:                                              ; preds = %cont
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard2 = call i64 @rt_enter(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i30:                                              ; preds = %cont4
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r4, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r0.v7 = load i64, ptr %r0, align 8
  store i64 %r0.v7, ptr %r11, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r11.v = load i64, ptr %r11, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r11.v)
  store i64 %tail, ptr %r9, align 8
  %guard8 = call i64 @rt_faulted(ptr %0)
  %trip9 = icmp ne i64 %guard8, 0
  br i1 %trip9, label %exit, label %cont10

i33:                                              ; preds = %cont10
  %r1.v11 = load i64, ptr %r1, align 8
  store i64 %r1.v11, ptr %r10, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r9.v = load i64, ptr %r9, align 8
  store i64 %r9.v, ptr %a0, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %a1, align 8
  br label %i36

i36:                                              ; preds = %i35
  %guard12 = call i64 @rt_enter(ptr %0)
  %trip13 = icmp ne i64 %guard12, 0
  br i1 %trip13, label %exit, label %cont14

i37:                                              ; preds = %cont14
  %rr.v18 = load i64, ptr %rr, align 8
  store i64 %rr.v18, ptr %r8, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r4.v = load i64, ptr %r4, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r8.v)
  store i64 %cons, ptr %rr, align 8
  %guard19 = call i64 @rt_faulted(ptr %0)
  %trip20 = icmp ne i64 %guard19, 0
  br i1 %trip20, label %exit, label %cont21

i39:                                              ; preds = %cont21, %i23
  %rr.v22 = load i64, ptr %rr, align 8
  ret i64 %rr.v22

exit:                                             ; preds = %i38, %i36, %i32, %i29, %i26
  ret i64 0

cont:                                             ; preds = %i26
  br label %i27

cont4:                                            ; preds = %i29
  %a0.v5 = load i64, ptr %a0, align 8
  %a1.v6 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v5, i64 %a1.v6)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30

cont10:                                           ; preds = %i32
  br label %i33

cont14:                                           ; preds = %i36
  %a0.v15 = load i64, ptr %a0, align 8
  %a1.v16 = load i64, ptr %a1, align 8
  %call17 = call i64 @map.4(ptr %0, i64 %a0.v15, i64 %a1.v16)
  store i64 %call17, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i37

cont21:                                           ; preds = %i38
  br label %i39
}

; Function Attrs: optsize
define private i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
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
  br label %i41

i41:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i42

i42:                                              ; preds = %i41
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i43

i43:                                              ; preds = %i42
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r5.v = load i64, ptr %r5, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r5.v)
  store i64 %head, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  store i64 0, ptr %r6, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r4.v = load i64, ptr %r4, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp eq i64 %r4.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i48

i48:                                              ; preds = %i47
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i55, label %i49

i49:                                              ; preds = %i48
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r8, align 8
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
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i54:                                              ; preds = %cont3
  br label %i57

i55:                                              ; preds = %i48
  store i64 0, ptr %r9, align 8
  br label %i56

i56:                                              ; preds = %i55
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %rr, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i57:                                              ; preds = %cont9, %i54
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i56, %i53, %i45
  ret i64 0

cont:                                             ; preds = %i45
  br label %i46

cont3:                                            ; preds = %i53
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v5 = load i64, ptr %a1, align 8
  %call = call i64 @map.4(ptr %0, i64 %a0.v4, i64 %a1.v5)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54

cont9:                                            ; preds = %i56
  br label %i57
}

; Function Attrs: optsize
define private i64 @ap2.12(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
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
  br label %i59

i59:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i60

i60:                                              ; preds = %i59
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i61

i61:                                              ; preds = %i60
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i62

i62:                                              ; preds = %i61
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i63

i63:                                              ; preds = %i62
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r4, align 8
  br label %i64

i64:                                              ; preds = %i63
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i65

i65:                                              ; preds = %i64
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i66

i66:                                              ; preds = %i65
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i67

i67:                                              ; preds = %i66
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a2, align 8
  br label %i68

i68:                                              ; preds = %i67
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i69:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i68
  ret i64 0

cont:                                             ; preds = %i68
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %a2.v3 = load i64, ptr %a2, align 8
  %call = call i64 @"$apply2.8"(ptr %0, i64 %a0.v1, i64 %a1.v2, i64 %a2.v3)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i69
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
  br label %i0

i0:                                               ; preds = %prologue
  br label %i16

i16:                                              ; preds = %i0
  br label %i40

i40:                                              ; preds = %i16
  br label %i58

i58:                                              ; preds = %i40
  br label %i70

i70:                                              ; preds = %i58
  store i64 1, ptr %r4, align 8
  br label %i71

i71:                                              ; preds = %i70
  store i64 2, ptr %r6, align 8
  br label %i72

i72:                                              ; preds = %i71
  store i64 0, ptr %r7, align 8
  br label %i73

i73:                                              ; preds = %i72
  %r6.v = load i64, ptr %r6, align 8
  %r7.v = load i64, ptr %r7, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r6.v, i64 %r7.v)
  store i64 %cons, ptr %r5, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i74:                                              ; preds = %cont
  %r4.v = load i64, ptr %r4, align 8
  %r5.v = load i64, ptr %r5, align 8
  %cons1 = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r5.v)
  store i64 %cons1, ptr %r2, align 8
  %guard2 = call i64 @rt_faulted(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i75:                                              ; preds = %cont4
  store i64 0, ptr %r8, align 8
  br label %i76

i76:                                              ; preds = %i75
  store i64 0, ptr %r9, align 8
  br label %i77

i77:                                              ; preds = %i76
  %r8.v = load i64, ptr %r8, align 8
  %r9.v = load i64, ptr %r9, align 8
  %cons5 = call i64 @rt_cons(ptr %0, i64 %r8.v, i64 %r9.v)
  store i64 %cons5, ptr %r3, align 8
  %guard6 = call i64 @rt_faulted(ptr %0)
  %trip7 = icmp ne i64 %guard6, 0
  br i1 %trip7, label %exit, label %cont8

i78:                                              ; preds = %cont8
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %a0, align 8
  br label %i79

i79:                                              ; preds = %i78
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a1, align 8
  br label %i80

i80:                                              ; preds = %i79
  %guard9 = call i64 @rt_enter(ptr %0)
  %trip10 = icmp ne i64 %guard9, 0
  br i1 %trip10, label %exit, label %cont11

i81:                                              ; preds = %cont11
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r1, align 8
  br label %i82

i82:                                              ; preds = %i81
  %r1.v = load i64, ptr %r1, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r1.v)
  store i64 %head, ptr %r0, align 8
  %guard12 = call i64 @rt_faulted(ptr %0)
  %trip13 = icmp ne i64 %guard12, 0
  br i1 %trip13, label %exit, label %cont14

i83:                                              ; preds = %cont14
  store i64 0, ptr %r15, align 8
  br label %i84

i84:                                              ; preds = %i83
  store i64 0, ptr %r16, align 8
  br label %i85

i85:                                              ; preds = %i84
  %r15.v = load i64, ptr %r15, align 8
  %r16.v = load i64, ptr %r16, align 8
  %cons15 = call i64 @rt_cons(ptr %0, i64 %r15.v, i64 %r16.v)
  store i64 %cons15, ptr %r12, align 8
  %guard16 = call i64 @rt_faulted(ptr %0)
  %trip17 = icmp ne i64 %guard16, 0
  br i1 %trip17, label %exit, label %cont18

i86:                                              ; preds = %cont18
  store i64 5, ptr %r17, align 8
  br label %i87

i87:                                              ; preds = %i86
  store i64 6, ptr %r19, align 8
  br label %i88

i88:                                              ; preds = %i87
  store i64 0, ptr %r20, align 8
  br label %i89

i89:                                              ; preds = %i88
  %r19.v = load i64, ptr %r19, align 8
  %r20.v = load i64, ptr %r20, align 8
  %cons19 = call i64 @rt_cons(ptr %0, i64 %r19.v, i64 %r20.v)
  store i64 %cons19, ptr %r18, align 8
  %guard20 = call i64 @rt_faulted(ptr %0)
  %trip21 = icmp ne i64 %guard20, 0
  br i1 %trip21, label %exit, label %cont22

i90:                                              ; preds = %cont22
  %r17.v = load i64, ptr %r17, align 8
  %r18.v = load i64, ptr %r18, align 8
  %cons23 = call i64 @rt_cons(ptr %0, i64 %r17.v, i64 %r18.v)
  store i64 %cons23, ptr %r13, align 8
  %guard24 = call i64 @rt_faulted(ptr %0)
  %trip25 = icmp ne i64 %guard24, 0
  br i1 %trip25, label %exit, label %cont26

i91:                                              ; preds = %cont26
  store i64 0, ptr %r21, align 8
  br label %i92

i92:                                              ; preds = %i91
  store i64 0, ptr %r22, align 8
  br label %i93

i93:                                              ; preds = %i92
  %r21.v = load i64, ptr %r21, align 8
  %r22.v = load i64, ptr %r22, align 8
  %cons27 = call i64 @rt_cons(ptr %0, i64 %r21.v, i64 %r22.v)
  store i64 %cons27, ptr %r14, align 8
  %guard28 = call i64 @rt_faulted(ptr %0)
  %trip29 = icmp ne i64 %guard28, 0
  br i1 %trip29, label %exit, label %cont30

i94:                                              ; preds = %cont30
  %r12.v = load i64, ptr %r12, align 8
  store i64 %r12.v, ptr %a0, align 8
  br label %i95

i95:                                              ; preds = %i94
  %r13.v = load i64, ptr %r13, align 8
  store i64 %r13.v, ptr %a1, align 8
  br label %i96

i96:                                              ; preds = %i95
  %r14.v = load i64, ptr %r14, align 8
  store i64 %r14.v, ptr %a2, align 8
  br label %i97

i97:                                              ; preds = %i96
  %guard31 = call i64 @rt_enter(ptr %0)
  %trip32 = icmp ne i64 %guard31, 0
  br i1 %trip32, label %exit, label %cont33

i98:                                              ; preds = %cont33
  %rr.v37 = load i64, ptr %rr, align 8
  store i64 %rr.v37, ptr %r11, align 8
  br label %i99

i99:                                              ; preds = %i98
  %r11.v = load i64, ptr %r11, align 8
  %head38 = call i64 @rt_head(ptr %0, i64 %r11.v)
  store i64 %head38, ptr %r10, align 8
  %guard39 = call i64 @rt_faulted(ptr %0)
  %trip40 = icmp ne i64 %guard39, 0
  br i1 %trip40, label %exit, label %cont41

i100:                                             ; preds = %cont41
  %r0.v = load i64, ptr %r0, align 8
  %r10.v = load i64, ptr %r10, align 8
  %sadd = call i64 @llvm.uadd.sat.i64(i64 %r0.v, i64 %r10.v)
  store i64 %sadd, ptr %rr, align 8
  br label %i101

i101:                                             ; preds = %i100
  %rr.v42 = load i64, ptr %rr, align 8
  ret i64 %rr.v42

exit:                                             ; preds = %i99, %i97, %i93, %i90, %i89, %i85, %i82, %i80, %i77, %i74, %i73
  ret i64 0

cont:                                             ; preds = %i73
  br label %i74

cont4:                                            ; preds = %i74
  br label %i75

cont8:                                            ; preds = %i77
  br label %i78

cont11:                                           ; preds = %i80
  %a0.v = load i64, ptr %a0, align 8
  %a1.v = load i64, ptr %a1, align 8
  %call = call i64 @map.4(ptr %0, i64 %a0.v, i64 %a1.v)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i81

cont14:                                           ; preds = %i82
  br label %i83

cont18:                                           ; preds = %i85
  br label %i86

cont22:                                           ; preds = %i89
  br label %i90

cont26:                                           ; preds = %i90
  br label %i91

cont30:                                           ; preds = %i93
  br label %i94

cont33:                                           ; preds = %i97
  %a0.v34 = load i64, ptr %a0, align 8
  %a1.v35 = load i64, ptr %a1, align 8
  %a2.v = load i64, ptr %a2, align 8
  %call36 = call i64 @ap2.12(ptr %0, i64 %a0.v34, i64 %a1.v35, i64 %a2.v)
  store i64 %call36, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i98

cont41:                                           ; preds = %i99
  br label %i100
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
define private i64 @map.4(ptr %0, i64 %1, i64 %2) #1 {
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
  store i64 %r0.v, ptr %r3, align 8
  br label %i20

i20:                                              ; preds = %i19
  %r3.v = load i64, ptr %r3, align 8
  %isempty = call i64 @rt_is_empty(ptr %0, i64 %r3.v)
  store i64 %isempty, ptr %r2, align 8
  br label %i21

i21:                                              ; preds = %i20
  %r2.v = load i64, ptr %r2, align 8
  %jz = icmp eq i64 %r2.v, 0
  br i1 %jz, label %i24, label %i22

i22:                                              ; preds = %i21
  store i64 0, ptr %rr, align 8
  br label %i23

i23:                                              ; preds = %i22
  br label %i39

i24:                                              ; preds = %i21
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r5, align 8
  br label %i25

i25:                                              ; preds = %i24
  %r0.v1 = load i64, ptr %r0, align 8
  store i64 %r0.v1, ptr %r7, align 8
  br label %i26

i26:                                              ; preds = %i25
  %r7.v = load i64, ptr %r7, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r7.v)
  store i64 %head, ptr %r6, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i27:                                              ; preds = %cont
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a0, align 8
  br label %i28

i28:                                              ; preds = %i27
  %r6.v = load i64, ptr %r6, align 8
  store i64 %r6.v, ptr %a1, align 8
  br label %i29

i29:                                              ; preds = %i28
  %guard2 = call i64 @rt_enter(ptr %0)
  %trip3 = icmp ne i64 %guard2, 0
  br i1 %trip3, label %exit, label %cont4

i30:                                              ; preds = %cont4
  %rr.v = load i64, ptr %rr, align 8
  store i64 %rr.v, ptr %r4, align 8
  br label %i31

i31:                                              ; preds = %i30
  %r0.v7 = load i64, ptr %r0, align 8
  store i64 %r0.v7, ptr %r11, align 8
  br label %i32

i32:                                              ; preds = %i31
  %r11.v = load i64, ptr %r11, align 8
  %tail = call i64 @rt_tail(ptr %0, i64 %r11.v)
  store i64 %tail, ptr %r9, align 8
  %guard8 = call i64 @rt_faulted(ptr %0)
  %trip9 = icmp ne i64 %guard8, 0
  br i1 %trip9, label %exit, label %cont10

i33:                                              ; preds = %cont10
  %r1.v11 = load i64, ptr %r1, align 8
  store i64 %r1.v11, ptr %r10, align 8
  br label %i34

i34:                                              ; preds = %i33
  %r9.v = load i64, ptr %r9, align 8
  store i64 %r9.v, ptr %a0, align 8
  br label %i35

i35:                                              ; preds = %i34
  %r10.v = load i64, ptr %r10, align 8
  store i64 %r10.v, ptr %a1, align 8
  br label %i36

i36:                                              ; preds = %i35
  %guard12 = call i64 @rt_enter(ptr %0)
  %trip13 = icmp ne i64 %guard12, 0
  br i1 %trip13, label %exit, label %cont14

i37:                                              ; preds = %cont14
  %rr.v18 = load i64, ptr %rr, align 8
  store i64 %rr.v18, ptr %r8, align 8
  br label %i38

i38:                                              ; preds = %i37
  %r4.v = load i64, ptr %r4, align 8
  %r8.v = load i64, ptr %r8, align 8
  %cons = call i64 @rt_cons(ptr %0, i64 %r4.v, i64 %r8.v)
  store i64 %cons, ptr %rr, align 8
  %guard19 = call i64 @rt_faulted(ptr %0)
  %trip20 = icmp ne i64 %guard19, 0
  br i1 %trip20, label %exit, label %cont21

i39:                                              ; preds = %cont21, %i23
  %rr.v22 = load i64, ptr %rr, align 8
  ret i64 %rr.v22

exit:                                             ; preds = %i38, %i36, %i32, %i29, %i26
  ret i64 0

cont:                                             ; preds = %i26
  br label %i27

cont4:                                            ; preds = %i29
  %a0.v5 = load i64, ptr %a0, align 8
  %a1.v6 = load i64, ptr %a1, align 8
  %call = call i64 @"$apply1.0"(ptr %0, i64 %a0.v5, i64 %a1.v6)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i30

cont10:                                           ; preds = %i32
  br label %i33

cont14:                                           ; preds = %i36
  %a0.v15 = load i64, ptr %a0, align 8
  %a1.v16 = load i64, ptr %a1, align 8
  %call17 = call i64 @map.4(ptr %0, i64 %a0.v15, i64 %a1.v16)
  store i64 %call17, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i37

cont21:                                           ; preds = %i38
  br label %i39
}

; Function Attrs: minsize optsize
define private i64 @"$apply2.8"(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
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
  br label %i41

i41:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i42

i42:                                              ; preds = %i41
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i43

i43:                                              ; preds = %i42
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i44

i44:                                              ; preds = %i43
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r5, align 8
  br label %i45

i45:                                              ; preds = %i44
  %r5.v = load i64, ptr %r5, align 8
  %head = call i64 @rt_head(ptr %0, i64 %r5.v)
  store i64 %head, ptr %r4, align 8
  %guard = call i64 @rt_faulted(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i46:                                              ; preds = %cont
  store i64 0, ptr %r6, align 8
  br label %i47

i47:                                              ; preds = %i46
  %r4.v = load i64, ptr %r4, align 8
  %r6.v = load i64, ptr %r6, align 8
  %cmp = icmp eq i64 %r4.v, %r6.v
  %cmpw = zext i1 %cmp to i64
  store i64 %cmpw, ptr %r3, align 8
  br label %i48

i48:                                              ; preds = %i47
  %r3.v = load i64, ptr %r3, align 8
  %jz = icmp eq i64 %r3.v, 0
  br i1 %jz, label %i55, label %i49

i49:                                              ; preds = %i48
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r7, align 8
  br label %i50

i50:                                              ; preds = %i49
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r8, align 8
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
  %guard1 = call i64 @rt_enter(ptr %0)
  %trip2 = icmp ne i64 %guard1, 0
  br i1 %trip2, label %exit, label %cont3

i54:                                              ; preds = %cont3
  br label %i57

i55:                                              ; preds = %i48
  store i64 0, ptr %r9, align 8
  br label %i56

i56:                                              ; preds = %i55
  %r9.v = load i64, ptr %r9, align 8
  %head6 = call i64 @rt_head(ptr %0, i64 %r9.v)
  store i64 %head6, ptr %rr, align 8
  %guard7 = call i64 @rt_faulted(ptr %0)
  %trip8 = icmp ne i64 %guard7, 0
  br i1 %trip8, label %exit, label %cont9

i57:                                              ; preds = %cont9, %i54
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i56, %i53, %i45
  ret i64 0

cont:                                             ; preds = %i45
  br label %i46

cont3:                                            ; preds = %i53
  %a0.v4 = load i64, ptr %a0, align 8
  %a1.v5 = load i64, ptr %a1, align 8
  %call = call i64 @map.4(ptr %0, i64 %a0.v4, i64 %a1.v5)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i54

cont9:                                            ; preds = %i56
  br label %i57
}

; Function Attrs: minsize optsize
define private i64 @ap2.12(ptr %0, i64 %1, i64 %2, i64 %3) #1 {
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
  br label %i59

i59:                                              ; preds = %prologue
  %a0.v = load i64, ptr %a0, align 8
  store i64 %a0.v, ptr %r0, align 8
  br label %i60

i60:                                              ; preds = %i59
  %a1.v = load i64, ptr %a1, align 8
  store i64 %a1.v, ptr %r1, align 8
  br label %i61

i61:                                              ; preds = %i60
  %a2.v = load i64, ptr %a2, align 8
  store i64 %a2.v, ptr %r2, align 8
  br label %i62

i62:                                              ; preds = %i61
  %r0.v = load i64, ptr %r0, align 8
  store i64 %r0.v, ptr %r3, align 8
  br label %i63

i63:                                              ; preds = %i62
  %r1.v = load i64, ptr %r1, align 8
  store i64 %r1.v, ptr %r4, align 8
  br label %i64

i64:                                              ; preds = %i63
  %r2.v = load i64, ptr %r2, align 8
  store i64 %r2.v, ptr %r5, align 8
  br label %i65

i65:                                              ; preds = %i64
  %r3.v = load i64, ptr %r3, align 8
  store i64 %r3.v, ptr %a0, align 8
  br label %i66

i66:                                              ; preds = %i65
  %r4.v = load i64, ptr %r4, align 8
  store i64 %r4.v, ptr %a1, align 8
  br label %i67

i67:                                              ; preds = %i66
  %r5.v = load i64, ptr %r5, align 8
  store i64 %r5.v, ptr %a2, align 8
  br label %i68

i68:                                              ; preds = %i67
  %guard = call i64 @rt_enter(ptr %0)
  %trip = icmp ne i64 %guard, 0
  br i1 %trip, label %exit, label %cont

i69:                                              ; preds = %cont
  %rr.v = load i64, ptr %rr, align 8
  ret i64 %rr.v

exit:                                             ; preds = %i68
  ret i64 0

cont:                                             ; preds = %i68
  %a0.v1 = load i64, ptr %a0, align 8
  %a1.v2 = load i64, ptr %a1, align 8
  %a2.v3 = load i64, ptr %a2, align 8
  %call = call i64 @"$apply2.8"(ptr %0, i64 %a0.v1, i64 %a1.v2, i64 %a2.v3)
  store i64 %call, ptr %rr, align 8
  call void @rt_leave(ptr %0)
  br label %i69
}

attributes #0 = { nocallback nocreateundeforpoison nofree nosync nounwind speculatable willreturn memory(none) }
attributes #1 = { minsize optsize }
