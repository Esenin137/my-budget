import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.mybudget.app',
  appName: 'Мои финансы',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#070B0D',
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
