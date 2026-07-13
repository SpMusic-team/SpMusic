import { defaultAppearance } from './defaultAppearance'
import { cloneAppearance } from './appearanceThemeCodec'
import type { AppearancePreset } from './appearanceTypes'

const midnight: AppearancePreset = {
  ...cloneAppearance(defaultAppearance),
  id: 'midnight-blue',
  name: '午夜蓝',
  colorSchemes: {
    light: {
      ...defaultAppearance.colorSchemes.light,
      background: '#f3f6fb',
      surface: '#ffffff',
      surfaceMuted: '#e7edf7',
      text: '#40506a',
      textMuted: '#667792',
      textStrong: '#101a2c',
      border: '#cad5e6',
      accent: '#356fc4',
      accentSoft: '#dce9fb',
      playerBlue: '#356fc4',
      playerBlueSoft: '#dce9fb',
      playerBlueInk: '#214f91',
      playerInk: '#101a2c',
      playerMuted: '#687993',
      playerOverlay: '#f7faffb8',
      playerDock: '#ffffffcc',
    },
    dark: {
      ...defaultAppearance.colorSchemes.dark,
      background: '#0d1424',
      surface: '#172137',
      surfaceMuted: '#202d48',
      text: '#d7e3f4',
      textMuted: '#91a3bd',
      textStrong: '#f7fbff',
      border: '#34445f',
      accent: '#78a9ff',
      accentSoft: '#263f69',
      accentContrast: '#08111f',
      playerBlue: '#78a9ff',
      playerBlueSoft: '#263f69',
      playerBlueInk: '#dceaff',
      playerInk: '#f7fbff',
      playerMuted: '#9aabc3',
      playerOverlay: '#08101ecc',
      playerDock: '#111b2ed9',
    },
  },
  components: { surface: 'solid', buttons: 'outline', windowControls: 'compact' },
  icons: { provider: 'fluent' },
  metadata: {
    ...defaultAppearance.metadata,
    description: '深色高对比度界面，使用 Fluent 图标。',
  },
}

const blossom: AppearancePreset = {
  ...cloneAppearance(defaultAppearance),
  id: 'blossom-mist',
  name: '樱雾',
  colorSchemes: {
    light: {
      ...defaultAppearance.colorSchemes.light,
      background: '#fff7fa',
      surface: '#fffafd',
      surfaceMuted: '#f8e9f0',
      text: '#654958',
      textMuted: '#8c6b7b',
      textStrong: '#3a2631',
      border: '#e8cbd8',
      accent: '#b64f78',
      accentSoft: '#f7dce7',
      accentContrast: '#ffffff',
      playerBlue: '#a84870',
      playerBlueSoft: '#f4d5e2',
      playerBlueInk: '#7d3152',
      playerInk: '#3a2631',
      playerMuted: '#876879',
      playerOverlay: '#fff7faaa',
      playerDock: '#fffafdcc',
    },
    dark: {
      ...defaultAppearance.colorSchemes.dark,
      background: '#21151b',
      surface: '#2c1d25',
      surfaceMuted: '#3a2630',
      text: '#ead7df',
      textMuted: '#b997a7',
      textStrong: '#fff7fa',
      border: '#5b3c4b',
      accent: '#ef8fb4',
      accentSoft: '#582a3e',
      accentContrast: '#32101e',
      playerBlue: '#e982aa',
      playerBlueSoft: '#582a3e',
      playerBlueInk: '#ffd4e4',
      playerInk: '#fff7fa',
      playerMuted: '#c3a2b1',
      playerOverlay: '#180d13cc',
      playerDock: '#2a1922dc',
    },
  },
  radii: { sm: '10px', md: '14px', lg: '22px', pill: '999px' },
  typography: { fontFamily: 'serif', fontScale: 1.03 },
  components: { surface: 'glass', buttons: 'soft', windowControls: 'traffic-lights' },
  icons: { provider: 'ios' },
  metadata: {
    ...defaultAppearance.metadata,
    description: '柔和暖色、衬线字体与 iOS 风格图标。',
  },
}

export const builtinAppearances: AppearancePreset[] = [cloneAppearance(defaultAppearance), midnight, blossom]
export const builtinAppearanceIds = new Set(builtinAppearances.map((theme) => theme.id))

export function findBuiltinAppearance(id: string) {
  return builtinAppearances.find((theme) => theme.id === id)
}
