# MobiGPT API-only release rules.
# Keep the metadata required by React Native autolinking and the Android launch surface.
-keepattributes *Annotation*
-keepattributes InnerClasses,EnclosingMethod,Signature

-keep class com.pocketpal.MainApplication { *; }
-keep class com.pocketpal.MainActivity { *; }
-keep @com.facebook.react.module.annotations.ReactModule class * { *; }

# React Native 0.82 initializes InspectorFlags through the merged
# react_devsupportjni mapping during release startup. The Kotlin wrapper is
# internal and is reached by JNI/reflection, so R8 must retain it explicitly.
-keep class com.facebook.react.devsupport.InspectorFlags { *; }
-keep class com.facebook.react.devsupport.CxxInspectorPackagerConnection { *; }
-keep class com.facebook.react.devsupport.CxxInspectorPackagerConnection$* { *; }
-keepclassmembers,includedescriptorclasses class com.facebook.react.devsupport.** { native <methods>; }
