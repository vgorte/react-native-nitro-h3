import { registerRootComponent } from 'expo'
import { configure } from 'react-native-nitro-h3'

import App from './src/App'

configure({ maxCellCount: 1_500_000 })

registerRootComponent(App)
