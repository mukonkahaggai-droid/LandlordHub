// Some Capacitor plugins (Local Notifications) insist on a Java 21 install to build, but this laptop
// has the Java 25 that comes with Android Studio. Keep their Java 21 output, without demanding Java 21.
// Runs as part of `npm run android:sync`, so it survives reinstalling the plugins.
const fs = require('fs');
const path = require('path');

const files = ['@capacitor/local-notifications/android/build.gradle'].map((f) => path.join(__dirname, '..', 'node_modules', f));
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const fixed = s.replace(/jvmToolchain\(21\)/, 'compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_21) }');
  if (fixed !== s) { fs.writeFileSync(f, fixed); console.log('Java 21 output, any Java to build:', path.relative(process.cwd(), f)); }
}
