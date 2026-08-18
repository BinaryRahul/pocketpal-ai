# MobiGPT API-only release rules.
# Keep the metadata required by React Native autolinking and the Android launch surface.
-keepattributes *Annotation*
-keepattributes InnerClasses,EnclosingMethod,Signature

-keep class com.pocketpal.MainApplication { *; }
-keep class com.pocketpal.MainActivity { *; }
-keep @com.facebook.react.module.annotations.ReactModule class * { *; }
