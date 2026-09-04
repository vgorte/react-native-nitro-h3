import { registerRootComponent } from 'expo'
import { configure } from 'react-native-nitro-h3'

import { spikeScreen } from './spikes'
import App from './src/App'

configure({ maxCellCount: 1_500_000 })

// written out in full so Expo inlines the value at bundle time
registerRootComponent(spikeScreen(process.env.EXPO_PUBLIC_SPIKE) ?? App)
