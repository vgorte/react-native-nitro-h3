import { Platform } from 'react-native'

// there is no safe-area provider, so the bottom inset is per platform: the home indicator on
// iPhone, the gesture bar on Android
export const LINE_BOTTOM = Platform.select({ ios: 42, default: 34 })

// the licence line has no leading of its own, and the band below has to be a number
export const LINE_HEIGHT = 14

/** Points the licence line takes along the bottom edge, which the rest of the stack sits above. */
export const ATTRIBUTION_BAND = LINE_BOTTOM + LINE_HEIGHT

/** Points the blocked readout is wide, which the licence line stands clear of. */
export const READOUT_WIDTH = 208
